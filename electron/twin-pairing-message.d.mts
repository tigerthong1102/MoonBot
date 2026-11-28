export function twinPairingMessage(fields: {
  origin: string;
  owner: string;
  id: string;
  publicKey: string;
  twin: string;
  revision: number;
  expires: number;
}): string;
