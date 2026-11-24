import type { AppTriggerTestReceipts, TestReceipt, TestReceiptBinding } from "./app-trigger-test-receipts.ts";

type NoEffectReason = NonNullable<TestReceipt["reason"]>;
type TestEvent = { token: string; remoteId: string; eventId: string };
type Outcome = { state: "unrecognized" | "unknown" } | { state: "handled" | "rejected" | "cancelled"; receipt: TestReceipt };

export function appTestEvent(kind: string, remoteId: string, eventId: string, data: unknown): (TestEvent & { safeData: { omb_test: true; note: string } }) | null {
  if (kind !== "test" || !data || typeof data !== "object" || Array.isArray(data)) return null;
  const payload = data as Record<string, unknown>;
  if (Object.keys(payload).sort().join(",") !== "marker,note,omb_test" || payload.omb_test !== true || payload.note !== "A test run started from StartupBot." || typeof payload.marker !== "string") return null;
  return { token: payload.marker, remoteId, eventId, safeData: { omb_test: true, note: payload.note } };
}

export function createAppTriggerTestCoordinator(deps: {
  receipts: AppTriggerTestReceipts;
  validate(binding: TestReceiptBinding): NoEffectReason | null;
  admit(binding: TestReceiptBinding, eventId: string): { id: string };
  proof(binding: TestReceiptBinding, eventId: string): { id: string } | null;
}) {
  return {
    receive(event: TestEvent): Outcome {
      const inspected = deps.receipts.inspect(event.token, event.remoteId);
      if (!inspected) return { state: "unrecognized" };
      if (inspected.receipt.state === "cancelled") return { state: "cancelled", receipt: inspected.receipt };
      const claim = deps.receipts.claim(event.token, event.remoteId, event.eventId);
      if (!claim) return { state: "unrecognized" };
      if (!claim.sameEvent && claim.receipt.state !== "cancelled") return { state: "unknown" };
      if (claim.receipt.state === "handled" || claim.receipt.state === "rejected") return { state: claim.receipt.state, receipt: claim.receipt };
      if (claim.receipt.state === "cancelled") return { state: "cancelled", receipt: claim.receipt };
      if (!claim.fresh) {
        const proof = deps.proof(claim.binding, claim.eventId);
        if (!proof) return { state: "unknown" };
        const receipt = deps.receipts.settle(claim.receipt.id, "handled", proof.id);
        return receipt ? { state: "handled", receipt } : { state: "unknown" };
      }
      const reason = deps.validate(claim.binding);
      if (reason) {
        const receipt = deps.receipts.rejectBeforeAdmission(claim.permit!, reason);
        return receipt ? { state: "rejected", receipt } : { state: "unknown" };
      }
      if (!deps.receipts.beginAdmission(claim.permit!)) return { state: "unknown" };
      const admitted = deps.admit(claim.binding, claim.eventId);
      const proof = deps.proof(claim.binding, claim.eventId);
      if (!proof || proof.id !== admitted.id) return { state: "unknown" };
      const receipt = deps.receipts.settle(claim.receipt.id, "handled", proof.id);
      return receipt ? { state: "handled", receipt } : { state: "unknown" };
    },
  };
}
