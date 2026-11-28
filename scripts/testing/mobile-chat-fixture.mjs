import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger, catalog } from "../../apps/ai-pilot/ledger.mjs";
import { pilotServer } from "../../apps/ai-pilot/server.mjs";

export async function startMobileFixture({ mobileOrigin = "https://mobile.example.test" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "startupbot-mobile-"));
  const file = join(dir, "pilot.sqlite");
  const ledger = new Ledger(file);
  const config = catalog(new URL("../../apps/ai-pilot/catalog.example.json", import.meta.url));
  config.managedLimits = { enabled:true, dailyMicros:1000000, monthlyMicros:2000000, requestsPerMinute:10, concurrent:2 };
  const settings = { origin:"http://127.0.0.1", accountOrigin:"https://account.example.test", mobileOrigin,
    catalog:join(dir, "catalog.json"), masterKey:randomBytes(32).toString("base64"), managementKey:"fixture-only" };
  const save = () => writeFileSync(settings.catalog, JSON.stringify(config));
  save();
  const tokens = new Map(), codes = new Set(), generations = [];
  const behavior = { delay:5, finish:"stop", disconnect:false, authOffline:false };
  function grant(id) {
    ledger.issue(id);
    const order = ledger.order(id, "topup", config, randomUUID());
    ledger.grant(order, { id:randomUUID(), payment:randomUUID(), start:Date.now() - 1, end:null });
  }
  const http = async (raw, init) => {
    const url = new URL(raw), body = init.body ? JSON.parse(init.body) : {};
    if (url.origin === settings.accountOrigin) {
      if (behavior.authOffline) throw new Error("fixture offline");
      const token = new Headers(init.headers).get("authorization")?.slice(7);
      if (url.pathname.endsWith("/send-verification-otp")) {
        codes.add(body.email);
        return Response.json({ success:true });
      }
      if (url.pathname.endsWith("/sign-in/email-otp") && body.otp === "12345678" && codes.delete(body.email)) {
        const user = { id:body.email.split("@")[0], email:body.email, emailVerified:true }, bearer = randomUUID();
        tokens.set(bearer, user);
        return Response.json({ user }, { headers:{ "set-auth-token":bearer } });
      }
      if (url.pathname === "/v1/me" && tokens.has(token)) {
        if (behavior.beforeMe) await behavior.beforeMe();
        return Response.json({ user:tokens.get(token) });
      }
      if (url.pathname.endsWith("/sign-out")) {
        if (!init.body || new Headers(init.headers).get("content-type") !== "application/json")
          return Response.json({ error:"unsupported_media_type" }, { status:415 });
        tokens.delete(token);
        return Response.json({ success:true });
      }
      return Response.json({ code:"unauthorized" }, { status:401 });
    }
    if (url.origin !== "https://openrouter.ai") throw Error("Unexpected fixture origin");
    if (url.pathname.endsWith("/keys")) return Response.json({ key:randomUUID(), data:{ hash:randomUUID() } });
    if (!url.pathname.endsWith("/chat/completions")) throw Error("Unexpected fixture route");
    generations.push(body);
    const id = "gen-" + randomUUID(), encoder = new TextEncoder();
    let timer;
    const stream = new ReadableStream({
      start(controller) {
        const emit = (payload) => controller.enqueue(encoder.encode("data: " + JSON.stringify({ id, ...payload }) + "\r\n\r\n"));
        emit({ choices:[{ delta:{ content:"Xin " } }] });
        timer = setTimeout(() => {
          if (!behavior.disconnect) {
            emit({ choices:[{ delta:{ content:"chào" }, finish_reason:behavior.finish }], usage:{ cost:0.0001, prompt_tokens:20, completion_tokens:3 } });
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          }
          controller.close();
        }, behavior.delay);
        init.signal.addEventListener("abort", () => { clearTimeout(timer); try { controller.error(Error("cancelled")); } catch {} }, { once:true });
      },
      cancel() { clearTimeout(timer); }
    });
    return new Response(stream, { headers:{ "content-type":"text/event-stream" } });
  };
  const server = pilotServer(ledger, settings, http);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = "http://127.0.0.1:" + server.address().port;
  function call(path, cookie, body, options = {}) {
    return fetch(url + "/mobile" + path, { method:body ? "POST" : "GET",
      ...options, headers:{ origin:mobileOrigin, "content-type":"application/json", ...(cookie ? { cookie } : {}), ...options.headers },
      body:body ? JSON.stringify(body) : undefined });
  }
  async function login(account) {
    const email = account + "@example.test";
    await call("/code", null, { email });
    const response = await call("/login", null, { email, otp:"12345678" });
    return response.headers.get("set-cookie").split(";")[0];
  }
  async function close() {
    await new Promise(resolve => server.close(resolve));
    ledger.db.close();
    rmSync(dir, { recursive:true, force:true });
  }
  return { dir, file, ledger, config, settings, save, tokens, generations, behavior, grant, server, url, call, login, close };
}
