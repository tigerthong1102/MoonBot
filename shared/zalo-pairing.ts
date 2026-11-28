export interface ZaloPairingStatus {
  state: "unconfigured" | "ready" | "waiting" | "locked" | "candidate" | "paired";
  accountId?: string;
  revision?: string;
  expires?: number;
  participant?: { senderId: string; conversationId: string };
  retentionDays?: number;
  coverage?: { count: number; first: number | null; last: number | null; pollGaps: number; timingIssues: number };
}
