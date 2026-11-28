import { homedir } from "node:os";
import { z } from "zod";
import { ZALO_PRIVATE_KNOWLEDGE_PATH } from "../../shared/zalo-knowledge-bookmarks.ts";
import { DATA_DIR } from "../config.ts";
import { loadEnvironmentId } from "../environment.ts";
import { zaloKnowledgeBookmarks } from "../zalo-knowledge-bookmarks.ts";
import { openZaloPrivateDatabase } from "../zalo-private-database.ts";
import { isZaloDesktopOwner, zaloPairingEnabled } from "./zalo-official.ts";
import { PASS, type RouteHandler } from "./table.ts";

const choice = z
  .object({
    grantId: z.uuid(),
    sourceId: z.string().min(1).max(256),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    save: z.boolean(),
    reviewed: z.literal(true),
  })
  .strict();

export function createZaloKnowledgeRoutes(
  local: boolean,
  home = homedir,
  workspaceId = () => loadEnvironmentId(DATA_DIR),
): RouteHandler {
  return async ({ req, res, path, method, auth, readBody, json, url }) => {
    if (path !== ZALO_PRIVATE_KNOWLEDGE_PATH) return PASS;
    res.setHeader("Cache-Control", "private, no-store");
    if (!isZaloDesktopOwner(local, auth)) return json(res, 403, { error: "desktop-owner-required" });
    const account = process.env.STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID;
    // The private inbox is outside the workspace backup. Its operator pins the intended local workspace explicitly.
    const enabled = () =>
      zaloPairingEnabled() &&
      process.env.STARTUPBOT_ZALO_PRIVATE_KNOWLEDGE === "1" &&
      !!account &&
      process.env.STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID === account &&
      process.env.STARTUPBOT_ZALO_KNOWLEDGE_WORKSPACE === workspaceId();
    if (method === "GET" && url.searchParams.get("capability") === "1") return json(res, 200, { enabled: enabled() });
    if (!enabled() || !account) return json(res, 403, { error: "disabled" });
    if (method !== "GET" && method !== "POST") return json(res, 405, { error: "method-not-allowed" });
    let input: z.infer<typeof choice> | undefined;
    if (method === "POST") {
      if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json")
        return json(res, 415, { error: "json-required" });
      try {
        const parsed = choice.safeParse(await readBody(req, 2048));
        if (!parsed.success) return json(res, 400, { error: "invalid-choice" });
        input = parsed.data;
      } catch {
        return json(res, 400, { error: "invalid-choice" });
      }
    }
    if (res.destroyed) return;
    if (!enabled()) return json(res, 403, { error: "disabled" });
    let db;
    try {
      db = openZaloPrivateDatabase(home(), "inbox.sqlite");
      const store = zaloKnowledgeBookmarks(db, account, workspaceId());
      if (input && !store.choose(input)) return json(res, 409, { error: "source-changed" });
      return json(res, 200, { items: store.list() });
    } catch {
      return json(res, 503, { error: "private-inbox-unavailable" });
    } finally {
      db?.close();
    }
  };
}
