import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { LoginSummary } from "../../shared/logins.ts";
import type { VaultProvider } from "./providers.ts";
import { personKey } from "../person-key.ts";
import { isJson } from "../routes/logins.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";

const exec = promisify(execFile);
const grantSchema = z.object({ item: z.uuid(), host: z.hostname(), bots: z.array(z.string().regex(/^[\w-]{1,128}$/)).min(1).max(100),
  session: z.string().min(1).max(4096) }).strict();
const response = z.object({ id: z.uuid(), type: z.literal(1), login: z.object({
  username: z.string().max(512), password: z.string().min(1).max(4096), uris: z.array(z.object({ uri: z.string().nullable() })).nullable(),
}) });

async function readItem(binary: string, item: string, session: string) {
  if (!isAbsolute(binary)) throw new Error("Configure an absolute path to the Bitwarden CLI.");
  // Adapted from agent/vault_backends/bitwarden.py (Nous Research, MIT). Only the child gets the session.
  const env: NodeJS.ProcessEnv = { BW_SESSION: session, NO_COLOR: "1" };
  for (const key of ["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot", "TMPDIR", "TMP", "TEMP", "XDG_CONFIG_HOME", "BITWARDENCLI_APPDATA_DIR"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  try {
    await exec(binary, ["sync", "--nointeraction"], { env, timeout: 15_000, maxBuffer: 256_000, windowsHide: true });
    const { stdout } = await exec(binary, ["get", "item", item, "--nointeraction"], { env, timeout: 15_000, maxBuffer: 256_000, windowsHide: true });
    return response.parse(JSON.parse(stdout));
  } catch { throw new Error("Bitwarden could not read this login. Check the item and unlock session."); }
}

function itemMatches(item: z.infer<typeof response>, id: string, host: string) {
  return item.id === id && item.login.uris?.some(({ uri }) => {
    try {
      const url = new URL(uri ?? "");
      return url.protocol === "https:" && !url.port && !url.username && !url.password && url.hostname === host;
    } catch { return false; }
  });
}

export class BitwardenLogins implements VaultProvider {
  readonly id = "bitwarden";
  readonly label = "Bitwarden";
  private readonly grants = new Map<string, { login: LoginSummary; session: string; until: number }>();
  private readonly operations = new Map<string, object>();
  private readonly binary: string;
  private readonly get: typeof readItem;
  constructor(binary: string, get = readItem) { this.binary = binary; this.get = get; }
  async fresh() {
    for (const [id, grant] of this.grants) if (grant.until <= Date.now()) this.grants.delete(id);
  }
  items() {
    return [...this.grants.values()].filter(grant => grant.until > Date.now()).map(({ login }) => ({ ...login, kind: "login" as const }));
  }
  markUsed(id: string) {
    const login = this.grants.get(id)?.login;
    if (login) login.lastUsedAt = Date.now();
  }
  async read(id: string) {
    const grant = this.grants.get(id);
    if (!grant || grant.until <= Date.now()) throw new Error("Bitwarden grant expired.");
    const item = await this.get(this.binary, id.slice(3), grant.session);
    if (this.grants.get(id) !== grant || grant.until <= Date.now() || !itemMatches(item, id.slice(3), grant.login.hosts[0]!) || item.login.username !== grant.login.username)
      throw new Error("The Bitwarden login or its grant changed.");
    return { password: item.login.password };
  }
  private async grant(input: z.infer<typeof grantSchema>) {
    const id = "bw:" + input.item, op = {};
    this.operations.set(id, op);
    try {
      const item = await this.get(this.binary, input.item, input.session);
      const host = input.host.toLowerCase();
      if (!itemMatches(item, input.item, host) || this.operations.get(id) !== op) throw new Error("Bitwarden item or grant changed.");
      this.grants.set(id, { session: input.session, until: Date.now() + 3_600_000, login: { id, site: host, hosts: [host], exactHost: true,
        username: item.login.username, bots: [...new Set(input.bots)], source: "bitwarden", hasTotp: false, createdAt: Date.now() } });
    } finally { if (this.operations.get(id) === op) this.operations.delete(id); }
  }
  routes(botExists: (id: string) => boolean): RouteHandler {
    return async ({ req, res, auth, path, method, readBody, json }) => {
      if (path !== "/api/vault/bitwarden") return PASS;
      res.setHeader("cache-control", "no-store");
      if (!auth.scopes.includes("admin")) return json(res, 403, { error: "An administrator manages Bitwarden grants." });
      if (method === "GET") return json(res, 200, { enabled: !!this.binary, logins: this.items() });
      if (!this.binary) return json(res, 409, { error: "Bitwarden CLI is not configured." });
      if (!isJson(req)) return json(res, 415, { error: "Send JSON." });
      const body = await readBody(req, 20_000);
      const actor = auth.kind === "session" ? personKey(auth.session) : "local-owner";
      if (method === "DELETE") {
        const parsed = z.object({ item: z.uuid() }).strict().safeParse(body);
        if (!parsed.success) return json(res, 400, { error: "Invalid item ID." });
        const id = "bw:" + parsed.data.item;
        this.operations.delete(id); this.grants.delete(id);
        console.info("Bitwarden grant revoked", actor, id);
      } else if (method === "POST") {
        const parsed = grantSchema.safeParse(body);
        if (!parsed.success || !parsed.data.bots.every(botExists)) return json(res, 400, { error: "Invalid item, site, session or bot selection." });
        try { await this.grant(parsed.data); }
        catch { return json(res, 422, { error: "Check the unlock session, item and exact HTTPS sign-in host." }); }
        console.info("Bitwarden grant created", actor, parsed.data.item, parsed.data.bots);
      } else return json(res, 405, { error: "Method not allowed." });
      return json(res, 200, { ok: true });
    };
  }
}
