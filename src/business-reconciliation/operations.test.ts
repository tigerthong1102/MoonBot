import { describe, expect, it } from "vitest";
import { table, type Source } from "./compare";
import { authorizeExportReconciliation, runBusinessOperation } from "./operations";

function exportFixture(): Source {
  return {
    data: table([
      ["company", "period", "document", "amount"],
      ["A", "2025", "01", "1.00"], ["B", "2025", "01", "99"], ["A", "2024", "01", "50"],
    ]),
    mapping: { company: 0, period: 1, document: 2, amount: 3 },
    separator: ".",
  };
}

describe("local business operation grants", () => {
  it("binds both snapshots to the approved company and period at grant time", () => {
    const left = exportFixture(), right = exportFixture();
    const scope = { company: "A", period: "2025" };
    const grant = authorizeExportReconciliation(left, right, scope);
    scope.company = "B";
    left.data.rows[0][3] = "1000";
    const report = runBusinessOperation(grant);
    expect(report).toMatchObject({ company: "A", period: "2025", left: "1.00", right: "1.00", exceptions: [] });
  });

  it("rejects fabricated, cloned and already consumed grants", () => {
    const source = exportFixture();
    const grant = authorizeExportReconciliation(source, source, { company: "B", period: "2025" });
    expect(() => runBusinessOperation({ ...grant })).toThrow("reconcile.scopeRequired");
    expect(() => runBusinessOperation({ ...grant, company: "A" })).toThrow("reconcile.scopeRequired");
    expect(runBusinessOperation(grant).left).toEqual("99");
    expect(() => runBusinessOperation(grant)).toThrow("reconcile.scopeRequired");
  });

  it("requires an explicit scope with matching evidence on both sides", () => {
    const source = exportFixture(), other = exportFixture();
    other.data.rows = other.data.rows.filter(row => row[0] === "B");
    expect(() => authorizeExportReconciliation(source, source, { company: "", period: "2025" })).toThrow("reconcile.scopeRequired");
    expect(() => authorizeExportReconciliation(source, other, { company: "A", period: "2025" })).toThrow("reconcile.emptyScope");
  });
});
