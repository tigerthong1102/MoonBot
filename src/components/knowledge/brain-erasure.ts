import { apiFetch } from "@/state/api";
import { browserRecord } from "@/lib/browser-records";
import { libraryOwner } from "./source-cache";
import type { BrainPage } from "./brain";

const channelName = "startupbot-brain-pages";
let localChannel: BroadcastChannel | undefined;
const listeners = new Set<() => void>();

export function watchBrainPages(refresh: () => void) {
  if (typeof window.BroadcastChannel !== "function") return () => {};
  localChannel ??= new BroadcastChannel(channelName);
  listeners.add(refresh);
  localChannel.onmessage = () => { for (const listener of listeners) listener(); };
  return () => {
    listeners.delete(refresh);
    if (!listeners.size) { localChannel?.close(); localChannel = undefined; }
  };
}

export function announceBrainChange() {
  if (typeof window.BroadcastChannel !== "function") return;
  const channel = localChannel ?? new BroadcastChannel(channelName);
  channel.postMessage(null);
  if (!localChannel) channel.close();
}

function pageRange(owner: string, id?: string) {
  const prefix = id === undefined ? ["brain", owner] : ["brain", owner, id];
  return IDBKeyRange.bound(prefix, [...prefix, []]);
}

export async function withCurrentBrainPage<T>(page: BrainPage, signal: AbortSignal, action: (current: BrainPage) => T): Promise<T> {
  let checked: Promise<unknown>;
  const actionResult = new Promise<T>((resolve, reject) => {
    checked = browserRecord("readonly", store => {
      const request = store.openCursor(pageRange(page.owner, page.id), "prev");
      request.onsuccess = () => {
        const current = request.result?.value as BrainPage | undefined;
        if (signal.aborted || current?.id !== page.id || current.owner !== page.owner || current.version !== page.version ||
          current.approvedAt !== page.approvedAt || !current.source) {
          reject(new Error("page_changed"));
          return;
        }
        try { resolve(action(current)); }
        catch (error) { reject(error); }
      };
      return request;
    });
  });
  const [, value] = await Promise.all([checked!, actionResult]);
  return value;
}

export async function forgetBrainPages(owner: string, page: Pick<BrainPage, "id" | "version"> | null, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!owner || await libraryOwner((input, init) => apiFetch(input, { ...init, signal, timeoutMs: 30000 }), true, true) !== owner) {
    throw new Error("viewer_changed");
  }
  let matched = !page;
  let transaction: IDBTransaction | undefined;
  const cancel = () => {
    try { transaction?.abort(); }
    catch (error) { if (!(error instanceof DOMException && error.name === "InvalidStateError")) throw error; }
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await browserRecord("readwrite", store => {
      signal.throwIfAborted();
      transaction = store.transaction;
      const request = store.getAllKeys(pageRange(owner, page?.id));
      request.onsuccess = () => {
        if (signal.aborted) { store.transaction.abort(); return; }
        const versions = new Map<string, number[]>();
        for (const key of request.result) {
          if (!Array.isArray(key) || typeof key[2] !== "string" || typeof key[3] !== "number") continue;
          const existing = versions.get(key[2]);
          if (existing) existing.push(key[3]);
          else versions.set(key[2], [key[3]]);
        }
        for (const [id, saved] of versions) {
          const latest = saved.at(-1)!;
          if (saved[0] === 0 || (page && latest !== page.version)) continue;
          matched = true;
          // Existing clients add the next numbered revision without first checking whether the page still exists.
          const marker = { id, version: 0, forgotten: true };
          for (const version of [0, ...saved, latest + 1]) store.put(marker, ["brain", owner, id, version]);
        }
      };
      return request;
    });
  } finally {
    signal.removeEventListener("abort", cancel);
  }
  if (!matched) throw new Error("page_changed");
  announceBrainChange();
}
