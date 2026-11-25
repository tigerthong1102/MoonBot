import { z } from "zod";
import type { SideJobs } from "../side-jobs.ts";
import { PASS, type RouteHandler } from "./table.ts";
import { redactSecretsInText } from "../../shared/redact.ts";
import { botUsername } from "../../shared/bot-username.ts";

interface InboxBot {
  id: string;
  name: string;
  hidden?: boolean;
}
interface Deps {
  desktop: boolean;
  bots(): InboxBot[];
  held(id: string): boolean;
  jobs: SideJobs;
}
const request = z.object({
  id: z.string().max(160),
  topic: z.string().min(1).max(1800),
  prior: z.string().max(2400).nullable(),
  locale: z.string().max(20),
});

export function inboxBotTextRoutes(deps: Deps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/personal-inbox/bots") return PASS;
    if (
      !deps.desktop ||
      auth.kind !== "loopback" ||
      auth.trust === "service" ||
      auth.companionDevice
    )
      return void json(res, 403, { error: "unavailable" });
    const bots = deps.bots().filter((b) => !b.hidden && !deps.held(b.id));
    if (method === "GET")
      return void json(res, 200, {
        bots: bots
          .filter((b) => deps.jobs.text("inbox-discussion", b.id))
          .map((b) => ({ id: b.id, name: b.name, username: botUsername(b.id) })),
      });
    if (method !== "POST")
      return void json(res, 405, { error: "method_not_allowed" });
    const parsed = request.safeParse(
      await readBody(req, 16384).catch(() => null),
    );
    if (!parsed.success)
      return void json(res, 400, { error: "invalid_request" });
    const { id, topic, prior, locale } = parsed.data;
    const bot = bots.find((b) => b.id === id);
    const writer = bot && deps.jobs.text("inbox-discussion", id);
    if (!writer || !bot) return void json(res, 404, { error: "unavailable" });
    const prompt = [
      "Write one short reply for the shared discussion. Write in the requested language. Reply to the topic and, if present, the other bot's reply. Do not claim to have performed actions.",
      prior ? "You are the second speaker. Build on the first speaker’s concrete answer." : "You are the first speaker. Give a concrete answer to the topic.",
      JSON.stringify({
        name: bot.name,
        language: locale,
        topic,
        previousReply: prior,
      }),
    ].join("\n");
    const result = await writer.generateText(prompt, { timeoutMs: 60_000 });
    return void json(res, 200, {
      text: redactSecretsInText(result.trim().slice(0, 2400)),
    });
  };
}
