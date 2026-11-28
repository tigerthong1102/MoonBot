import { z } from "zod";
import { probeZaloOfficialToken, ZaloOfficialError } from "../zalo-official.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const input = z.object({ token: z.string().min(1).max(289) }).strict();

export const isZaloDesktopOwner = (localDesktop: boolean, auth: RequestAuth) => localDesktop && auth.kind === "loopback" &&
  auth.desktopOwner === true && auth.trust !== "service" && !auth.companionDevice;
export const zaloPairingEnabled = () => process.env.STARTUPBOT_ZALO_OFFICIAL_PILOT === "1" &&
  process.env.STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT === "1";

export function createZaloOfficialRoutes(localDesktop: boolean, probe = probeZaloOfficialToken): RouteHandler {
  let busy = false;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/zalo-official/probe") return PASS;
    res.setHeader("Cache-Control", "no-store");
    if (!isZaloDesktopOwner(localDesktop, auth)) {
      return json(res, 403, { error: "desktop-owner-required" });
    }
    const enabled = process.env.STARTUPBOT_ZALO_OFFICIAL_PILOT === "1";
    if (method === "GET") return json(res, 200, { enabled, ...(zaloPairingEnabled() ? { pairingPilot: true } : {}) });
    if (method !== "POST") return json(res, 405, { error: "method-not-allowed" });
    if (!enabled) return json(res, 403, { error: "disabled" });
    if (req.headers["content-type"]?.split(";")[0].toLowerCase().trim() !== "application/json") {
      return json(res, 415, { error: "json-required" });
    }
    if (busy) return json(res, 409, { error: "probe-in-progress" });
    busy = true;
    const controller = new AbortController();
    const closed = () => controller.abort();
    res.once("close", closed);
    try {
      const body: unknown = await readBody(req, 1024);
      const parsed = input.safeParse(body);
      // readBody retains the parsed object for request observers.
      if (body && typeof body === "object" && "token" in body) delete body.token;
      if (!parsed.success) return json(res, 400, { error: "configuration" });
      const result = await probe(parsed.data.token, controller.signal);
      if (controller.signal.aborted) return;
      return json(res, 200, {
        identityVerified: true, accountId: result.accountId, accountName: result.accountName,
        webhookConfigured: result.webhookConfigured, ...("webhookError" in result ? { webhookError: result.webhookError } : {}),
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const code = error instanceof ZaloOfficialError ? error.code : "invalid-request";
      const status = code === "configuration" || code === "invalid-request" ? 400 : 502;
      return json(res, status, { error: code });
    } finally {
      res.off("close", closed);
      busy = false;
    }
  };
}
