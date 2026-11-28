import { draftKeys, unsealDraft } from "./mobile-desktop-envelope.mjs";
import { companionAccountCleanupPending, storedAccount } from "./companion-account-documents.mjs";

const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

export function createMobileDraftReceiver({ credentials, client, allowed }) {
  let active;
  function accountNow() {
    const document = credentials();
    return companionAccountCleanupPending(document) ? null : storedAccount(document);
  }
  function current(entry) {
    const account = accountNow();
    return (
      active === entry &&
      allowed(entry.sender) &&
      account?.userId === entry.owner &&
      account.installationCredential === entry.credential
    );
  }
  function close(entry) {
    if (active !== entry) return;
    active = undefined;
    clearTimeout(entry.timer);
    for (const event of ["destroyed", "did-start-navigation", "render-process-gone"]) {
      entry.sender.removeListener(event, entry.stop);
    }
    void Promise.resolve(entry.request)
      .catch(() => {})
      .then(() =>
        entry.client.mobileDesktopDraft(
          entry.credential,
          { action: "close", listener: entry.listener },
          "device",
        ),
      )
      .catch(() => {});
  }
  function refresh(entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(entry.stop, 6000);
    entry.timer.unref?.();
  }
  return async (sender, action, listener, id) => {
    if (!uuid.test(listener)) throw Error("invalid_listener");
    if (action === "open") {
      if (!allowed(sender)) throw Error("unavailable");
      const account = accountNow();
      if (!account?.accountToken || !account.installationId || !account.installationCredential) throw Error("signed_out");
      if (active) close(active);
      const entry = {
        sender,
        listener,
        owner: account.userId,
        credential: account.installationCredential,
        keys: draftKeys(),
        client: client(),
        stop: () => close(entry),
      };
      active = entry;
      for (const event of ["destroyed", "did-start-navigation", "render-process-gone"])
        sender.once(event, entry.stop);
      refresh(entry);
      try {
        const keys = await entry.keys;
        if (!current(entry)) throw Error("unavailable");
        entry.request = entry.client.mobileDesktopDraft(account.accountToken, {
          installation: account.installationId, listener, publicKey: keys.publicKey,
        }, "arm");
        await entry.request;
        if (!current(entry)) throw Error("unavailable");
      } catch (error) {
        close(entry);
        throw error;
      }
      return null;
    }
    const entry = active;
    if (!entry || entry.listener !== listener || entry.sender !== sender) {
      if (action === "close") return null;
      throw Error("unavailable");
    }
    if (action === "close") {
      close(entry);
      return null;
    }
    if (!current(entry)) {
      close(entry);
      throw Error("signed_out");
    }
    if (action === "ack") {
      if (!uuid.test(id) || entry.claim !== id) throw Error("invalid_receipt");
      entry.request = entry.client.mobileDesktopDraft(entry.credential, { action, listener, id }, "device");
      const receipt = await entry.request;
      if (!receipt.ok) throw Error("expired");
      return null;
    }
    if (action !== "poll") throw Error("invalid_request");
    const keys = await entry.keys;
    if (!current(entry)) throw Error("unavailable");
    refresh(entry);
    entry.request = entry.client.mobileDesktopDraft(
      entry.credential,
      { action, listener, publicKey: keys.publicKey },
      "device",
    );
    const { draft } = await entry.request;
    if (!current(entry)) throw Error("unavailable");
    if (!draft || draft.expires <= Date.now() || !uuid.test(draft.id)) return null;
    const prompt = await unsealDraft(draft.envelope, keys.privateKey, draft.id, listener);
    if (!current(entry) || draft.expires <= Date.now()) return null;
    entry.claim = draft.id;
    return { id: draft.id, prompt, expires: draft.expires };
  };
}
