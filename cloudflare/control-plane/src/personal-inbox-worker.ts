import { inboxGeneratedAnswer } from "./inbox-generated-answer";
import { inboxExactAnswer } from "./inbox-exact-answer";
import { inboxTwinPairing } from "./inbox-twin-pairing";
import { inboxLanguage, supportedInboxLanguage } from "./inbox-language";
import { previewGroup } from "./inbox-group";
import { InboxSignals, notifyRoom } from "./inbox-signals";
export { InboxSignals };
import { inboxFile, inboxFilePart, maxFileBytes, maxBatchParts, maxRawBatchParts, partBytes, voiceFileBytes } from "./inbox-files";
import { allowPilotLogin, claimGuestInvites, suppressGuestMail } from "./inbox-guest";
import { z } from "zod";
import { createAuth, deleteExpiredVerifications } from "./auth";
import { errorResponse, HTTPError, json, withBoundedRequestBody } from "./http";
import { limitedOTPResponse } from "./otp-rate-limit";
import { inboxRetention, inboxRoutes, maxPostBytes } from "./personal-inbox";

export type InboxEnv = Pick<Env, "DB" | "EMAIL" | "BETTER_AUTH_SECRET"> & {
  INBOX_EXACT_ANSWER?: string;
  INBOX_GENERATED_ANSWER?: string;
  SIGNALS?: DurableObjectNamespace<InboxSignals>;
  BETTER_AUTH_URL: string;
  EMAIL_FROM: string;
  INBOX_PILOT_EMAILS?: string;
  ASSETS: Pick<Fetcher, "fetch">;
};

const authPaths = new Set([
  "/api/auth/email-otp/send-verification-otp",
  "/api/auth/sign-in/email-otp",
  "/api/auth/sign-out",
]);

