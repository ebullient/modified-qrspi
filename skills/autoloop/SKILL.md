---
name: autoloop
description: 'QRSPI alternate execution path: implement one phase or all phases unattended, looping implement → review with one repair attempt per phase, stopping for the human on anything it cannot resolve.'
when_to_use: 'Use when the spec and plan are trusted and you want execution to run without a gate at every step. Requires a `./qrspi/<feature>/` workspace with a completed spec and plan. For gated, step-by-step execution use `qrspi-x:workflow` or `qrspi-x:implement` instead.'
disable-model-invocation: false
---

# QRSPI Autoloop

## Core Philosophy
- Spawn and track; never implement or review in this conversation
- One repair attempt per phase, then a human

## What this is

An alternate orchestrator, sibling to `qrspi-x:workflow`, for the case where you already trust the spec and the plan and don't want to approve every step.

`qrspi-x:workflow` gates every transition. Autoloop gates only the ends: you approve entry (scope and readiness), and you own the final review. Between those, it runs unattended — implement a phase, review it, repair once if the review fails, advance or stop.

This is a narrower gate contract, not an exception to QRSPI. State it plainly to the human at entry; do not present autoloop as equivalent to the gated workflow.

### What you give up

Interim reviews run on the session's model — the same model that just wrote the code. The QRSPI README's advice to review on a *different* model than the one that implemented still stands, and autoloop cannot honor it: every agent is `model: inherit` so the skill stays portable, and there is no human in the loop to switch harnesses.

So interim reviews are a **fast filter, not an independent check**. The independent check is the final review, which autoloop deliberately does not run — it stops and hands back so the human can run it themselves, on a different model. Do not let a run of interim PASSes stand in for that.

## Preconditions

Refuse to start, and say which check failed, unless all hold:

1. `./qrspi/<feature>/state.json` exists.
2. `spec.md` exists and `completedSteps` contains `spec`.
3. `plan.md` exists, `completedSteps` contains `plan`, and every phase file the scope needs exists.
4. `git status --short --untracked-files=all` shows no unexpected changes outside `./qrspi/<feature>/`. Untracked *source* files must be tracked or staged first — an unattended run must not sweep unrelated work into its commits.
5. `blockers` in `state.json` is empty. A recorded blocker means a human already stopped here; do not loop past it.

If `state.json` records a stale downstream artifact (a backward jump changed `request.md`, `queries.md`, or `research.md` after `spec.md` or the plan was written), stop and say so. Autoloop's whole premise is a trusted plan.

## Entry gate

Before spawning anything, confirm with the human:

- **Scope** — a single phase (`phase N`) or all remaining phases. Default to a single phase if unstated; all-phases is the larger commitment and should be chosen deliberately.
- **What it will do unattended** — commit per step, review each phase, repair once on failure.
- **What it will not do** — the final review.

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

Set `phaseBaseSha` to `git rev-parse HEAD` if this is a fresh phase (leave it alone when resuming mid-phase). Set `planPhase`, and `loop.cycle` to `implement`.

Spawn the implementer:

```
Spawn qrspi-x:implementer agent for feature: <feature-name>
Mode: phase
Phase: <N>
```

If it reports `STOPPED`, stop the loop — record `loop.stoppedReason`, leave the blocker it wrote in place, and go to **Handing back**. A stopped implementer is not something to retry.

### 2. Review

Set `loop.cycle` to `review`. Spawn the reviewer exactly as `qrspi-x:review` does, with the phase diff:

```
Spawn qrspi-x:reviewer agent for feature: <feature-name>
Diff: git diff <phaseBaseSha>
Phase: <N>
Label: phase-<N>
```

Do not spawn the explainer. It is an opt-in human-orientation aid and there is no human here.

Append a `history` entry for the review with its label, verdict, and artifact path, as `qrspi-x:review` does.

### 3. Act on the verdict

- **PASS** — advance.
- **PASS WITH CONDITIONS** — advance, and append each non-blocking finding to `loop.conditions` with its phase and label. Do not spend the repair on conditions; they are reported to the human at the end.
- **FAIL, repair not yet used** — go to step 4.
- **FAIL, repair already used** — stop. Record `loop.stoppedReason` and go to **Handing back**.

### 4. Repair (once per phase)

Set `loop.repairUsed` to `true` and `loop.cycle` to `repair` **before** spawning, so a crash cannot silently buy a second attempt.

```
Spawn qrspi-x:implementer agent for feature: <feature-name>
Mode: repair
Phase: <N>
Review: ./qrspi/<feature>/reviews/phase-<N>.md
```

If the implementer reports `STOPPED`, stop the loop.

### 5. Re-review

Set `loop.cycle` to `re-review`. Spawn the reviewer again on the same phase diff, with a fresh label — `phase-<N>-r2`. Never reuse a label; the reviewer stops rather than overwriting an existing artifact, and that stop would strand the loop.

PASS or PASS WITH CONDITIONS advances. FAIL stops.

### 6. Advance

Mark the phase `[x]` in `plan.md`. Increment `planPhase`, clear `phaseBaseSha`, reset `loop.repairUsed` to `false`, and continue — unless scope was a single phase, or this was the last phase.

When every phase in scope is done, set `loop.cycle` to `done` and go to **Handing back**.

## Context discipline

Do not read source files, run diffs, or read review artifacts beyond their verdict line and findings table in this conversation. Every heavy read belongs in a subagent that discards its context when it returns.

The orchestrator has to survive to the end of the run to make phase-boundary decisions and write final state. It holds scope, verdicts, and state — nothing else. An orchestrator that reads the code it is coordinating is the failure mode this design exists to avoid.

## Resuming

Autoloop is resumable because every cycle writes state before it acts. To resume, read `state.json` and dispatch on `loop.cycle`:

- `implement` — re-spawn the implementer for `loop.phase`. It resumes from the first step not marked `[x]`; completed steps are already committed and will not be redone.
- `review` — the implementer finished but the verdict may not have been recorded. Check whether `reviews/phase-<N>.md` exists: if it does, read its verdict and continue from step 3; if not, spawn the reviewer.
- `repair` — `repairUsed` is already `true`. Check for uncommitted work, then re-spawn the repair pass; if it was already committed, go to re-review.
- `re-review` — as `review`, with the `-r2` label.
- `done` — the run finished; report as in **Handing back**.

If `loop.stoppedReason` is set, the loop stopped deliberately. Do not resume past it — report it to the human and let them decide.

If `state.json` has no `loop` block, this is not a resumable autoloop run. Start from the entry gate.

## Handing back

Stop and report. Do not run the final review, do not create a PR, do not clean up artifacts.

Report:
1. **Outcome** — completed in full, or stopped (and why, from `loop.stoppedReason`).
2. **Phases completed**, with each review label and verdict.
3. **Accumulated conditions** from `loop.conditions` — every non-blocking finding the loop advanced past, grouped by phase. These were never fixed; they are the human's to triage.
4. **Where it stopped**, if it stopped: the phase, the cycle, the blocker, and the relevant review artifact path.
5. **What's next** — the final review, run by the human, ideally on a different model than this session used.

Commits are one per step. Offer to squash before the final review, but do not squash unasked — the per-step commits are the record of what the loop did, and they are the only way to see where a phase went wrong.
