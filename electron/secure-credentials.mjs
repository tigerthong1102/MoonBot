import fs from "node:fs";
import path from "node:path";

// "unavailable" (could not read) must never look like "empty": a caller would register a fresh installation over the real one.
// macOS says "temporarily unavailable. Please try again." for a keychain that is busy at launch, so retry briefly first.
export const CREDENTIAL_READ_DELAYS_MS = [100, 200, 400, 800];

const message = (error) => (error instanceof Error ? error.message : String(error));

class CredentialTimeout extends Error {}

export async function credentialResult(operation, timeoutMs = 12_000) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new CredentialTimeout("Timed out waiting for the operating-system credential store")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function writeSecureCredentials(file, credentials, safeStorage) {
  if (!(await credentialResult(safeStorage.isAsyncEncryptionAvailable()))) {
    throw new Error("The operating-system credential store is unavailable");
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const encrypted = await credentialResult(safeStorage.encryptStringAsync(JSON.stringify(credentials)));
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, encrypted, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export async function readSecureCredentials({
  exists,
  isAvailable,
  readFile,
  decrypt,
  sleep,
  delays = CREDENTIAL_READ_DELAYS_MS,
  timeoutMs,
}) {
  if (!exists()) return { status: "empty", credentials: {} };

  let lastError = "the operating-system credential store is unavailable";
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    try {
      if (!(await credentialResult(isAvailable(), timeoutMs))) {
        lastError = "the operating-system credential store is unavailable";
        continue;
      }
      const decrypted = await credentialResult(decrypt(readFile()), timeoutMs);
      const text = typeof decrypted === "string" ? decrypted : decrypted?.result;
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { status: "unavailable", credentials: {}, error: "the credential store is not readable" };
        }
        return { status: "ok", credentials: parsed };
      } catch {
        return { status: "unavailable", credentials: {}, error: "the credential store is not readable" };
      }
    } catch (error) {
      lastError = message(error);
      if (error instanceof CredentialTimeout) break;
    }
  }
  return { status: "unavailable", credentials: {}, error: lastError };
}

/** "Reset saved keys" for a store that cannot be read: after the person confirms, the file is moved aside (kept, not
 * deleted) and the app restarts with an empty store it can write again. A store that was read is never touched, and
 * nothing moves once the app has begun to quit while the person was deciding, since no restart would follow. */
export async function resetUnreadableCredentials({ unreadable, confirm, quitting, moveAside, failed, restart }) {
  if (!unreadable) return "readable";
  if (!(await confirm())) return "cancelled";
  if (quitting()) return "quitting";
  try {
    moveAside();
  } catch (error) {
    // Only a file that is really gone counts as moved; a folder that can no longer be read is a failure to report.
    if (error?.code !== "ENOENT") {
      await failed(error);
      return "failed";
    }
  }
  restart();
  return "reset";
}

/** The page's two calls for this store. `unreadable` is a function because the launch read finishes after this is installed.
 * Asking first is deliberate: "unavailable" can be a keychain failure on a good file, and a reset drops every key. */
export function installCredentialStoreIpc({ ipcMain, localOnly, dialog, windowFor, t, appName, unreadable, quitting, moveAside, log, relaunch }) {
  ipcMain.handle("credential-store:unreadable", localOnly("credential-store:unreadable", () => unreadable()));
  ipcMain.handle("credential-store:reset", localOnly("credential-store:reset", (event) => resetUnreadableCredentials({
    unreadable: unreadable(),
    confirm: async () => {
      const options = {
        type: "warning",
        buttons: [t("native.dialog.resetSavedKeys.button"), t("native.common.cancel")],
        defaultId: 1,
        cancelId: 1,
        message: t("native.dialog.resetSavedKeys.title"),
        detail: t("native.dialog.resetSavedKeys.detail", { app: appName() }),
      };
      const parent = windowFor(event.sender);
      const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      return response === 0;
    },
    quitting,
    moveAside,
    failed: async (error) => {
      log(`saved keys reset failed: ${message(error)}`);
      await dialog.showMessageBox({ type: "error", message: t("native.dialog.resetSavedKeys.failed"), detail: message(error) });
    },
    restart: () => {
      log("saved keys reset by the person: unreadable credential store moved aside, restarting");
      relaunch();
    },
  })));
}
