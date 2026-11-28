export type MemoryCase = { id: string; split: "development" | "held-out"; category: string; saved: string; query: string; expected: "match" | "none" };
export type Prediction = { id: string; result: "match" | "none" | "error" };

export function score(cases: readonly MemoryCase[], predictions: readonly Prediction[]) {
  const byId = new Map(cases.map(item => [item.id, item]));
  if (byId.size !== cases.length) throw new Error("duplicate case id");
  const seen = new Set<string>();
  for (const prediction of predictions) {
    if (!byId.has(prediction.id) || seen.has(prediction.id) || !["match", "none", "error"].includes(prediction.result)) throw new Error("invalid prediction");
    seen.add(prediction.id);
  }
  const cells: Record<string, { total: number; positives: number; negatives: number; attempted: number; errors: number; correct: number; falseMatch: number; falseMiss: number }> = {};
  const observations = new Map(predictions.map(row => [row.id, row.result]));
  for (const item of cases) {
    const key = `${item.split}/${item.category}`;
    const cell = cells[key] ??= { total: 0, positives: 0, negatives: 0, attempted: 0, errors: 0, correct: 0, falseMatch: 0, falseMiss: 0 };
    cell.total++;
    if (item.expected === "match") cell.positives++; else cell.negatives++;
    const result = observations.get(item.id);
    if (!result) continue;
    cell.attempted++;
    if (result === "error") cell.errors++;
    else if (result === item.expected) cell.correct++;
    else if (result === "match") cell.falseMatch++;
    else cell.falseMiss++;
  }
  return { status: predictions.length === 0 ? "NOT RUN" : predictions.length === cases.length ? "COMPLETE" : "INCOMPLETE", cells } as const;
}
