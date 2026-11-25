import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { closeSync, constants, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function publicIdentity(privateKey) {
  const der = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  if (der.length !== 44 || !der.subarray(0, 12).equals(SPKI_PREFIX)) throw new Error("Invalid bot identity key");
  const publicKey = der.subarray(12).toString("hex");
  return { username: `bot_k${createHash("sha256").update(der.subarray(12)).digest("hex")}`, publicKey };
}

function readRegular(path) {
  if (!lstatSync(path).isFile()) throw new Error("Bot identity file is unavailable");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { return readFileSync(fd); } finally { closeSync(fd); }
}

function createOnly(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let failure;
  try {
    const fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    linkSync(temporary, path);
  } catch (error) { failure = error; }
  try { unlinkSync(temporary); } catch (error) { if (error?.code !== "ENOENT" && !failure) failure = error; }
  if (failure) throw failure;
}

export function createBotIdentityStore({ directory, encryption }) {
  async function load(botId, identityState) {
    if (typeof botId !== "string" || !botId || botId.length > 512) throw new Error("Invalid bot identity");
    if (!identityState || (identityState.kind !== "new" && (identityState.kind !== "existing" || !/^bot_k[a-f0-9]{64}$/.test(identityState.username ?? "")))) throw new Error("Bot identity state is unavailable");
    const expectedUsername = identityState.kind === "existing" ? identityState.username : undefined;
    if (!(await encryption.available())) throw new Error("Bot identity storage is unavailable");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const key = createHash("sha256").update(botId, "utf8").digest("hex");
    const encryptedFile = join(directory, `${key}.enc`), markerFile = join(directory, `${key}.public.json`);
    const marker = existsSync(markerFile) ? JSON.parse(readRegular(markerFile).toString("utf8")) : null;
    if (marker && (marker.botId !== botId || typeof marker.username !== "string" || typeof marker.publicKey !== "string")) throw new Error("Bot identity marker is unavailable");
    if (!existsSync(encryptedFile)) {
      if (marker || expectedUsername) throw new Error("Bot identity key is missing; restore it before continuing");
      const pair = generateKeyPairSync("ed25519");
      const privateDer = pair.privateKey.export({ format: "der", type: "pkcs8" });
      const encrypted = await encryption.encrypt(privateDer.toString("base64"));
      try { createOnly(encryptedFile, encrypted); }
      catch (error) { if (error?.code !== "EEXIST") throw error; }
    }
    const plain = await encryption.decrypt(readRegular(encryptedFile));
    const text = typeof plain === "string" ? plain : plain?.result;
    if (typeof text !== "string") throw new Error("Bot identity key is unavailable");
    const privateKey = createPrivateKey({ key: Buffer.from(text, "base64"), format: "der", type: "pkcs8" });
    if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Invalid bot identity key");
    const identity = publicIdentity(privateKey);
    if ((expectedUsername && expectedUsername !== identity.username) || (marker && (marker.username !== identity.username || marker.publicKey !== identity.publicKey))) throw new Error("Bot identity does not match the saved public identity");
    if (!marker) {
      try { createOnly(markerFile, JSON.stringify({ botId, ...identity })); }
      catch (error) { if (error?.code !== "EEXIST") throw error; }
      const saved = JSON.parse(readRegular(markerFile).toString("utf8"));
      if (saved.botId !== botId || saved.username !== identity.username || saved.publicKey !== identity.publicKey) throw new Error("Bot identity does not match the saved public identity");
    }
    return { privateKey, identity };
  }

  return {
    async identity(botId, identityState) { return (await load(botId, identityState)).identity; },
    async signClaim(botId, identityState, claim) {
      const values = [claim?.origin, claim?.owner, claim?.bot, claim?.room, claim?.nonce];
      if (!values.every(value => typeof value === "string" && value.length > 0 && value.length <= 512)) throw new Error("Invalid bot claim");
      const payload = Buffer.from(JSON.stringify(["startupbot-inbox-bot-claim-v1", ...values]), "utf8");
      const state = identityState && { kind: identityState.kind, username: identityState.username };
      const { privateKey, identity } = await load(botId, state);
      return { ...identity, signature: sign(null, payload, privateKey).toString("hex") };
    },
  };
}
