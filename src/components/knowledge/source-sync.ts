import { browserRecord } from "@/lib/browser-records";
import { api, ApiError } from "@/state/api";
import { libraryOwner, readLibrary } from "./source-cache";
import { accepts, indexSources, scanFolder, type Directory, type Index, type SourceFile } from "./source-index";

export type FolderSource = { kind: "directory"; name: string; handle: Directory } | { kind: "cloud"; name: string; id: string };
type Watch = { id: string; key: string; source: FolderSource };
const syncEvent = "startupbot-document-sync";
export function onSourceSync(key: string, listener: () => void) {
  const changed = (event: Event) => { if ((event as CustomEvent).detail === key) listener(); };
  window.addEventListener(syncEvent, changed);
  return () => window.removeEventListener(syncEvent, changed);
}

export function readWatch(key: string): Promise<Watch | undefined> {
  return browserRecord("readonly", store => store.get("watch:" + key));
}

export async function setSource(key: string, index: Index, source: FolderSource | null) {
  await browserRecord("readwrite", store => {
    if (source) store.put({ id: crypto.randomUUID(), key, source } satisfies Watch, "watch:" + key);
    else store.delete("watch:" + key);
    return store.put(index, key);
  });
  window.dispatchEvent(new CustomEvent(syncEvent, { detail: key }));
}

type CloudFile = { path: string; size: number; sha256: string };
export async function cloudFolders() {
  const { folders } = await api<{ folders: { id: string; kind: string; threadId?: string; cloudPath: string }[] }>("/api/sync");
  return folders.filter(f => /^[\w-]{1,200}$/.test(f.id)).map(f => ({ id: f.id, name: f.cloudPath.split(/[\\/]/).filter(Boolean).at(-1) ?? f.id, threadId: f.threadId }));
}

async function cloudFiles(folder: Extract<FolderSource, { kind: "cloud" }>, previous: Index): Promise<SourceFile[]> {
  const url = "/api/sync/folders/" + encodeURIComponent(folder.id);
  const list = await api<{ files: CloudFile[] }>(url + "/files", { background: true, timeoutMs: 30_000 });
  const files = list.files.filter(f => accepts.test(f.path));
  if (files.length > 300 || files.reduce((bytes, f) => bytes + f.size, 0) > 16 * 1024 * 1024) throw new Error("library limit");
  const result: SourceFile[] = [];
  for (const entry of files) {
    const path = folder.name + "/" + entry.path;
    const known = previous.docs.get(path);
    if (known && known.digest === entry.sha256) { result.push({ path, file: known.file }); continue; }
    const response = await fetch(url + "/file?path=" + encodeURIComponent(entry.path), { credentials: "same-origin", signal: AbortSignal.timeout(30_000) });
    if (response.status === 401 || response.status === 403) throw new ApiError("source unavailable", response.status);
    if (!response.ok || response.headers.get("content-length") !== String(entry.size)) { result.push({ path }); continue; }
    const blob = await response.blob();
    if (blob.size !== entry.size) { result.push({ path }); continue; }
    result.push({ path, file: new File([blob], entry.path.split("/").at(-1)!) });
  }
  return result;
}

export function readSource(source: FolderSource, previous: Index) {
  return source.kind === "cloud" ? cloudFiles(source, previous) : scanFolder(source.handle);
}

export async function syncSource(watch: Watch) {
  const old = await readLibrary(watch.key) ?? { docs: new Map(), changes: [] };
  let index: Index;
  try { index = await indexSources(await readSource(watch.source, old), old); }
  catch (error) {
    const status = error instanceof ApiError ? error.status : null;
    const issue = status === 401 || status === 403 ? "signedOut" : status === 404 || status === 410 ? "missing" :
      watch.source.kind === "cloud" && (status === 503 || error instanceof TypeError) ? "offline" : "folder";
    index = { docs: new Map(), changes: [{ path: watch.source.name, state: "error", issue }] };
  }
  const now = Date.now();
  const newChanges = index.changes.filter(c => c.state !== "error" || old.changes.findLast(p => p.path === c.path)?.state !== "error");
  index.changes = [...old.changes, ...newChanges.map(c => ({ ...c, at: now }))].slice(-300);
  // A picker or another window may have removed or replaced this source during a read.
  await browserRecord("readwrite", store => {
    const request = store.get("watch:" + watch.key);
    request.onsuccess = () => { if (request.result?.id === watch.id) store.put(index, watch.key); };
    return request;
  });
  window.dispatchEvent(new CustomEvent(syncEvent, { detail: watch.key }));
}

/** A previously authorized folder may no longer be readable. Recheck it before revealing a saved snapshot. */
export async function currentLibrary(key: string) {
  const watch = await readWatch(key);
  if (watch) await syncSource(watch);
  return readLibrary(key);
}

export function watchDocumentSources() {
  let active = true, running = false;
  async function tick() {
    if (running || !active || document.hidden || !globalThis.indexedDB) return;
    running = true;
    try {
      const all: IDBValidKey[] = await browserRecord("readonly", store => store.getAllKeys(IDBKeyRange.bound("watch:", "watch;")));
      if (!all.length || !active) return;
      const owner = await libraryOwner();
      if (!owner) return;
      for (const slot of all) {
        if (!active) break;
        const key = String(slot).slice("watch:".length);
        if (JSON.parse(key)[0] !== owner) continue;
        const watch = await readWatch(key);
        if (watch && active) await syncSource(watch);
      }
    } catch { /* Storage may be disabled. A manual source remains available in the open panel. */ }
    finally { running = false; }
  }
  const timer = window.setInterval(() => void tick(), 60_000);
  void tick();
  return () => { active = false; window.clearInterval(timer); };
}
