# Semantic recall evaluation scaffold

`cases.json` contains 96 separately authored synthetic question pairs (48 development and 48 held-out), version 2. There are positive paraphrases and negatives involving actions, conditions, subjects, status, quantity, scope, and negation; the held-out set includes Vietnamese and cross-language questions. Cases have one saved question each. Each outcome says whether that saved answer may be reused for the query. The wording is fictional and contains no customer data. These labels are design judgments, not validated user outcomes. Some development ideas overlap examples in the production prompt; do not treat development as independent model assessment.

The held-out cases are separate from development but publicly readable here. This is a regression split, not a secret blind test. No model should be tuned against held-out labels; any credible generalization result needs a larger independently authored blind corpus and manual label review. This scaffold has **96, not 200, distinct cases** and is not evidence that the requested 200-case benchmark is complete.

An independent code-review agent reviewed version 2 for ambiguity and overlap; seven pairs were reworded in response. A pair does not include a concrete policy answer, so even a plausible semantic label is not proof that the same answer is correct under every business policy. An additional domain reviewer and answer-grounded dataset are needed before treating these labels as gold.

`context-cases.json` is a separate preliminary set of 56 hand-authored synthetic cases, with 28 in each split. Each records a fictional scenario, the saved question and synthetic answer, a new query, and a rationale for the proposed label. The answer is a test fixture, not a real owner's approval. A domain reviewer has not validated the labels. Related intents recur across the two public corpora, so the held-out set is not blind. Do not combine its 56 cases with the 96 question-only cases as if all 152 had the same evidence quality. Neither set meets the requested minimum of 200 answer-grounded cases.

```sh
node --experimental-strip-types evals/unified-memory/report.ts
node --experimental-strip-types evals/unified-memory/report.ts --context
pnpm exec vitest run --config evals/vitest.config.ts evals/unified-memory
pnpm exec tsc -p evals/tsconfig.json --noEmit
```

Both report commands report **NOT RUN** for every cell. They never contact a provider and need no credentials. The tests exercise score accounting and fixture structure, not semantic behavior. There is no baseline semantic score in this branch.

For a future independently authorized evaluation, an adapter must execute the actual `createAiTwinPreview().recall` implementation against the saved question and query with a real configured provider, record provider/model/commit and cost outside this corpus, and save one result per case as an array of `{ "id": "hold-01", "result": "match" | "none" | "error" }`. An error includes timeouts and unavailable providers; it must not be replaced with `none`. The current scaffold does not include or imply such an adapter or authorize network usage. Score a separately obtained result file with:

```sh
node --experimental-strip-types evals/unified-memory/report.ts /path/to/results.json
node --experimental-strip-types evals/unified-memory/report.ts --context /path/to/context-results.json
```

Output groups by split and category and records positive and negative denominators, attempts, errors, correct decisions, false matches, and false misses. Missing cases yield INCOMPLETE, not a perfect score. Unknown or duplicate IDs are rejected. Report false matches and false misses separately; for a complete run with no errors, false-match rate is false matches divided by negative cases, and false-miss rate is false misses divided by positive cases. Errors and incomplete runs must be reported instead of silently excluded. Never treat imported results as verified evidence unless their collection method is independently established.

This scaffold does not evaluate security, source authorization, cross-tenant leakage, consent, automatic learning, cost ceilings, realistic multi-candidate retrieval, prompt injection resistance, memory lifecycle, UI or production availability. The separate AgenticOS lifecycle suite remains at `evals/ai-twin/agenticos-memory.test.ts`. Those properties require separate isolated, end-to-end tests and should not be inferred from this corpus or its scorer.

In the current product, semantic recall compares the query to saved **questions**; it does not send the saved answer or fixture context to its matching prompt. The contextual answers here justify the labels for reviewers; an adapter must not silently inject these answers into that prompt and claim to evaluate the same implementation.
