import { homedir } from "node:os";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { openZaloPrivateDatabase } from "../zalo-private-database.ts";
import { zaloPeriodReports } from "../zalo-period-report.ts";
import { isZaloDesktopOwner, zaloPairingEnabled } from "./zalo-official.ts";
import { PASS, type RouteHandler } from "./table.ts";

const bodySchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  schedule: z.object({
    cadence: z.enum(["hourly", "daily"]), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59),
    timeZone: z.string().min(1).max(100).refine(zone => {
      try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; }
    }),
  }).strict().nullable(),
}).strict();
export function zaloPeriodService(local: boolean, home = homedir, now: () => number = Date.now) {
  const enabled = () => local && zaloPairingEnabled() && process.env.STARTUPBOT_ZALO_LOCAL_REPORTS === "1";
  function withStore<T>(fn: (store: ReturnType<typeof zaloPeriodReports>) => T): T | null {
    const account = process.env.STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID;
    if (!enabled() || !account || !/^[A-Za-z0-9_.:-]{1,128}$/.test(account)) return null;
    let db: DatabaseSync;
    try { db = openZaloPrivateDatabase(home(), "inbox.sqlite"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    try { return fn(zaloPeriodReports(db, account, now)); } finally { db.close(); }
  }
  const route: RouteHandler = async ({ path, method, auth, req, res, readBody, json }) => {
    if (path !== "/api/zalo-official/reports") return PASS;
    res.setHeader("Cache-Control", "no-store");
    if (!enabled() || !isZaloDesktopOwner(local, auth)) return json(res, 403, { error: "pilot-unavailable" });
    try {
      if (method === "GET") return json(res, 200, { view: withStore(store => store.view()) });
      if (method !== "POST") return json(res, 405, { error: "method-not-allowed" });
      if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") return json(res, 415, { error: "json-required" });
      let body: unknown;
      try { body = await readBody(req, 2048); } catch { return json(res, 400, { error: "invalid-schedule" }); }
      const input = bodySchema.safeParse(body);
      if (!input.success) return json(res, 400, { error: "invalid-schedule" });
      if (res.destroyed) return;
      const result = withStore(store => store.configure(input.data.revision, input.data.schedule));
      return result ? json(res, 200, { view: result }) : json(res, 409, { error: "source-changed" });
    } catch { return json(res, 503, { error: "private-inbox-unavailable" }); }
  };
  return {
    route,
    next: () => { try { return withStore(store => store.next()); } catch { return null; } },
    tick: () => { try { withStore(store => store.tick()); } catch { /* The Routine clock rechecks availability on later passes. */ } },
  };
}
