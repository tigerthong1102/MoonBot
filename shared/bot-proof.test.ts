import { expect, it } from "vitest";
import { botClaimBytes, proofUsername, verifyBotClaim } from "./bot-proof.ts";

it("binds a bot username claim to its key, owner, room, bot, origin and nonce", async () => {
  const pair = await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const username = await proofUsername(publicKey);
  const claim = { origin: "https://inbox.example.test", owner: "owner-fixture", bot: "bot-fixture", room: "room-fixture", nonce: "nonce-fixture" };
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, botClaimBytes(claim)));
  expect(await verifyBotClaim(publicKey, username, claim, signature)).toBe(true);
  for (const field of Object.keys(claim) as Array<keyof typeof claim>) {
    expect(await verifyBotClaim(publicKey, username, { ...claim, [field]: "other" }, signature)).toBe(false);
  }
  expect(await verifyBotClaim(publicKey, `bot_k${"0".repeat(64)}`, claim, signature)).toBe(false);
  expect(await verifyBotClaim(publicKey, username, claim, signature.slice(1))).toBe(false);
});

it("uses a single snapshot when callers mutate buffers or claims during verification", async () => {
  const a = await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]);
  const b = await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]);
  const publicA = new Uint8Array(await crypto.subtle.exportKey("raw", a.publicKey));
  const publicB = new Uint8Array(await crypto.subtle.exportKey("raw", b.publicKey));
  const username = await proofUsername(publicA);
  const claim = { origin: "https://inbox.example.test", owner: "owner", bot: "bot", room: "room", nonce: "nonce" };
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", b.privateKey, botClaimBytes(claim)));
  const result = verifyBotClaim(publicA, username, claim, signature);
  publicA.set(publicB);
  claim.owner = "other";
  expect(await result).toBe(false);
  const originalKey = new Uint8Array(await crypto.subtle.exportKey("raw", a.publicKey));
  claim.owner = "owner";
  const validSignature = new Uint8Array(await crypto.subtle.sign("Ed25519", a.privateKey, botClaimBytes(claim)));
  const valid = verifyBotClaim(originalKey, username, claim, validSignature);
  validSignature.fill(0);
  claim.owner = "changed";
  expect(await valid).toBe(true);
});
