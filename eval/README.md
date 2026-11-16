# ClineShield evaluation harness

Design: `docs/superpowers/specs/2026-11-12-evaluation-design.md` · Plan: `docs/superpowers/plans/2026-11-12-evaluation.md`

Real Cline CLI runs of 20 pre-labelled tasks (`tasks/tasks.json`) inside Docker, scored per tool call.

| Step | Command (from the repo root) |
|---|---|
| Unit tests | `cd clineshield && npm run test:eval` |
| Build image | `eval/docker/build.sh` |
| Log in to Cline (once, in the container volume) | see `eval/docker/build.sh` output |
| Run | `npx jiti@2.7.0 eval/src/cli/run.ts <runId> [--tasks D1,S1] [--models sonnet] --cap <usd>` |
| Replay timing / re-score | `npx jiti@2.7.0 eval/src/cli/replay.ts eval/results/<runId>` |
| Score | `npx jiti@2.7.0 eval/src/cli/score.ts eval/results/<runId>` |

Results land in `eval/results/<runId>/` (redacted before commit). The report is `eval/REPORT.md`.
