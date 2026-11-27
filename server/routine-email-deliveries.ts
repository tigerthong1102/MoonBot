import type { ReportDelivery } from "../shared/report-delivery.ts";
import type { RoutineRun } from "./routines.ts";

type SendResult = { accepted: string[]; rejected: string[]; messageId: string };
type DeliveryResult = { receipt: ReportDelivery; repeated?: true };

export class RoutineEmailDeliveries {
  private readonly runs: () => RoutineRun[];
  private readonly commit: (write: () => void) => void;
  private readonly now: () => number;

  constructor(runs: () => RoutineRun[], commit: (write: () => void) => void, now: () => number) {
    this.runs = runs;
    this.commit = commit;
    this.now = now;
  }

  async send(id: string, owner: { botId: string; threadId: string }, destination: string, send: () => Promise<SendResult>): Promise<DeliveryResult> {
    const locate = () => this.runs().find(r => r.id === id && r.threadId === owner.threadId && r.botId === owner.botId);
    const current = locate();
    if (!current || current.status !== "running") throw new Error("The report run is no longer running.");
    destination = destination.replace(/@(.+)$/, (_, domain: string) => "@" + domain.toLowerCase());
    const existing = current.emailDeliveries?.find(r => r.destination === destination);
    if (existing) return { receipt: existing, repeated: true };
    if ((current.emailDeliveries?.length ?? 0) >= 50) throw new Error("This report already has 50 destinations.");
    const claim: ReportDelivery = { destination, state: "unconfirmed", at: this.now() };
    this.commit(() => { current.emailDeliveries = [...(current.emailDeliveries ?? []), claim]; });
    let response: SendResult;
    try { response = await send(); }
    catch { return { receipt: claim }; }
    const match = (values: string[]) => values.some(value => value.trim().toLowerCase() === destination.toLowerCase());
    const settled: ReportDelivery = { ...claim, at: this.now(), state: match(response.accepted) ? "accepted" : match(response.rejected) ? "rejected" : "unconfirmed",
      ...(response.messageId ? { messageId: response.messageId.slice(0, 512) } : {}) };
    this.commit(() => {
      const run = locate();
      if (!run?.emailDeliveries) throw new Error("The report receipt could not be saved.");
      run.emailDeliveries = run.emailDeliveries.map(row => row.destination === destination ? settled : row);
    });
    return { receipt: settled };
  }
}
