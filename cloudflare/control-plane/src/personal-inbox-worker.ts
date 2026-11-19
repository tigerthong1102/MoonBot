import { z } from "zod";
import { createAuth, deleteExpiredVerifications } from "./auth";
import { errorResponse, HTTPError, json, withBoundedRequestBody } from "./http";
import { limitedOTPResponse } from "./otp-rate-limit";
import { inboxRetention, inboxRoutes } from "./personal-inbox";

export type InboxEnv = Pick<Env, "DB" | "EMAIL" | "BETTER_AUTH_SECRET"> & {
  BETTER_AUTH_URL: string;
  EMAIL_FROM: string;
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
  const req = await withBoundedRequestBody(request);
  const auth = createAuth(
    env,
    ctx,
    { authBaseURL: url.origin, allowedOrigins: new Set([url.origin]), emailFrom: env.EMAIL_FROM },
    crypto.randomUUID(),
    "StartupBot",
  );
  if (authPaths.has(url.pathname)) {
    if (req.method !== "POST") return errorResponse(405, "method_not_allowed");
    if (url.pathname.endsWith("send-verification-otp")) {
      const input = (await req
        .clone()
        .json()
        .catch(() => null)) as { type?: string } | null;
      if (input?.type !== "sign-in") return errorResponse(400, "invalid_request");
      const limited = await limitedOTPResponse(req, env);
      if (limited) return limited;
    }
    const res = await auth.handler(req);
    if (res.ok) ctx.waitUntil(deleteExpiredVerifications(auth).catch(() => {}));
    if (!res.ok) return errorResponse(res.status, res.status === 429 ? "rate_limited" : "auth_failed");
    // Only the HttpOnly session cookie crosses into the browser. Omit raw tokens from the auth response.
    const response = json({ ok: true });
    for (const cookie of res.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
    return response;
  }
  const session = await auth.api.getSession({
    headers: new Headers({ cookie: req.headers.get("cookie") ?? "" }),
  });
  if (!session?.user.emailVerified) return errorResponse(401, "unauthorized");
  if (req.method === "GET" && url.pathname === "/api/me")
    return json({ id: session.user.id, email: session.user.email });
  return inboxRoutes(req, env.DB, session.user.id);
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
    const headers = new Headers(response.headers);
    headers.set("cache-control", "private, no-store");
    headers.set("referrer-policy", "no-referrer");
    headers.set("x-content-type-options", "nosniff");
    headers.set(
      "content-security-policy",
      "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(_event, env) {
    await env.DB.prepare("DELETE FROM inbox_posts WHERE created<?")
      .bind(Date.now() - inboxRetention)
      .run();
  },
} satisfies ExportedHandler<InboxEnv>;
