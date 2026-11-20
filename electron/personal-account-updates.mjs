import { UPDATES_CONSENT_VERSION } from "./updates-consent.mjs";

export function personalAccountUpdates({ account, origin, deviceChoice, previousChoice }) {
  async function request(base, data) {
    const response = await account().fetch(base + "/api/account/updates", {
      credentials: "include", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000),
      ...(data && { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify(data) }),
    });
    if (response.status === 401 && !data) return null;
    if (!response.ok) throw Error("StartupBot account settings unavailable");
    return response.json();
  }
  function saved(email) {
    try {
      const choice = deviceChoice().read();
      if (typeof choice === "boolean") return choice;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const old = previousChoice();
    if (!old || (old.email && old.email !== email) || (old.account && !old.email)) return null;
    return old.status === "opted_in";
  }
  return async function updates(choice) {
    const base = origin();
    if (!base) throw Error("StartupBot account settings unavailable");
    let profile = (await account().cookies.get({ url: base })).length ? await request(base) : null;
    let enabled = profile?.enabled;
    if (typeof choice === "boolean") {
      if (profile) profile = await request(base, { email: profile.email, enabled: choice });
      else deviceChoice().write(choice);
      enabled = choice;
    } else if (enabled == null) {
      const prior = saved(profile?.email);
      if (profile && prior !== null) profile = await request(base, { email: profile.email, enabled: prior, initial: true });
      enabled = profile?.enabled ?? prior ?? true;
    }
    return { available: true, due: false, status: enabled ? "opted_in" : "withdrawn", signedIn: !!profile,
      email: profile?.email ?? null, version: UPDATES_CONSENT_VERSION };
  };
}
