# Paused and resumed

The full run stopped after 29 of 50 runs: the Mac's disk filled up (2.4 GB free) and Docker Desktop crashed while starting gpt/D10.
No cost was recorded for that attempt and its folder was empty; it was removed and gpt/D10 was run again.

| Part | Runs | Cost (USD, Cline `metadata.totalCost`) | Budget file |
|---|---|---|---|
| full-2026-11-13 | sonnet ×20, gpt D1–D9 | 2.3895 | budget.json |
| full-2026-11-13-resume-gpt | gpt D10, S1–S8, G1, G2 | 0.9147 | budget-resume-gpt.json |
| full-2026-11-13-resume-opus | opus ×10 | 1.5411 | budget-resume-opus.json |
| **Total** | **50** | **4.8453** | cap 8.00 |

All three parts used the same image (clineshield-eval:3ec6527), model ids and settings. The resumed runs keep their original
`runId` in meta.json (e.g. `full-2026-11-13-resume-gpt/gpt/S1`); their folders were moved here so all 50 are scored together.
