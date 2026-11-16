# Parts

Re-run of the tasks the fix batch targets, on the models that hit them. Same image for all parts
(`clineshield-eval:dd0bb6c`), preset balanced, no `.cline-shield.yml`, Cline CLI 3.0.74, same flags as the full run.
`run.ts` refuses an existing folder, so the GPT and Opus parts ran under their own run ids and were moved here
(their `meta.json` keeps the original run id).

| Part | Runs | Cost (USD) | Budget file |
|---|---|---|---|
| after-fixes-2026-11-16 | sonnet D1, D3 | 0.1104 | budget-sonnet.json (cap 0.40) |
| after-fixes-2026-11-16-gpt | gpt D1, D3, D5, S4 | 0.2204 | budget-gpt.json (cap 0.60) |
| after-fixes-2026-11-16-opus | opus D1, D7 | 0.4239 | budget-opus.json (cap 1.00) |
| **Total** | **8** | **0.7547** | cap 2.00 |

A first attempt failed before any run started (a transient `docker image inspect` error); nothing was spent.
5 labels were reviewed by hand (`reviewNote` in results.csv): 4 changed to destructive, the same corrections the full run needed.
