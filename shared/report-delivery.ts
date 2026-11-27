/** Provider acceptance concerns the outgoing server. An unconfirmed send requires reconciliation before another send. */
export interface ReportDelivery {
  destination: string;
  state: "unconfirmed" | "accepted" | "rejected";
  at: number;
  messageId?: string;
}
