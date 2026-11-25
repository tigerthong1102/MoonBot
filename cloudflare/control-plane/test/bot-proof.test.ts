import { expect, it } from "vitest";
import { botClaimBytes, proofUsername, verifyBotClaim } from "../../../shared/bot-proof";

it("verifies self-certifying bot claims inside the Inbox worker runtime", async () => {
  const pair = await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]);
  const key = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const claim = { origin: "https://inbox.example.test", owner: "fixture-owner", bot: "fixture-bot", room: "fixture-room", nonce: "fixture-nonce" };
  const username = await proofUsername(key);
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, new Uint8Array(botClaimBytes(claim))));
  expect(await verifyBotClaim(key, username, claim, signature)).toBe(true);
  expect(await verifyBotClaim(key, username, { ...claim, owner: "different-owner" }, signature)).toBe(false);
});

it("accepts a fixed Node-signed Unicode claim in the worker", async () => {
  const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, part => Number.parseInt(part, 16));
  const key = bytes("7bec7f4a7eb3bd36645ed5fbd44073f48fff65f2af2cbe760b52e720475a17b9");
  const signature = bytes("7f486b1083c5f4acf93776fac6af9dba8e1844912d7a6232aab26ef03dda43ae6bd832b485f6093e195e2d7624bbc5b01aa50b1914acaf66bc93f0afda95c006");
  const claim = { origin: "https://inbox.example.test", owner: "người dùng", bot: "bot\\\"one", room: "room-1", nonce: "nonce-1" };
  expect(await verifyBotClaim(key, await proofUsername(key), claim, signature)).toBe(true);
});
