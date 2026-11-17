// Plain ESM so Electron's main process and the server enforce exactly the same lease protocol.
import type { DataDirLease } from "../electron/data-dir-lease.mjs";

export {
  acquireDataDirLease,
  acquireDataDirLeaseForProcess,
  clearRecordsFromEarlierRunOfThisContainer,
  clearRecordsFromOtherMachines,
  DataDirLeaseError,
} from "../electron/data-dir-lease.mjs";

export type {
  DataDirLease,
  DelegatedDataDirLease,
  OwnedDataDirLease,
} from "../electron/data-dir-lease.mjs";

export function releaseOnceAtExit(lease: Pick<DataDirLease, "release">): () => void {
  let attempted = false;
  return () => {
    if (attempted) return;
    attempted = true;
    try {
      lease.release();
    } catch (error) {
      console.error(`[data-directory] lease release failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}
