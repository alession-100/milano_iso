# Roles and handoff protocol

## 1. Roles

| Role | Model | Responsibilities | Must NOT |
|---|---|---|---|
| Orchestrator | Opus 5.5 (main session) | Plan, write task cards, make architecture decisions (ADRs), review executor output, run gates, integrate, talk to the owner | Write bulk code, run long mechanical jobs, skip verification |
| Executor | Sonnet 5.5 (`.claude/agents/executor.md`) | Implement exactly one task card, run its verification commands, write the report | Change scope, architecture or plan; touch files outside the card; mark its own work as gate-passed |
| Reviewer | Opus 5.5, fresh context (`.claude/agents/reviewer.md`) | Independently audit a phase against `VERIFICATION.md`; try to break it; report blockers | Fix issues itself; be briefed with the executor's reasoning |
| Mechanical (optional) | Haiku 5.5 | Formatting, renaming, bulk asset conversion, docs lint | Anything needing judgement |
| Owner | Human | Answer ASK items, approve HUMAN CHECKPOINTs, decide aesthetics, provide reference images | |

Routing rule: judgement, ambiguity or architecture goes up to Opus; well-specified implementation goes down to Sonnet; purely mechanical goes to Haiku.

## 2. Handoff protocol

1. Orchestrator writes `tasks/T-<phase>.<n>.md` from `tasks/_TEMPLATE.md`.
2. Executor receives only the task card plus the files it lists. It reads nothing else unless the card says so.
3. Executor works on a branch `t-<phase>.<n>`, makes small commits, runs every verification command, then writes `reports/R-<phase>.<n>.md` from `reports/_TEMPLATE.md`.
4. Orchestrator re-runs the verification commands independently, inspects the diff and artefacts, then accepts, or issues a corrective card.
5. Every report states explicitly: deviations, assumptions, open questions. Silence means "none", so be exhaustive.

Task cards must be:
- Self-contained (no "as discussed").
- Checkable (acceptance criteria are commands, numbers or files, never adjectives).
- Small (one executor session; if it needs more, split it).

## 3. Escalation

The executor stops and reports `BLOCKED` when:
- an acceptance criterion cannot be met as written;
- the card contradicts `CLAUDE.md`, an ADR or the data;
- a required input is missing or looks wrong;
- two consecutive attempts at the same fix fail.

The orchestrator escalates to the owner when:
- a task fails after 2 corrective retries;
- a choice is irreversible, costs money, has licence implications, or is aesthetic;
- data accuracy targets cannot be met and the plan must change.

Escalation message format: problem (1 line), evidence, 2-3 options with a recommendation.

## 4. Context hygiene
- Executors start fresh for every task; the card is their whole briefing.
- The orchestrator keeps `docs/PROGRESS.md` as the single source of truth, so a new session can resume from it.
- Long outputs (logs, data dumps) go to files under `reports/artifacts/`, referenced by path, never pasted whole.

## 5. Parallelism
Independent tasks may run in parallel executors only if their output paths do not overlap and neither depends on the other. Merge sequentially, verifying after each merge.
