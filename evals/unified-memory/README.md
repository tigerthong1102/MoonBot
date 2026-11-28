# Semantic recall evaluation scaffold

`cases.json` contains 32 separately authored synthetic question pairs (16 development and 16 held-out), version 1. There are positive paraphrases and negatives involving actions, conditions, subjects, status, and negation; the held-out set includes Vietnamese and cross-language questions. Cases have one saved question each. Each outcome says whether that saved answer may be reused for the query. The wording is fictional and contains no customer data. These labels are design judgments, not validated user outcomes. Some development ideas overlap examples in the production prompt; do not treat development as independent model assessment.

The held-out cases are separate from development but publicly readable here. This is a regression split, not a secret blind test. No model should be tuned against held-out labels; any credible generalization result needs a larger independently authored blind corpus and manual label review. This scaffold has **32, not 200, distinct cases** and is not evidence that the requested 200-case benchmark is complete.

```sh
node --experimental-strip-types evals/unified-memory/report.ts
pnpm exec vitest run --config evals/vitest.config.ts evals/unified-memory/score.test.ts
pnpm exec tsc -p evals/tsconfig.json --noEmit
```

The first command reports **NOT RUN** for every cell. It never contacts a provider and needs no credentials. The tests exercise score accounting, not semantic behavior. There is no baseline semantic score in this branch.

For a future independently authorized evaluation, an adapter must execute the actual `createAiTwinPreview().recall` implementation against the saved question and query with a real configured provider, record provider/model/commit and cost outside this corpus, and save one result per case as an array of `{ "id": "hold-01", "result": "match" | "none" | "error" }`. An error includes timeouts and unavailable providers; it must not be replaced with `none`. The current scaffold does not include or imply such an adapter or authorize network usage. Score a separately obtained result file with:

```sh
node --experimental-strip-types evals/unified-memory/report.ts /path/to/results.json
```

Output groups by split and category and records positive and negative denominators, attempts, errors, correct decisions, false matches, and false misses. Missing cases yield INCOMPLETE, not a perfect score. Unknown or duplicate IDs are rejected. Report false matches and false misses separately; for a complete run with no errors, false-match rate is false matches divided by negative cases, and false-miss rate is false misses divided by positive cases. Errors and incomplete runs must be reported instead of silently excluded. Never treat imported results as verified evidence unless their collection method is independently established.

This scaffold does not evaluate security, source authorization, cross-tenant leakage, consent, automatic learning, cost ceilings, realistic multi-candidate retrieval, prompt injection resistance, memory lifecycle, UI or production availability. The separate AgenticOS lifecycle suite remains at `evals/ai-twin/agenticos-memory.test.ts`. Those properties require separate isolated, end-to-end tests and should not be inferred from this corpus or its scorer.
