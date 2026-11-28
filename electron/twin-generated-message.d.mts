export const generatedRoomLimit: 8;

type Identity = { origin: string; owner: string; pairing: string; id: string };
export function generatedGrantMessage(input: Identity & { twin: string; revision: number; rooms: string[]; expires: number; provider: { key: string; name: string; model: string; destination: string } }): string;
export function generatedPostMessage(input: Identity & { source: number; room: string; nonce: string; expires: number; inputHash: string; answer: string }): string;
