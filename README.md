# Web Performance Budget Gate

`TOOL_ID=web-performance-budget-gate`. Zero-dependency Node 22+ reporter for captured Lighthouse JSON metrics and an explicit route budget. It does not run Lighthouse, load a page, fetch data, or infer live performance. All files are local and read-only.

```sh
node bin/web-performance-budget-gate.mjs --root examples/pass --budget budget.json --capture capture.json
node bin/web-performance-budget-gate.mjs --root examples/fail --budget budget.json --capture capture.json
npm run check
```

The examples exit `0` and `1`. `--help` prints usage; `--human` adds a fixed stderr summary. The library exports `TOOL_ID`, `LIMITS`, `RULE_SEVERITY`, and `evaluateBudgets(budget,capture,{now})` with an injectable monotonic clock.

## Input contract

Both JSON documents use `schemaVersion:"1"` and `complete:true`. A budget has nonempty `routes`; each route is `{route,minRuns,metrics}`. Each metric is `{audit,aggregation,max,baseline,tolerancePercent}`. `audit` is a lowercase Lighthouse audit ID; aggregation is `median`, `mean`, or `max`. Numeric values are nonnegative and at most 1,000,000,000; tolerance is 0–100 percent. This tool supports lower-is-better numeric metrics only. The aggregated value must be no greater than both `max` and `baseline × (1 + tolerancePercent/100)`. Use metrics whose Lighthouse `numericValue` unit matches the budget numbers; the tool does not convert units.

The capture has `runs` entries `{route,runId,report}`. `report` is a captured Lighthouse JSON object containing `lighthouseVersion` and an `audits` object with `{numericValue}` for every named audit. Run IDs are 1–64 ASCII letters, digits, `_`, or `-` and must be unique within a route. Route names are absolute local paths without control characters, query, fragment, or backslash; identity is exact, so use the same spelling in both files. The budget selects which captured routes to judge. **Every** captured run for a selected route participates in its declared aggregation, and each route needs at least `minRuns` captures. A missing or unusable named metric in any repeat makes that metric incomplete; the checker does not silently drop the run. The export's `complete:true` is a supplied assertion, not an independently verified capture provenance.

## Results and bounds

Stdout is one deterministic catalog-v1 JSON report. Findings use fixed `@budget` and `@capture` source roles with JSON pointers into the named files, never route names, audit IDs, values, host paths, or raw report excerpts. They sort by `(file,pointer,ruleId)` in UTF-16 code-unit order. `summary.checked` counts fully evaluated route-metric groups and `runsEvaluated` counts all captured runs for selected routes. Exit `0` means complete pass; `1` means a completed budget failure; `2` means incomplete evidence or invalid configuration. Unknown CLI options and ambiguous duplicate keys in the budget config have empty stdout and fixed stderr diagnostics. Unreadable, non-UTF-8, malformed, over-limit, or duplicate-key capture input yields an incomplete JSON report.

| Rule | Severity | Meaning |
| --- | --- | --- |
| `input-unreadable`, `input-invalid`, `export-incomplete`, `byte-limit`, `record-limit`, `depth-limit`, `time-limit` | warning | Evidence cannot be fully evaluated |
| `route-duplicate`, `metric-duplicate`, `run-duplicate`, `runs-missing`, `metric-unavailable` | warning | Route, run, or metric evidence is insufficient or ambiguous |
| `budget-exceeded`, `regression-exceeded` | error | Aggregated metric breaches an absolute or baseline-relative limit |

Limits: 262,144 budget bytes, 1,048,576 capture bytes, 100 routes, 20 metrics per route, 1,000 total runs, JSON depth 16 (root at depth 0), and 5,000 ms evaluation time. Exactly N is allowed; N+1 is incomplete. The CLI requires realpath confinement of both files beneath the real `--root` and never writes. The direct library trusts caller-supplied objects.
