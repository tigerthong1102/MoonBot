import { browserRecord } from "@/lib/browser-records";
import { randomUuid } from "@/lib/random-uuid";
import { cloudAsleep } from "@/lib/cloud-power";
import { api, apiFetch, ApiError } from "@/state/api";
import { libraryOwner, readLibrary } from "./source-cache";
import { accepts, indexSources, scanFolder, type Directory, type Index, type SourceFile } from "./source-index";

export type FolderSource = { kind: "directory"; name: string; handle: Directory } | { kind: "cloud"; name: string; id: string };
type Watch = { id: string; key: string; source: FolderSource; scanId?: string };
const syncEvent = "startupbot-document-sync";
export function onSourceSync(key: string, listener: (background: boolean) => void) {
  const changed = (event: Event) => {
    const detail = (event as CustomEvent<string | { key: string; background: boolean }>).detail;
    if (typeof detail === "string") { if (detail === key) listener(false); }
    else if (detail?.key === key) listener(detail.background);
  };
  window.addEventListener(syncEvent, changed);
  return () => window.removeEventListener(syncEvent, changed);
}

export function readWatch(key: string): Promise<Watch | undefined> {
  return browserRecord("readonly", store => store.get("watch:" + key));
}

export async function setSource(key: string, index: Index, source: FolderSource | null) {
  await browserRecord("readwrite", store => {
    if (source) store.put({ id: randomUuid(), key, source } satisfies Watch, "watch:" + key);
    else store.delete("watch:" + key);
    return store.put(index, key);
  });
  window.dispatchEvent(new CustomEvent(syncEvent, { detail: key }));
}

type SourceRead = { background?: boolean; signal?: AbortSignal };
type CloudFile = { path: string; size: number; sha256: string };
export async function cloudFolders() {
  const { folders } = await api<{ folders: { id: string; kind: string; threadId?: string; cloudPath: string }[] }>("/api/sync");
  return folders.filter(f => /^[\w-]{1,200}$/.test(f.id)).map(f => ({ id: f.id, name: f.cloudPath.split(/[\\/]/).filter(Boolean).at(-1) ?? f.id, threadId: f.threadId }));
}

async function cloudFiles(folder: Extract<FolderSource, { kind: "cloud" }>, previous: Index, read: SourceRead): Promise<SourceFile[]> {
  const url = "/api/sync/folders/" + encodeURIComponent(folder.id);
  const list = await api<{ files: CloudFile[] }>(url + "/files", { ...read, timeoutMs: 30_000 });
  const files = list.files.filter(f => accepts.test(f.path));
  if (files.length > 300 || files.reduce((bytes, f) => bytes + f.size, 0) > 16 * 1024 * 1024) throw new Error("library limit");
  const result: SourceFile[] = [];
  for (const entry of files) {
    const path = folder.name + "/" + entry.path;
    const known = previous.docs.get(path);
    if (known && known.digest === entry.sha256) { result.push({ path, file: known.file }); continue; }
    const response = await apiFetch(url + "/file?path=" + encodeURIComponent(entry.path), { ...read, credentials: "same-origin", timeoutMs: 30_000 });
    if (response.status === 401 || response.status === 403) throw new ApiError("source unavailable", response.status);
    if (!response.ok || response.headers.get("content-length") !== String(entry.size)) { result.push({ path }); continue; }
    const blob = await response.blob();
    if (blob.size !== entry.size) { result.push({ path }); continue; }
    result.push({ path, file: new File([blob], entry.path.split("/").at(-1)!) });
  }
  return result;
}

export function readSource(source: FolderSource, previous: Index, read: SourceRead = {}) {
  return source.kind === "cloud" ? cloudFiles(source, previous, read) : scanFolder(source.handle);
}

export async function scanSource(source: FolderSource, old: Index, read: SourceRead = {}): Promise<Index> {
  let index: Index;
  try { index = await indexSources(await readSource(source, old, read), old); }
  catch (error) {
    if (read.signal?.aborted || (error instanceof ApiError && error.status === 503 && error.body?.error === "asleep")) throw error;
    const status = error instanceof ApiError ? error.status : null;
    const issue = status === 401 || status === 403 ? "signedOut" : status === 404 || status === 410 ? "missing" :
      source.kind === "cloud" && (status === 503 || error instanceof TypeError) ? "offline" : "folder";
    index = { docs: new Map(), changes: [{ path: source.name, state: "error", issue }] };
  }
  const now = Date.now();
  const newChanges = index.changes.filter(c => c.state !== "error" || old.changes.findLast(p => p.path === c.path)?.state !== "error");
  index.changes = [...old.changes, ...newChanges.map(c => ({ ...c, at: now }))].slice(-300);
  return index;
}

export async function syncSource(watch: Watch, read: SourceRead = {}) {
  const slot = "watch:" + watch.key, scanId = randomUuid();
  const claimed = await browserRecord<Watch | undefined>("readwrite", store => {
    const request = store.get(slot);
    request.onsuccess = () => {
      if (request.result?.id === watch.id) store.put({ ...request.result, scanId }, slot);
    };
    return request;
  });
  if (claimed?.id !== watch.id) return;
  const old = await readLibrary(watch.key) ?? { docs: new Map(), changes: [] };
  const index = await scanSource(watch.source, old, read);
  read.signal?.throwIfAborted();
  let committed: IDBRequest<Index | undefined> | undefined;
  const latest = await browserRecord<Watch | undefined>("readwrite", store => {
    const request = store.get(slot);
    request.onsuccess = () => {
      const record: Watch | undefined = request.result;
      if (record?.id !== watch.id) return;
      if (record.scanId === scanId) {
        store.put(index, watch.key);
        store.put({ ...record, scanId: undefined }, slot);
      } else if (!record.scanId) committed = store.get(watch.key);
    };
    return request;
  });
  if (latest?.id !== watch.id || latest.scanId !== scanId) return committed?.result;
  window.dispatchEvent(new CustomEvent(syncEvent, { detail: { key: watch.key, background: !!read.background } }));
  return index;
}

/** A previously authorized folder may no longer be readable. Recheck it before revealing a saved snapshot. */
export async function currentLibrary(key: string) {
  let manual: IDBRequest<Index | undefined> | undefined;
  const watch = await browserRecord<Watch | undefined>("readonly", store => {
    const request = store.get("watch:" + key);
    request.onsuccess = () => { if (!request.result) manual = store.get(key); };
    return request;
  });
  return watch ? syncSource(watch) : manual?.result;
}

export function watchDocumentSources() {
  const controller = new AbortController();
  const read = { background: true, signal: controller.signal };
  let running = false;
  async function tick() {
    if (running || read.signal.aborted || cloudAsleep() || document.hidden || !globalThis.indexedDB) return;
    running = true;
    try {
      const all: IDBValidKey[] = await browserRecord("readonly", store => store.getAllKeys(IDBKeyRange.bound("watch:", "watch;")));
      if (!all.length || read.signal.aborted) return;
      const owner = await libraryOwner((input, init) => apiFetch(input, { ...init, ...read, timeoutMs: 30_000 }));
      if (!owner) return;
      for (const slot of all) {
        if (read.signal.aborted || cloudAsleep()) break;
        const key = String(slot).slice("watch:".length);
        if (JSON.parse(key)[0] !== owner) continue;
        const watch = await readWatch(key);
        if (watch && !read.signal.aborted) await syncSource(watch, read);
      }
    } catch {}
    finally { running = false; }
  }
  const timer = window.setInterval(() => void tick(), 60_000);
  void tick();
  return () => { controller.abort(); window.clearInterval(timer); };
}