async function handle(request: Request, env: InboxEnv, ctx: ExecutionContext) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
  if (
    url.origin !== env.BETTER_AUTH_URL ||
    env.BETTER_AUTH_SECRET?.length < 32 ||
    !env.BETTER_AUTH_SECRET ||
    !z.email().safeParse(env.EMAIL_FROM).success
  ) {
    return errorResponse(503, "unconfigured");
  }
  if (request.method !== "GET" && request.method !== "POST") return errorResponse(405, "method_not_allowed");
  if (request.method === "POST" && request.headers.get("origin") !== url.origin)
    return errorResponse(403, "forbidden");
  const file = /^\/api\/rooms\/([a-f0-9-]{36})\/files\/([0-9a-f-]{1,36})(?:\/(gzip|start|complete|[0-9]{1,2}))?$/.exec(url.pathname);
  if (file?.[3] && request.method !== "POST") return errorResponse(405, "method_not_allowed");
  const post = /^\/api\/rooms\/[a-f0-9-]{36}\/posts$/.test(url.pathname);
  const req = file ? request : await withBoundedRequestBody(request, post ? maxPostBytes : undefined);
  if (req.method === "POST" && url.pathname === "/api/join/preview") return previewGroup(req,env.DB);
  if (req.method === "POST" && url.pathname === "/api/stop-invitations")
    return suppressGuestMail(req, env.DB);
  const authFor = (language: string) => createAuth(
    env,
    ctx,
    { authBaseURL: url.origin, allowedOrigins: new Set([url.origin]), emailFrom: env.EMAIL_FROM },
    crypto.randomUUID(),
    "StartupBot",
    language,
  );
  if (authPaths.has(url.pathname)) {
    if (req.method !== "POST") return errorResponse(405, "method_not_allowed");
    let language = inboxLanguage(req.headers.get("x-inbox-language"));
    if (!url.pathname.endsWith("/sign-out")) {
      const input = z.object({ email: z.email().max(254) }).safeParse(
        await req
          .clone()
          .json()
          .catch(() => null),
      );
      if (!input.success) return errorResponse(400, "invalid_request");
      const inviteKey = req.headers.get("x-inbox-invite");
      const validLink = inviteKey && z.uuid().safeParse(inviteKey).success && await env.DB.prepare(
        "SELECT 1 FROM inbox_rooms WHERE invite_key=? AND invite_until>? AND kind='group'").bind(inviteKey,Date.now()).first();
      if (!validLink && !(await allowPilotLogin(env, input.data.email.toLowerCase())))
        return url.pathname.endsWith("send-verification-otp")
          ? json({ ok: true })
          : errorResponse(401, "auth_failed");
      if (url.pathname.endsWith("send-verification-otp") && req.headers.get("x-inbox-language-source") === "default") {
        const saved = await env.DB.prepare(
          'SELECT l.locale FROM inbox_languages l JOIN "user" u ON u.id=l.person WHERE u.email=? AND u.emailVerified=1',
        ).bind(input.data.email.toLowerCase()).first<string>("locale");
        if (saved) language = inboxLanguage(saved);
      }
    }
    if (url.pathname.endsWith("send-verification-otp")) {
      const input = (await req
        .clone()
        .json()
        .catch(() => null)) as { type?: string } | null;
      if (input?.type !== "sign-in") return errorResponse(400, "invalid_request");
      const limited = await limitedOTPResponse(req, env);
      if (limited) return json({ ok: true });
    }
    const auth = authFor(language);
    const res = await auth.handler(req);
    if (res.ok) ctx.waitUntil(deleteExpiredVerifications(auth).catch(() => {}));
    if (!res.ok) return errorResponse(res.status, res.status === 429 ? "rate_limited" : "auth_failed");
    // Only the HttpOnly session cookie crosses into the browser. Omit raw tokens from the auth response.
    const response = json({ ok: true });
    for (const cookie of res.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
    return response;
  }
  const session = await authFor("en").api.getSession({
    headers: new Headers({ cookie: req.headers.get("cookie") ?? "" }),
  });
  if (!session?.user.emailVerified) return errorResponse(401, "unauthorized");
  if (url.pathname === "/api/twin-generated") {
    if (env.INBOX_GENERATED_ANSWER !== "1") return errorResponse(404,"not_found");
    return inboxGeneratedAnswer(req, env.DB, { id:session.session.id, owner:session.user.id }, room => {
      if (env.SIGNALS) ctx.waitUntil(notifyRoom(env,room));
    });
  }
  if (url.pathname === "/api/twin-exact") {
    if (env.INBOX_EXACT_ANSWER !== "1") return errorResponse(404, "not_found");
    return inboxExactAnswer(req, env.DB, { id: session.session.id, owner: session.user.id }, room => {
      if (env.SIGNALS) ctx.waitUntil(notifyRoom(env,room));
    });
  }
  if (url.pathname === "/api/twin-pairing") return inboxTwinPairing(req, env.DB, { id: session.session.id, owner: session.user.id, expires: session.session.expiresAt.getTime() });
  if (url.pathname === "/api/account/updates") {
    if (req.method === "POST") {
      const choice = z.object({ enabled: z.boolean(), initial: z.boolean().optional(), email: z.email() }).safeParse(
        await req.json().catch(() => null),
      );
      if (!choice.success) return errorResponse(400, "invalid_request");
      if (choice.data.email !== session.user.email) return errorResponse(409, "account_changed");
      await env.DB.prepare('UPDATE "user" SET product_updates=? WHERE id=? AND (?=0 OR product_updates IS NULL)')
        .bind(Number(choice.data.enabled), session.user.id, Number(choice.data.initial === true)).run();
    }
    const value = await env.DB.prepare('SELECT product_updates FROM "user" WHERE id=?')
      .bind(session.user.id).first<number>("product_updates");
    return json({ email: session.user.email, enabled: value === null ? null : value === 1 });
  }
  if (url.pathname === "/api/language" && req.method === "POST") {
    const input = z.object({locale:z.string().refine(supportedInboxLanguage)}).safeParse(await req.json().catch(()=>null));
    if (!input.success) return errorResponse(400,"invalid_request");
    await env.DB.prepare("INSERT INTO inbox_languages(person,locale) VALUES(?,?) ON CONFLICT(person) DO UPDATE SET locale=excluded.locale")
      .bind(session.user.id,input.data.locale).run();
    return json({ok:true});
  }
  if (url.pathname === "/api/events") {
    if (req.method !== "GET" || req.headers.get("origin") !== url.origin || req.headers.get("upgrade") !== "websocket")
      return errorResponse(403, "forbidden");
    if (!env.SIGNALS) return errorResponse(503, "unavailable");
    return env.SIGNALS.getByName(session.user.id).fetch("https://internal/events", { headers: {
      upgrade: "websocket", "x-session": session.session.id, "x-expires": String(session.session.expiresAt.getTime()),
    } });
  }
  if (file) {
    const action = file[3];
    const result = action && action !== "gzip"
      ? await inboxFilePart(req, env.DB, session.user.id, file[1], file[2], action)
      : await inboxFile(req, env.DB, session.user.id, file[1], file[2], inboxRetention, Boolean(action));
    if (env.SIGNALS && req.method === "POST" && result.ok && (!action || action === "gzip" || action === "complete"))
      ctx.waitUntil(notifyRoom(env, file[1]).catch(() => console.error("inbox file notification failed")));
    return result;
  }
  if (req.method === "GET" && url.pathname === "/api/me") {
    await claimGuestInvites(env.DB, session.user.id, session.user.email.toLowerCase());
    const locale = await env.DB.prepare("SELECT locale FROM inbox_languages WHERE person=?").bind(session.user.id).first<string>("locale");
    return json({ id: session.user.id, email: session.user.email, ...(env.INBOX_EXACT_ANSWER==="1" && {exactAnswer:true}), ...(env.INBOX_GENERATED_ANSWER==="1" && {generatedAnswer:true}), locale, maxFileBytes, signals: Boolean(env.SIGNALS), fileGzip: true, fileBrotli: true, filePartBytes: partBytes, fileBatchParts: maxBatchParts, fileRawBatchParts: maxRawBatchParts, voiceFileBytes });
  }
  const result = await inboxRoutes(req, env, session.user.id, ctx);
  const silent = result.headers.get("x-inbox-internal-silent") === "1";
  result.headers.delete("x-inbox-internal-silent");
  if (!silent && env.SIGNALS && result.ok && req.method === "POST") {
    const match = /^\/api\/rooms\/([a-f0-9-]{36})\/(posts|moderate|accept|remove|leave|invite|bots)$/.exec(url.pathname);
    const creates = url.pathname === "/api/rooms" || url.pathname === "/api/join";
    const room = match?.[1] ?? (creates ? (await result.clone().json<{id:string}>()).id : null);
    if (room) ctx.waitUntil(notifyRoom(env, room, creates || match?.[2] === "invite")
      .catch(() => console.error("inbox notification failed")));
  }
  return result;
}

