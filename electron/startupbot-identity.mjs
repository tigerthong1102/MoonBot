import path from "node:path";

export const startupBotUserDataDir = appData => path.join(appData, "StartupBot");

export function configureStartupBotIdentity(app) {
  const profile = app.commandLine?.getSwitchValue("user-data-dir");
  if (profile && !path.isAbsolute(profile)) throw new Error("The Electron user-data-dir must be absolute");
  app.setName("StartupBot");
  app.setPath("userData", profile || startupBotUserDataDir(app.getPath("appData")));
  if (profile) app.setAppLogsPath?.(path.join(profile, "logs"));
}

export function startupBotDataDir(home, override) {
  return override || path.join(home, ".startupbot");
}

export function packagedSmokeHome(env) {
  if (env.OMB_SMOKE_TEST !== "1" || !env.OMB_SMOKE_HOME) return {};
  if (!path.isAbsolute(env.OMB_SMOKE_HOME)) throw new Error("The package smoke home must be absolute");
  return { HOME: env.OMB_SMOKE_HOME, USERPROFILE: env.OMB_SMOKE_HOME };
}

export function internalDeepLink(value) {
  return typeof value === "string" && value.toLowerCase().startsWith("startupbot://") ? `openmausbot://${value.slice("startupbot://".length)}` : value;
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
