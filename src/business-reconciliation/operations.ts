import { compareTotals, readScopedExports, type Scope, type Source } from "./compare";
import { ReconcileError } from "./messages";

const registry = {
  "exports.reconcile": compareTotals,
} as const;

type LocalReadGrant = Readonly<{ operation: keyof typeof registry; company: string; period: string }>;
const pending = new WeakMap<LocalReadGrant, ReturnType<typeof readScopedExports>>();

// Called by the local file picker workflow after the user approves these two sources and scope.
// Keep only the selected company's document totals in the grant, never the raw input files.
export function authorizeExportReconciliation(left: Source, right: Source, scope: Scope): LocalReadGrant {
  if (!scope.company.trim() || !scope.period.trim()) throw new ReconcileError("reconcile.scopeRequired");
  const inputs = readScopedExports(left, right, scope);
  const grant = Object.freeze({ operation: "exports.reconcile" as const, ...inputs.scope });
  pending.set(grant, inputs);
  return grant;
}

export function runBusinessOperation(grant: LocalReadGrant) {
  const inputs = pending.get(grant);
  if (!inputs) throw new ReconcileError("reconcile.scopeRequired");
  pending.delete(grant);
  return registry[grant.operation](inputs);
}