export default {
  async fetch(request: Request, env: InboxEnv, ctx: ExecutionContext) {
    let response;
    try {
      response = await handle(request, env, ctx);
    } catch (error) {
      response =
        error instanceof HTTPError
          ? errorResponse(error.status, error.code)
          : errorResponse(500, "internal_error");
    }
    if (response.webSocket) return response;
    const headers = new Headers(response.headers);
    headers.set("cache-control", "private, no-store");
    headers.set("referrer-policy", "no-referrer");
    headers.set("x-content-type-options", "nosniff");
    headers.set("permissions-policy", "microphone=(self), camera=(), display-capture=()");
    headers.set(
      "content-security-policy",
      new URL(request.url).pathname === "/file-compressor.js"
        ? "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'"
        : "default-src 'none'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (new URL(request.url).pathname.startsWith("/brotli-3.0.1/") && response.ok)
      headers.set("cache-control", "public, max-age=31536000, immutable");
    return new Response(response.body, { status: response.status, headers, encodeBody: "automatic" });
  },
  async scheduled(_event, env) {
    await env.DB.batch([
      ...(env.INBOX_GENERATED_ANSWER === "1" ? [env.DB.prepare("DELETE FROM inbox_generated_grants WHERE expires<=?").bind(Date.now()), env.DB.prepare("DELETE FROM inbox_generated_revoked WHERE expires<=?").bind(Date.now())] : []),
      ...(env.INBOX_EXACT_ANSWER === "1" ? [env.DB.prepare("DELETE FROM inbox_exact_revoked WHERE expires<=?").bind(Date.now())] : []),
      env.DB.prepare("DELETE FROM inbox_twin_pairings WHERE expires<=?").bind(Date.now()),
      env.DB.prepare("DELETE FROM inbox_bot_rounds WHERE expires<=?").bind(Date.now()),
      env.DB.prepare("DELETE FROM inbox_bot_claims WHERE expires<=?").bind(Date.now()),
      env.DB.prepare("DELETE FROM inbox_uploads WHERE ready=0 AND created<?").bind(Date.now() - 3600_000),
      env.DB.prepare("DELETE FROM inbox_posts WHERE created<?").bind(Date.now() - inboxRetention),
      env.DB.prepare("DELETE FROM inbox_guest_invites WHERE created<?").bind(Date.now() - 7 * 86400_000),
    ]);
  },
} satisfies ExportedHandler<InboxEnv>;
