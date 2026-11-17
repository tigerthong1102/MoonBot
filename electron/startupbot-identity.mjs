import path from "node:path";

export function configureStartupBotIdentity(app) {
  app.setName("StartupBot");
  app.setPath("userData", path.join(app.getPath("appData"), "StartupBot"));
}

export function startupBotDataDir(home, override) {
  return override || path.join(home, ".startupbot");
}

export function internalDeepLink(value) {
  return typeof value === "string" && value.startsWith("startupbot://") ? `openmausbot://${value.slice("startupbot://".length)}` : value;
}

export function queueIncomingChatLink(rawLink, { parse, store, reveal, deliver }) {
  const link = parse(rawLink);
  if (!link) return false;
  store(link);
  reveal();
  deliver();
  return true;
}

export async function unavailableStartupBotCloud() {
  throw new Error("StartupBot Cloud is not configured");
}
