export async function sha256Hex(input: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  const bytes = subtle
    ? new Uint8Array(await subtle.digest("SHA-256", input))
    : (await import("@noble/hashes/sha2.js")).sha256(input instanceof Uint8Array ? input : new Uint8Array(input));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
