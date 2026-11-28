type PairingTicket = { id: string; fingerprint: string; origin: string; expires: number; exactAvailable: boolean };
type Ref = { owner: string; id: string; origin: string };
type Room = { ref: string; id: string; kind: string; title: string };
type Grant = Ref & {
  pairing: string;
  lesson: string;
  question: string;
  answer: string;
  rooms: string[];
  expires: number;
};
export function createTwinInboxPairing(deps: {
  current(): boolean;
  exactProfile?(): Promise<unknown>;
  profile(): Promise<unknown>;
  inbox(path: string, data?: object): Promise<unknown>;
  approve(fields: { origin: string; fingerprint: string; owner: string; twin: string }): Promise<boolean>;
  exactJournal?: { add(ref: Ref): void; remove(ref: Ref): void; list(owner: string, origin: string): Ref[] };
  approveExact?(terms: { grant: Grant; chosen: Room[]; all: boolean }): Promise<boolean>;
  origin: string;
  now?: () => number;
}): {
  start(): Promise<PairingTicket>;
  confirm(): Promise<boolean>;
  reset(): void;
  exact: {
    offer(lesson: string, rooms: string[]): Promise<boolean>;
    choices(): Promise<{ rooms: Room[]; lessons: { id: string; question: string }[] }>;
    status(): Promise<{ local: boolean; remote: null | { id: string; enabled: boolean; expires: number } }>;
    stop(): Promise<void>;
    tick(): Promise<void>;
  };
};
