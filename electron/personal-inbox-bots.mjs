import path from "node:path";
import { randomUUID } from "node:crypto";
import { app, Menu } from "electron";
import { jsonFile } from "./desktop-prefs.mjs";
import { startupBotDataDir } from "./startupbot-identity.mjs";
import { inboxBotLabel } from "./inbox-bot-label.mjs";

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export function personalInboxBots(window, page, origin) {
  const workspace = window.webContents;
  const localOrigin = new URL(workspace.getURL()).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(localOrigin)) return null;
  const data = startupBotDataDir(app.getPath("home"), process.env.OMB_DATA_DIR);
  const file = jsonFile(path.join(data, "personal-inbox-bots.json"));
  function bindings() {
    try {
      return file.read();
    } catch (e) {
      if (e.code === "ENOENT") return {};
      throw e;
    }
  }
  function current() {
    return (
      !page.isDestroyed() &&
      !workspace.isDestroyed() &&
      new URL(workspace.getURL()).origin === localOrigin
    );
  }
  async function local(input) {
    if (!current()) throw Error("workspace_closed");
    const init = input
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      : {};
    return workspace.executeJavaScript(
      `(async()=>{if(location.origin!==${JSON.stringify(localOrigin)}) throw Error("workspace_closed");const r=await fetch("/api/personal-inbox/bots",${JSON.stringify(init)});if(!r.ok)throw Error("unavailable");return r.json()})()`,
    );
  }
  async function cloud(endpoint, input) {
    if (!current()) throw Error("workspace_closed");
    const response = await page.session.fetch(origin + "/api/" + endpoint, {
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12000),
      ...(input
        ? {
            method: "POST",
            headers: { Origin: origin, "Content-Type": "application/json" },
            body: JSON.stringify(input),
          }
        : {}),
    });
    if (!response.ok) throw Error("unavailable");
    return response.json();
  }
  function report(type) {
    if (current())
      void page
        .executeJavaScript(
          "window.dispatchEvent(new Event(" + JSON.stringify(type) + "))",
        )
        .catch(() => {});
  }
  async function invite(room) {
    if (!uuid.test(room)) return;
    const [me, inventory] = await Promise.all([cloud("me"), local()]);
    const saved = bindings();
    const choices = inventory.bots.filter(
      (b) =>
        !saved[b.id] ||
        (saved[b.id].owner === me.id && saved[b.id].origin === origin),
    );
    if (!choices.length) {
      report("inbox-bots-empty");
      return;
    }
    async function pick(bot) {
      if ((await cloud("me")).id !== me.id) throw Error("account_changed");
      const records = bindings(),
        record = records[bot.id] ?? { id: randomUUID(), owner: me.id, origin };
      if (record.owner !== me.id || record.origin !== origin)
        throw Error("account_changed");
      records[bot.id] = record;
      file.write(records);
      await cloud("rooms/" + room + "/bots", {
        action: "invite",
        bot: record.id,
        name: bot.name,
        ...(bot.username ? { username: bot.username } : {}),
        owner: me.id,
      });
      report("inbox-bots-changed");
    }
    Menu.buildFromTemplate(
      choices.map((bot) => ({
        label: inboxBotLabel(bot),
        click: () => {
          void pick(bot).catch(() => report("inbox-bots-error"));
        },
      })),
    ).popup({ window });
  }
  let busy = false;
  async function poll() {
    if (busy || !current()) return;
    const records = Object.entries(bindings()).filter(
      ([, b]) => b.origin === origin,
    );
    if (!records.length) return;
    busy = true;
    try {
      const { jobs } = await cloud("bot-turns");
      for (const { bot, room } of jobs) {
        const entry = records.find(([, b]) => b.id === bot);
        if (!entry || !uuid.test(room)) continue;
        const { job } = await cloud("rooms/" + room + "/bots", {
          action: "claim",
          bot,
        });
        if (!job) continue;
        let text = null;
        try {
          const reply = await local({
            id: entry[0],
            topic: job.topic,
            prior: job.prior,
            locale: job.locale,
          });
          text = reply.text || null;
        } finally {
          await cloud("rooms/" + room + "/bots", {
            action: "reply",
            bot,
            round: job.id,
            claim: job.claim,
            text,
          });
        }
      }
    } finally {
      busy = false;
    }
  }
  const timer = setInterval(() => {
    void poll().catch(() => {});
  }, 8000);
  page.once("destroyed", () => clearInterval(timer));
  return {
    invite: (room) => {
      void invite(room).catch(() => report("inbox-bots-error"));
    },
  };
}
