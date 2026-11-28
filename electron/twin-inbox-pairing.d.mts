type PairingTicket = { id: string; fingerprint: string; origin: string; expires: number; exactAvailable: boolean; generatedAvailable?: boolean };
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
type Provider = { key: string; name: string; model: string; destination: string };
type GeneratedStatus = { available: boolean; manageOnly?: boolean; owner?: string; local?: boolean; remote?: null | { id: string; enabled: boolean; expires: number; count: number; dailyLimit?: number; usedToday?: number; authorizedUntil?: number; leaseActive?: boolean } };
type Journal = { add(ref: Ref): void; remove(ref: Ref): void; list(owner: string, origin: string): Ref[] };
export function createTwinInboxPairing(deps: {
  current(): boolean;
  exactProfile?(): Promise<unknown>;
  generatedProfile?(): Promise<unknown>;
  generate?(body: { id: string; revision: number; key: string; question: string; job: string; useProvider: true }, signal: AbortSignal): Promise<{ answer: string }>;
  generatedJournal?: Journal;
  approveGenerated?(terms: { grant: Ref & { provider: Provider; expires: number; dailyLimit?: number }; chosen: Room[]; kinds: string[] }): Promise<boolean>;
  profile(): Promise<unknown>;
  inbox(path: string, data?: object): Promise<unknown>;
  approve(fields: { origin: string; fingerprint: string; owner: string; twin: string }): Promise<boolean>;
  exactJournal?: Journal;
  approveExact?(terms: { grant: Grant; chosen: Room[]; all: boolean }): Promise<boolean>;
  origin: string;
  now?: () => number;
}): {
  start(): Promise<PairingTicket>;
  confirm(): Promise<boolean>;
  reset(): void;
  generated: {
    choices(): Promise<{ rooms: Room[]; provider: Provider }>;
    whileOpen(): boolean;
    offer(provider: Provider, rooms: string[], dailyLimit?: number): Promise<boolean>;
    tick(): Promise<void>;
    reset(): void;
    recover(): Promise<unknown>;
    status(): Promise<GeneratedStatus>;
  };
  exact: {
    offer(lesson: string, rooms: string[]): Promise<boolean>;
    choices(): Promise<{ rooms: Room[]; lessons: { id: string; question: string }[] }>;
    status(): Promise<{ local: boolean; remote: null | { id: string; enabled: boolean; expires: number } }>;
    stop(): Promise<void>;
    tick(): Promise<void>;
  };
};
