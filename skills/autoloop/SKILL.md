---
name: autoloop
description: 'Use when a trusted QRSPI spec and plan should run unattended for one phase or all remaining phases.'
when_to_use: 'Use when a `./qrspi/<feature>/` workspace has an approved spec and plan and you want unattended execution. For human-gated execution, use `qrspi-x:workflow` or `qrspi-x:implement`.'
disable-model-invocation: false
---

# QRSPI Autoloop

## Core Philosophy
- Spawn and track; never implement or review in this conversation
- One repair attempt per phase, then a human

## What this is

Autoloop is the unattended sibling of `qrspi-x:workflow`. The human approves the scope and readiness at entry, then owns the final review; autoloop implements each phase, reviews it, repairs once after a failure, and advances or stops.

This is a coarser gate, not a removed one. The human approves the scope and reviews the result; what changes is how much work accumulates in between. State that distinction at entry.

### What you give up

Interim reviews use the same inherited model that wrote the code, so they are a **fast filter, not an independent check**. Autoloop deliberately stops before final review so the human can run that review separately, ideally on a different model. Interim PASSes do not replace it.

## Preconditions

Refuse to start, naming the failed check, unless all hold:

1. `./qrspi/<feature>/state.json` exists.
2. `spec.md` exists and `completedSteps` contains `spec`.
3. `plan.md` exists, `completedSteps` contains `plan`, and every phase file in scope exists.
4. `git status --short --untracked-files=all` shows no unexpected changes outside `./qrspi/<feature>/`. Untracked *source* files must be tracked or staged first — an unattended run must not sweep unrelated work into its commits.
5. `blockers` in `state.json` is empty. A recorded blocker means a human already stopped here; do not loop past it.

If `state.json` records a stale downstream artifact (a backward jump changed `request.md`, `queries.md`, or `research.md` after `spec.md` or the plan was written), stop and say so. Autoloop's whole premise is a trusted plan.

## Entry gate

Before spawning, confirm with the human:

- **Scope** — a single phase (`phase N`) or all remaining phases. Default to a single phase if unstated; all-phases is the larger commitment and should be chosen deliberately.
- **What it will do unattended** — commit per step, review each phase, and repair once on failure.
- **What it will not do** — run the final review.

Wait for a clear yes. This is the only approval you will get.

## Loop state

Autoloop adds one `loop` block to `state.json`, alongside the existing fields. Everything else — `planPhase`, `phaseBaseSha`, `completedPlanSteps`, `blockers`, `decisions`, `history` — keeps its existing meaning and is maintained as usual.

```json
"loop": {
  "scope": "phase-3",
  "cycle": "review",
  "phase": 3,
  "repairUsed": false,
  "conditions": [
    {"phase": 2, "label": "phase-2", "note": "MEDIUM: missing null check in parser"}
  ],
  "stoppedReason": null
}
```

- `scope` — `"phase-<N>"` or `"all"`, as approved at the entry gate
- `phase` — the phase currently being worked
- `cycle` — where inside the phase this run is: `implement`, `review`, `repair`, `re-review`, or `done`
- `repairUsed` — whether this phase has already spent its one repair attempt; reset to `false` when advancing to a new phase
- `conditions` — accumulated non-blocking findings from PASS WITH CONDITIONS verdicts, carried to the end for the human
- `stoppedReason` — why the loop stopped, or `null` if it is running or finished cleanly

Write the `loop` block **before** each spawn, not after. A session that dies mid-spawn must leave behind a record of what it was doing, not what it had last finished.

## The loop

For each phase in scope, in order:

### 1. Implement

Set `currentPhase` to `execution`, `currentStep` to `implement`, and `loop.cycle` to `implement`. Set `phaseBaseSha` to `git rev-parse HEAD` for a fresh phase; leave it unchanged when resuming. Set `planPhase` and `loop.phase` to the active phase — resume dispatches on `loop.phase`, so a phase that is never written cannot be resumed.

Spawn the implementer:

