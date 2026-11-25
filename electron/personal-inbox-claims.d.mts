type CloudCall = (path: string, body: Record<string, unknown>) => Promise<unknown>;
type OwnedBot = { room: string; owner: string; bot: string; name: string };
type Proof = { nonce: string; publicKey: string; signature: string };

export function createPersonalInboxClaims(cloud: CloudCall): {
  inviteLegacy(input: OwnedBot): Promise<unknown>;
  challenge(input: Omit<OwnedBot, "name">): Promise<{ nonce: string }>;
  invite(input: OwnedBot & { username: string; proof: Proof }): Promise<unknown>;
};
