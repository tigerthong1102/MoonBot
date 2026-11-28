// The account service carries only short-lived ciphertext. The private key lives in the receiving desktop window.
const encode = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const decode = (text) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
const algorithm = { name: "ECDH", namedCurve: "P-256" };
export async function draftKeys() {
  const pair = await crypto.subtle.generateKey(algorithm, false, ["deriveKey"]);
  return {
    privateKey: pair.privateKey,
    publicKey: encode(await crypto.subtle.exportKey("raw", pair.publicKey)),
  };
}
async function aes(privateKey, publicKey, usage) {
  const peer = await crypto.subtle.importKey("raw", decode(publicKey), algorithm, false, []);
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: peer },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}
function cipher(iv, id, listener) {
  return {
    name: "AES-GCM",
    iv,
    additionalData: new TextEncoder().encode(JSON.stringify(["startupbot-desktop-draft-v1", id, listener])),
  };
}
export async function sealDraft(prompt, publicKey, id, listener) {
  const sender = await draftKeys(),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    cipher(iv, id, listener),
    await aes(sender.privateKey, publicKey, "encrypt"),
    new TextEncoder().encode(prompt),
  );
  return JSON.stringify({ key: sender.publicKey, iv: encode(iv), data: encode(data) });
}
export async function unsealDraft(payload, privateKey, id, listener) {
  const envelope = JSON.parse(payload);
  const data = await crypto.subtle.decrypt(
    cipher(decode(envelope.iv), id, listener),
    await aes(privateKey, envelope.key, "decrypt"),
    decode(envelope.data),
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(data);
}
