type PairingTicket = { id: string; fingerprint: string; origin: string; expires: number };
export function createTwinInboxPairing(deps: {
  current(): boolean;
  profile(): Promise<unknown>;
  inbox(path: string, data?: object): Promise<unknown>;
  approve(fields: { origin: string; fingerprint: string; owner: string; twin: string }): Promise<boolean>;
  origin: string;
  now?: () => number;
}): { start(): Promise<PairingTicket>; confirm(): Promise<boolean>; reset(): void };