```
Spawn qrspi-x:implementer agent for feature: <feature-name>
Mode: phase
Phase: <N>
```

If it reports `STOPPED`, record `loop.stoppedReason`, preserve its blocker, and go to **Handing back**. Do not retry it.

### 2. Review

Set `currentStep` and `loop.cycle` to `review`. Spawn the reviewer as `qrspi-x:review`, using the phase diff:

```
Spawn qrspi-x:reviewer agent for feature: <feature-name>
Diff: git diff <phaseBaseSha>
Phase: <N>
Label: phase-<N>
```

Do not spawn the explainer; it is an opt-in aid for a human who is present.

Append the review's label, verdict, and artifact path to `history`.

### 3. Act on the verdict

- **PASS** — advance.
- **PASS WITH CONDITIONS** — advance, and append each non-blocking finding to `loop.conditions` with its phase and label. Do not spend the repair on conditions; they are reported to the human at the end.
- **FAIL, repair not yet used** — go to Step 4.
- **FAIL, repair already used** — record `loop.stoppedReason` and go to **Handing back**.

### 4. Repair (once per phase)

Set `currentStep` to `implement`, `loop.repairUsed` to `true`, and `loop.cycle` to `repair` **before** spawning; a crash must not silently buy a second attempt.

```
Spawn qrspi-x:implementer agent for feature: <feature-name>
Mode: repair
Phase: <N>
Review: ./qrspi/<feature>/reviews/phase-<N>.md
```

If it reports `STOPPED`, stop the loop.

### 5. Re-review

Set `currentStep` to `review` and `loop.cycle` to `re-review`. Spawn the reviewer again on the same phase diff, with a fresh label — `phase-<N>-r2`. Never reuse a label; the reviewer stops rather than overwriting an existing artifact, and that stop would strand the loop.

PASS or PASS WITH CONDITIONS advances; FAIL stops.

### 6. Advance

Mark the phase `[x]` in `plan.md`. Unless this was the last phase or scope was a single phase, increment `planPhase`, clear `phaseBaseSha`, reset `loop.repairUsed` to `false`, and continue.

When every phase in scope is done, set `loop.cycle` to `done` and go to **Handing back**.

## Context discipline

Do not read source files, run diffs, or read review artifacts beyond the verdict and findings table. Put every heavy read in a subagent. The orchestrator holds only scope, verdicts, and state so it can survive to the end of the run.

## Resuming

To resume, read `state.json` and dispatch on `loop.cycle`:

- `implement` — respawn the implementer for `loop.phase`. It resumes at the first step not marked `[x]`; completed steps are committed and will not be redone.
- `review` — the implementer finished but the verdict may not have been recorded. Check whether `reviews/phase-<N>.md` exists: if it does, read its verdict and continue from step 3; if not, spawn the reviewer.
- `repair` — `repairUsed` is already `true`. Check for uncommitted work, then re-spawn the repair pass; if it was already committed, go to re-review.
- `re-review` — as `review`, with the `-r2` label.
- `done` — the run finished; report as in **Handing back**.

If `loop.stoppedReason` is set, report it and wait for the human; do not resume past it.

If `state.json` has no `loop` block, this is not a resumable autoloop run. Start from the entry gate.

## Handing back

Stop and report. Do not run the final review, create a PR, or clean up artifacts.

Report:
1. **Outcome** — completed in full, or stopped (and why, from `loop.stoppedReason`).
2. **Phases completed**, with each review label and verdict.
3. **Accumulated conditions** from `loop.conditions` — every non-blocking finding the loop advanced past, grouped by phase. These were never fixed; they are the human's to triage.
4. **Where it stopped**, if it stopped: the phase, the cycle, the blocker, and the relevant review artifact path.
5. **What's next** — the final review, run by the human, ideally on a different model than this session used.

Commits are one per step. Offer to squash before the final review, but do not squash unasked — the per-step commits are the record of what the loop did, and they are the only way to see where a phase went wrong.
