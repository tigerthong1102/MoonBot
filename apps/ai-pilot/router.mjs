import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { consumeMobileStream } from "./mobile-stream.mjs";
import { digest, Fault } from "./ledger.mjs";

function seal(value, master) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", master, iv);
  return Buffer.concat([iv, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
}
function open(value, master) {
  const data = Buffer.from(value, "base64");
  const cipher = createDecipheriv("aes-256-gcm", master, data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString("utf8");
}

export function boundedRequest(body, config, owner) {
  if (
    body.model !== config.model ||
    !Array.isArray(body.messages) ||
    !body.messages.length ||
    body.messages.length > 512
  )
    throw new Fault(400, "model_or_messages_unsupported");
  const messages = body.messages.map((m) => {
    if (
      !m ||
      !["user", "system", "assistant", "tool", "developer"].includes(m.role) ||
      !(
        typeof m.content === "string" ||
        (m.content == null && m.role === "assistant" && Array.isArray(m.tool_calls)) ||
        (Array.isArray(m.content) && m.content.every((p) => p?.type === "text" && typeof p.text === "string"))
      )
    )
      throw new Fault(400, "text_messages_required");
    return {
      role: m.role,
      content: m.content,
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
    };
  });
  if (
    body.tools &&
    (!Array.isArray(body.tools) || body.tools.some((t) => t?.type !== "function" || !t.function?.name))
  )
    throw new Fault(400, "function_tools_required");
  const max = body.max_completion_tokens ?? body.max_tokens ?? config.maxOutput;
  if (!Number.isSafeInteger(max) || max < 1) throw new Fault(400, "invalid_output_limit");
  return {
    model: config.model,
    messages,
    max_tokens: Math.min(config.maxOutput, max),
    stream: false,
    user: digest(owner),
    provider: {
      require_parameters: true,
      max_price: { prompt: config.maxPromptUsdPerMillion, completion: config.maxOutputUsdPerMillion, request: 0 },
    },
    ...(body.tools ? { tools: body.tools } : {}),
    ...(body.tool_choice ? { tool_choice: body.tool_choice } : {}),
    ...(body.response_format ? { response_format: body.response_format } : {}),
    ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
  };
}
export function maximumCost(request, config) {
    // A byte bound plus per-message framing covers text and tool schemas without relying on a model-specific tokenizer.
    const upperInput = Buffer.byteLength(JSON.stringify(request)) + 32 * request.messages.length + 256;
    return Math.ceil(
      upperInput * config.maxPromptUsdPerMillion + request.max_tokens * config.maxOutputUsdPerMillion,
    );
}
export function router(ledger, settings, http = fetch) {
  const db = ledger.db;
  function master() {
    const bytes = Buffer.from(settings.masterKey ?? "", "base64");
    if (bytes.length !== 32 || !settings.managementKey) throw new Fault(503, "pilot_router_not_configured");
    return bytes;
  }
  async function api(path, key, body, signal) {
    return http("https://openrouter.ai/api/v1/" + path, {
      method: body ? "POST" : "GET",
      headers: { authorization: "Bearer " + key, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000),
    });
  }
  async function keyFor(owner, config) {
    const encryption = master(),
      row = db.prepare("SELECT * FROM users WHERE id=?").get(owner);
    if (row.keyState === "ready") return open(row.secret, encryption);
    const name = "startupbot-pilot-" + randomUUID();
    if (
      !db
        .prepare("UPDATE users SET keyState='provisioning',keyName=? WHERE id=? AND keyState IS NULL")
        .run(name, owner).changes
    )
      throw new Fault(503, "key_provisioning_needs_review");
    const response = await api("keys", settings.managementKey, {
      name,
      limit: config.keyLimitUsd,
      include_byok_in_limit: true,
    });
    if (!response.ok) throw new Fault(503, "key_provisioning_needs_review");
    const json = await response.json();
    if (!json.data?.hash || !json.key) throw new Fault(503, "key_provisioning_needs_review");
    db.prepare("UPDATE users SET keyState='ready',keyHash=?,secret=? WHERE id=? AND keyName=?").run(
      json.data.hash,
      seal(json.key, encryption),
      owner,
      name,
    );
    return json.key;
  }
  async function run(owner, id, body, config, stream) {
    const request = boundedRequest(body, config, owner);
    const reserve = maximumCost(request, config);
    if (settings.mobileOrigin && !config.managedLimits) throw new Fault(503, "managed_ai_paused");
    ledger.reserve(owner, id, digest(JSON.stringify(request)), reserve, request.model, config.managedLimits);
    try {
      return await dispatch(owner, id, request, config, stream);
    } finally {
      db.prepare("DELETE FROM active_requests WHERE owner=? AND id=?").run(owner, id);
    }
  }
  async function dispatch(owner, id, request, config, stream) {
    let key;
    try {
      stream?.signal.throwIfAborted();
      key = await keyFor(owner, config);
      stream?.signal.throwIfAborted();
    } catch (e) {
      ledger.settle(owner, id, "unsent-" + randomUUID(), 0, {}, true);
      throw e;
    }
    let result;
    try {
      const response = await api("chat/completions", key, stream ? { ...request, stream: true } : request, stream?.signal);
      if ([400, 401, 402, 403, 404, 413, 422, 429].includes(response.status)) {
        ledger.settle(owner, id, "rejected-" + randomUUID(), 0, {}, [402,429].includes(response.status));
        throw new Fault(
          503,
          response.status === 402 ? "supplier_credit_unavailable" : "supplier_rejected_request",
        );
      }
      if (!response.ok) throw new Error();
      result = stream ? await consumeMobileStream(response, stream, (generation) => {
        db.prepare("UPDATE requests SET generation=? WHERE owner=? AND id=?").run(generation, owner, id);
      }) : await response.json();
      if (!result.id || !result.choices?.length) throw new Error();
      db.prepare("UPDATE requests SET generation=? WHERE owner=? AND id=?").run(result.id, owner, id);
      if (!Number.isFinite(result.usage?.cost) || result.usage.cost < 0) await reconcile(owner, id);
      else
        ledger.settle(owner, id, result.id, Math.ceil(result.usage.cost * 1000000), {
          input: result.usage.prompt_tokens,
          output: result.usage.completion_tokens,
        });
    } catch (e) {
      if (e instanceof Fault) throw e;
      throw new Fault(503, "reconciliation_required");
    }
    return result;
  }
  async function reconcile(owner, id, suppliedGeneration) {
    const row = db.prepare("SELECT generation,state FROM requests WHERE owner=? AND id=?").get(owner, id);
    const generation = row?.generation || suppliedGeneration;
    if (!row || !generation) throw new Fault(409, "generation_id_required");
    if (suppliedGeneration && row.generation && suppliedGeneration !== row.generation)
      throw new Fault(409, "generation_conflict");
    if (row.state !== "held") return;
    const user = db.prepare("SELECT secret FROM users WHERE id=?").get(owner);
    const response = await api("generation?id=" + encodeURIComponent(generation), open(user.secret, master()));
    const data = response.ok ? (await response.json()).data : null;
    if (
      data?.id !== generation ||
      (data.user != null && data.user !== digest(owner)) ||
      !Number.isFinite(data.total_cost) ||
      data.total_cost < 0
    )
      throw new Fault(503, "reconciliation_required");
    ledger.settle(owner, id, generation, Math.ceil(data.total_cost * 1000000), {
      input: data.native_tokens_prompt ?? data.tokens_prompt,
      output: data.native_tokens_completion ?? data.tokens_completion,
    });
  }
  return { run, reconcile };
}

export function asEventStream(result) {
  const base = { id: result.id, model: result.model, created: result.created, object: "chat.completion.chunk" };
  const chunks = result.choices.map((choice) => {
    const { tool_calls, ...delta } = choice.message;
    if (tool_calls) delta.tool_calls = tool_calls.map((call, index) => ({ ...call, index }));
    return { ...base, choices: [{ index: choice.index, delta, finish_reason: null }] };
  });
  chunks.push({
    ...base,
    choices: result.choices.map((c) => ({ index: c.index, delta: {}, finish_reason: c.finish_reason })),
    usage: result.usage,
  });
  return chunks.map((chunk) => "data: " + JSON.stringify(chunk) + "\n\n").join("") + "data: [DONE]\n\n";
}
