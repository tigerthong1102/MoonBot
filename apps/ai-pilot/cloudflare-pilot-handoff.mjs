import { DurableObject } from "cloudflare:workers";
import { createHash } from "node:crypto";
import {
  mobileDraftAccount,
  mobileDraftDevice,
  sweepMobileDrafts,
} from "../../cloudflare/control-plane/src/mobile-desktop-drafts.ts";
import {
  createInstallation,
  listInstallations,
  installationSelf,
  revokeInstallation,
  rotateInstallationCredential,
  requireInstallation,
} from "../../cloudflare/control-plane/src/installations.ts";
import {
  HTTPError,
  readBoundedJSON,
} from "../../cloudflare/control-plane/src/http.ts";
import {
  ControlPlaneError,
  createControlPlaneClient,
} from "../../electron/control-plane-client.mjs";

export const issuer = "https://accounts.openmausbot.com";
const hashed = (value) => createHash("sha256").update(value).digest("hex");
const reply = (value, status = 200, headers = {}) =>
  Response.json(value, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
const accountRoutes = new Map([
  ["/v1/mobile-drafts/arm", "arm"],
  ["/v1/mobile-drafts", "offer"],
  ["/v1/mobile-drafts/targets", "targets"],
  ["/v1/mobile-drafts/status", "status"],
]);
const otpPath = "/api/auth/email-otp/send-verification-otp",
  loginPath = "/api/auth/sign-in/email-otp";
const devicePath = "/v1/installations/self/mobile-drafts";
export const isHandoff = (path) =>
  accountRoutes.has(path) ||
  [
    otpPath,
    loginPath,
    "/api/auth/sign-out",
    "/v1/me",
    "/healthz",
    "/v1/installations/self",
    "/v1/installations",
    devicePath,
  ].includes(path) ||
  /^\/v1\/installations\/[a-f0-9-]{36}(?:\/credentials\/rotate)?$/i.test(path);
export class PilotHandoff extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.grants = new Map();
    ctx.blockConcurrencyWhile(async () => {
      await env.DB.prepare("DELETE FROM mobile_draft_receivers").run();
    });
  }
  async callIssuer(url, init) {
    const response = await fetch(url, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400)
      throw new HTTPError(503, "issuer_redirect");
    return response;
  }
  invited(email) {
    return (
      typeof email === "string" &&
      hashed(email.trim().toLowerCase()) === this.env.INVITED_EMAIL_HASH
    );
  }
  async identity(token) {
    if (!token || token.length > 8192 || token.startsWith("omb_install_"))
      throw new HTTPError(401, "unauthorized");
    const res = await this.callIssuer(issuer + "/api/auth/get-session", {
      headers: { authorization: "Bearer " + token, origin: issuer },
      signal: AbortSignal.timeout(4000),
    });
    if (res.status >= 500 || res.status === 429)
      throw new HTTPError(503, "account_unavailable");
    if (!res.ok) throw new HTTPError(401, "unauthorized");
    const value = await res.json();
    const expiry = Date.parse(value?.session?.expiresAt);
    if (
      !value?.session?.id ||
      !value.user?.id ||
      value.user.emailVerified !== true ||
      !this.invited(value.user.email) ||
      value.session.userId !== value.user.id ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now()
    )
      throw new HTTPError(401, "unauthorized");
    return {
      user: {
        id: value.user.id,
        email: value.user.email,
        name: value.user.name,
        emailVerified: true,
      },
      session: {
        id: value.session.id,
        expiresAt: new Date(expiry).toISOString(),
      },
    };
  }
  async clear(listener) {
    this.grants.delete(listener);
    await this.env.DB.prepare(
      "DELETE FROM mobile_draft_receivers WHERE listener=?",
    )
      .bind(listener)
      .run();
  }
  async alarm() {
    const now = Date.now();
    for (const [listener, g] of this.grants)
      if (g.until <= now) await this.clear(listener);
    await sweepMobileDrafts(this.env.DB, now);
    await this.env.DB.prepare("DELETE FROM session WHERE expires<=?")
      .bind(now)
      .run();
    const pending = await this.env.DB.prepare(
      "SELECT 1 FROM mobile_desktop_drafts LIMIT 1",
    ).first();
    const oldest = await this.env.DB.prepare(
      "SELECT min(expires) AS expires FROM session",
    ).first();
    const next = Math.min(
      this.grants.size ? now + 6500 : Infinity,
      pending ? now + 3600000 : Infinity,
      oldest?.expires ?? Infinity,
    );
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
  }
  async schedule() {
    const at = await this.ctx.storage.getAlarm();
    if (!at || at > Date.now() + 6500)
      await this.ctx.storage.setAlarm(Date.now() + 6500);
  }
  async fetch(req) {
    try {
      return await this.handle(req);
    } catch (e) {
      if (e instanceof HTTPError || e instanceof ControlPlaneError)
        return reply({ error: e.code }, e.status || 503);
      return reply({ error: "pilot_unavailable" }, 503);
    }
  }
  async handle(req) {
    const p = new URL(req.url).pathname,
      method = req.method;
    const token = /^Bearer (\S+)$/i.exec(
      req.headers.get("authorization") ?? "",
    )?.[1];
    const db = this.env.DB;
    if (!isHandoff(p)) throw new HTTPError(404, "not_found");
    if (method === "GET" && p === "/healthz")
      return reply({
        ok: true,
        service: "openmausbot-control-plane",
        desktopHandoff: true,
      });
    if (method === "POST" && (p === otpPath || p === loginPath)) {
      const b = await readBoundedJSON(req);
      if (!this.invited(b.email)) throw new HTTPError(403, "not_invited");
      const key = "otp:" + p,
        now = Date.now();
      let state = this.ctx.storage.kv.get(key);
      if (!state || state.end <= now) state = { end: now + 3600000, count: 0 };
      if (++state.count > (p === otpPath ? 5 : 12))
        throw new HTTPError(429, "rate_limited");
      this.ctx.storage.kv.put(key, state);
      const client = createControlPlaneClient({
        baseURL: issuer,
        fetchImpl: (url, init) => this.callIssuer(url, init),
      });
      if (p === otpPath) {
        await client.requestOTP(b.email);
        return reply({ ok: true });
      }
      const { user, accountToken } = await client.verifyOTP(b.email, b.otp);
      return reply({ user }, 200, { "set-auth-token": accountToken });
    }
    if (p === devicePath && method === "POST") {
      const machine = await requireInstallation(req, this.env);
      const body = await readBoundedJSON(req.clone());
      const grant = this.grants.get(body.listener);
      if (
        !grant ||
        grant.installation !== machine.installation_id ||
        grant.until <= Date.now()
      )
        throw new HTTPError(409, "receiver_unavailable");
      if (body.action !== "close") {
        let verified;
        try {
          verified = await this.identity(grant.token);
        } catch (e) {
          if (e.status === 401) await this.clear(body.listener);
          throw e;
        }
        if (verified.session.id !== grant.session)
          throw new HTTPError(401, "unauthorized");
      }
      if (grant.until <= Date.now() || this.grants.get(body.listener) !== grant)
        throw new HTTPError(409, "receiver_unavailable");
      const response = await mobileDraftDevice(req, this.env);
      if (response.ok && body.action === "close")
        this.grants.delete(body.listener);
      if (
        response.ok &&
        body.action === "poll" &&
        this.grants.get(body.listener) === grant
      )
        grant.until = Date.now() + 6000;
      return response;
    }
    if (method === "GET" && p === "/v1/installations/self")
      return installationSelf(req, this.env);
    const session = await this.identity(token);
    const auth = { api: { getSession: async () => session } };
    if (p === "/v1/me" && method === "GET")
      return reply({ user: session.user });
    if (p === "/api/auth/sign-out" && method === "POST") {
      const r = await this.callIssuer(issuer + p, {
        method,
        headers: {
          authorization: "Bearer " + token,
          origin: issuer,
          "content-type": "application/json",
        },
        body: "{}",
      });
      if (!r.ok) throw new HTTPError(503, "account_unavailable");
      await db
        .prepare("DELETE FROM session WHERE id=?")
        .bind(session.session.id)
        .run();
      for (const [listener, g] of this.grants)
        if (g.session === session.session.id) await this.clear(listener);
      return reply({ status: true });
    }
    if (
      method === "POST" &&
      (p === "/v1/installations" ||
        p === "/v1/mobile-drafts/arm" ||
        p === "/v1/mobile-drafts")
    ) {
      await db.batch([
        db
          .prepare("INSERT OR IGNORE INTO user(id) VALUES (?)")
          .bind(session.user.id),
        db
          .prepare(
            "INSERT OR IGNORE INTO session(id,userId,expires) VALUES (?,?,?)",
          )
          .bind(
            session.session.id,
            session.user.id,
            Date.parse(session.session.expiresAt),
          ),
      ]);
      await this.schedule();
    }
    if (p === "/v1/installations" && method === "GET")
      return listInstallations(req, this.env, auth);
    if (p === "/v1/installations" && method === "POST")
      return createInstallation(req, this.env, auth);
    const id =
      /^\/v1\/installations\/([a-f0-9-]{36})(\/credentials\/rotate)?$/i.exec(p);
    if (id && method === "DELETE" && !id[2])
      return revokeInstallation(req, id[1], this.env, auth);
    if (id?.[2] && method === "POST")
      return rotateInstallationCredential(req, id[1], this.env, auth);
    const op = accountRoutes.get(p);
    if (!op || method !== "POST") throw new HTTPError(404, "not_found");
    const body = op === "arm" ? await readBoundedJSON(req.clone()) : null;
    const response = await mobileDraftAccount(req, this.env, auth, op);
    if (response.ok && body) {
      this.grants.set(body.listener, {
        token,
        installation: body.installation,
        session: session.session.id,
        until: Date.now() + 6000,
      });
      await this.schedule();
    }
    return response;
  }
}
