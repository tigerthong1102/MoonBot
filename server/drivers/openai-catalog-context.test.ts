import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { recordEvents } from "../testing/events.ts";
import { OpenAICompatDriver } from "./openai-compat.ts";

const description = "Tra cứu hóa đơn bán hàng theo số chứng từ đã biết.";
const question = "Tra cứu hóa đơn INV-314 và đọc số tiền đã ghi.";
const amount = "INV-314 = 19.540.000 VND";
const catalog = [
  { name: "invoice", description },
  ...Array.from({ length: 40 }, (_, i) => ({ name: `warehouse_${i}`, description: `Đọc số dư vật tư tại kho ${i}. Bao gồm mã hàng, đơn vị tính và số lượng khả dụng.` })),
];
const stdio = `
import { createInterface } from "node:readline";
const tools = ${JSON.stringify(catalog)}.map(t => ({...t, inputSchema:{type:"object",properties:{}}}));
createInterface({ input:process.stdin }).on("line", line => {
  const r=JSON.parse(line);
  if(r.id===undefined)return;
  let result={};
  if(r.method==="initialize") result={protocolVersion:"2024-11-05",capabilities:{tools:{}}};
  if(r.method==="tools/list") result={tools};
  if(r.method==="tools/call") result={content:[{type:"text",text:r.params.name==="invoice"?${JSON.stringify(amount)}:"wrong result"}]};
  process.stdout.write(JSON.stringify({jsonrpc:"2.0", id:r.id, result})+"\\n");
});
`;

it("runs the same Vietnamese invoice request against direct and context-limited catalogs", async () => {
  const folder = mkdtempSync(join(tmpdir(), "omb-catalog-pair-"));
  const helper = join(folder, "invoice.mjs");
  writeFileSync(helper, stdio);
  const measurements = new Map<string, { turns: number; bytes: number; firstBytes: number; elapsed: number[] }>();
  const wire = createServer(async (request, response) => {
    if (request.url === "/v1/models") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "direct", context_length: 262144 }, { id: "limited", context_length: 8192 }] }));
      return;
    }
    if (request.url !== "/v1/chat/completions") { response.writeHead(404); response.end(); return; }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const tools = body.tools as { function: { name: string; description: string } }[];
    const stats = measurements.get(body.model)!;
    const schemaBytes = Buffer.byteLength(JSON.stringify(tools));
    stats.bytes += schemaBytes;
    stats.turns++;
    if (!stats.firstBytes) stats.firstBytes = schemaBytes;
    const last = body.messages.at(-1);
    let delta: object;
    if (last.role === "tool" && String(last.content).includes(amount)) {
      delta = { content: amount };
    } else {
      let name: string, args: object;
      if (last.role === "tool") {
        const found = JSON.parse(JSON.parse(last.content).result).matches?.[0];
        if (!found) { response.writeHead(400); response.end("fixture: no match"); return; }
        name = "mcp_call_tool"; args = { name: found.name, arguments: {} };
      } else {
        const direct = tools.find(t => t.function.description?.includes(description));
        name = direct?.function.name ?? "mcp_search_tools";
        args = direct ? {} : { query: "Tra cứu hóa đơn", limit: 1 };
      }
      delta = { tool_calls: [{ index: 0, type: "function", id: `call-${stats.turns}`, function: { name, arguments: JSON.stringify(args) } }] };
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: "content" in delta ? "stop" : "tool_calls" }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => wire.listen(0, "127.0.0.1", resolve));
  const address = wire.address();
  if (!address || typeof address === "string") throw new Error("fixture has no listening port");
  const instance = await OpenAICompatDriver.create({ instanceId: "fixture", displayName: "Fixture", enabled: true,
    config: { url: `http://127.0.0.1:${address.port}/v1`, apiKeyEnv: "FIXTURE_KEY" }, environment: { FIXTURE_KEY: "fixture" } });
  const recorder = recordEvents(instance.adapter);
  try {
    await instance.refreshModels!();
    for (const model of ["direct", "limited"]) measurements.set(model, { turns: 0, bytes: 0, firstBytes: 0, elapsed: [] });
    for (let i = 0; i < 5; i++) for (const model of i % 2 ? ["limited", "direct"] : ["direct", "limited"]) {
      const threadId = `${model}-${i}`;
      const start = performance.now();
      await instance.adapter.sendTurn({ threadId, text: question, model, approvalMode: "full",
        toolScope: { allow: ["mcp:ledger:*"] }, integrations: { custom: { ledger: { command: process.execPath, args: [helper], env: {} } } } });
      await recorder.until(e => e.threadId === threadId && e.type === "turn.completed", 30_000);
      measurements.get(model)!.elapsed.push(Math.round(performance.now() - start));
      expect(recorder.events.some(e => e.type === "item.completed" && e.threadId === threadId && e.itemType === "assistant_text" && e.text === amount)).toBe(true);
    }
    const direct = measurements.get("direct")!, limited = measurements.get("limited")!;
    expect(direct.turns).toBe(10);
    expect(limited.turns).toBe(15);
    expect(limited.bytes).toBeLessThan(direct.bytes);
    if (process.env.OMB_EVAL_EVIDENCE) writeFileSync(process.env.OMB_EVAL_EVIDENCE, JSON.stringify(Object.fromEntries(measurements), null, 2));
  } finally {
    recorder.stop(); await instance.dispose();
    wire.closeAllConnections();
    await new Promise<void>(resolve => wire.close(() => resolve()));
    rmSync(folder, { recursive: true, force: true });
  }
}, 180_000);
