---
name: workflow
description: 'Use when starting or resuming a feature through the full QRSPI workflow.'
when_to_use: 'Use for `/qrspi-x:workflow <feature-name>`. For one step, such as a standalone review, use that step''s skill directly.'
disable-model-invocation: false
---

# QRSPI Workflow Orchestrator

## Overview

Guides you through the complete QRSPI (Init, Query, Research, Spec, Plan, Implement, Review) workflow for feature development. Handles human gates between steps and supports iterative Query ↔ Research cycles.

## Core Philosophy

These apply to all QRSPI skills:
- **Code is the source of truth** — QRSPI artifacts are disposable scaffolding
- **Humans gate every transition** — work stops at the gate and waits; never carry on past it automatically. The granularity varies: `qrspi-x:workflow` gates every step, `qrspi-x:autoloop` gates at the phase or the whole plan. The gate itself does not move — nothing is integrated without a human reviewing it.
- **Single responsibility** — each step does one job and nothing from the steps around it

## Workflow Phases

### Optional Pre-Discovery: Explore
Use `qrspi-x:explore` when you don't yet know what to build — e.g. surveying what a reference framework provides that isn't yet adapted here. Produces `./qrspi/explore/<exploration-name>/explore.md`: observations, gaps, and candidate directions. Not tied to a specific feature, not part of the phase progression below, and has no `state.json` of its own — when a direction is chosen, start the normal flow with Init for that feature. Skip this entirely when the feature is already clear.

### Discovery Phase (Iterative)
0. **Init** - Capture feature intent (`qrspi-x:init`)
1. **Query** - Surface critical questions (`qrspi-x:query`)
2. **Research** - Gather facts from codebase (`qrspi-x:research`)
   - **Cycle back to Query** if research surfaces new questions
   - Repeat until discovery is complete

### Definition Phase (Linear)
3. **Spec** - Define behavioral delta (`qrspi-x:spec`)
4. **Plan** - Break into atomic steps (`qrspi-x:plan`)

### Execution Phase (Linear with Checkpoints)
5. **Implement** - Execute plan steps (`qrspi-x:implement`)
6. **Review** - Adversarial code review (`qrspi-x:review`)
   - Can run checkpoint reviews during implementation
   - Final review before completion

### Alternate Execution: Autoloop

When the spec and plan are trusted, `qrspi-x:autoloop` can replace Steps 5–6 for one phase or all remaining phases. It runs implement → review unattended, allows one repair after a failed review, and stops on anything unresolved. It gates at a coarser granularity than this workflow — the phase, or the whole plan, rather than every step. The human still approves the scope going in and reviews the result before anything is integrated. Choose it by how much work you want to accumulate behind one gate: a short, straightforward plan is faster to review in one pass than in six. Offer it after Plan; use it only when the human chooses it.

## Usage

```bash
# Start new workflow
/qrspi-x:workflow <feature-name>

# Resume existing workflow
/qrspi-x:workflow <feature-name>

# Jump to specific step
/qrspi-x:workflow <feature-name> --step research
```

`--step <name>` (one of `init`, `query`, `research`, `spec`, `plan`, `implement`, `review`) runs that step next instead of the one `state.json` suggests. Before running it, check the inputs: `query` needs `request.md`; `research` needs `queries.md`; `spec` needs settled `request.md`, `queries.md`, and `research.md` with no pending questions; `plan` needs a current `spec.md`; `implement` needs current plan files and the selected phase file; and `review` needs current `spec.md` and `plan.md` (plus `phaseBaseSha` for a phase review). If inputs are missing or stale, name them and ask whether to run the earlier step instead. Set the matching `currentPhase`, record the jump in `history`, and do not mark the jumped-to step complete until it succeeds.

## State Tracking

The orchestrator maintains state in `./qrspi/<feature>/state.json`. This file is the primary orientation aid for resuming in a fresh conversation context — write it after every transition, not just at the end.

```json
{
  "feature": "feature-name",
  "currentPhase": "discovery",
  "currentStep": "research",
  "discoveryIterations": 2,
  "completedSteps": ["init", "query", "research"],
  "planPhase": null,
  "phaseBaseSha": null,
  "activePlanStep": null,
  "completedPlanSteps": [],
  "blockers": [],
  "decisions": [],
  "history": [
    {"step": "init", "timestamp": "2026-05-26T09:45:00Z"},
    {"step": "query", "timestamp": "2026-05-26T10:00:00Z"},
    {"step": "research", "timestamp": "2026-05-26T10:15:00Z"},
    {"step": "query", "timestamp": "2026-05-26T10:30:00Z"}
  ]
}
```

Fields:
- `currentPhase` — `discovery`, `definition`, or `execution`
- `currentStep` — the workflow step currently active or last completed (`init`, `query`, `research`, `spec`, `plan`, `implement`, `review`)
- `completedSteps` — workflow step names only (never plan step numbers); each name appears at most once, so re-running a step doesn't add it again
- `planPhase` — during implementation, the plan phase number (integer) being worked; selects `plan-phase-<planPhase>.md` (null otherwise)
- `phaseBaseSha` — the commit HEAD pointed to before the first step of `planPhase` began; used to scope phase checkpoint reviews (null otherwise)
- `activePlanStep` — the plan step in progress as `"<phase>.<step>"`, e.g. `"2.3"` (null otherwise)
- `completedPlanSteps` — completed plan steps as `"<phase>.<step>"` strings
- `blockers` — free-text notes about anything currently blocked; clear when resolved
- `decisions` — key decisions made during the workflow that aren't obvious from artifacts (e.g. "chose approach B because X", "skipped step 4 because Y"); append, never overwrite
- `discoveryIterations` — how many Research steps have completed (each Research run ends one Query→Research cycle)
- `history` — append-only log; add one entry each time a step finishes (and for `--step` jumps), with `step`, `timestamp`, and optional context such as `mode`, `reason`, `iteration`, `label`, `verdict`, and `artifact`
- `loop` — autoloop-only control block; see `qrspi-x:autoloop`. It is absent from ordinary workflow runs.

The autoloop `loop` block has this shape:

```json
{
  "scope": "phase-3",
  "cycle": "review",
  "phase": 3,
  "repairUsed": false,
  "conditions": [],
  "stoppedReason": null
}
```

`scope` is `phase-<N>` or `all`; `cycle` is `implement`, `review`, `repair`, `re-review`, or `done`; `phase` is the active phase; `repairUsed` caps repair at one attempt per phase; `conditions` stores non-blocking findings; and `stoppedReason` records why the loop stopped.

Every skill updates `state.json` when it exists, but only `qrspi-x:init` (or `qrspi-x:query`, when Init was skipped) creates it.

State updates are idempotent: `completedSteps` is a set, not an append-only list. Each skill owns its completion fields and appends exactly one history entry for each completed invocation; the orchestrator owns only navigation and `--step` jump entries. Query, Research, Spec, and Plan set `currentPhase` to their phase when rerun after a backward jump. `implement` is added to `completedSteps` only after every phase is complete, and `review` only after a final review.

When a backward jump changes `request.md`, `queries.md`, or `research.md`, existing downstream `spec.md`, plan files, and implementation progress are stale for execution purposes even if the files still exist. Run the affected steps forward again before using a downstream artifact; do not infer freshness from file existence alone. A skill may replace its own current artifact in place; Query creates backups explicitly, while Research and Spec record their reruns in history and leave the newest artifact authoritative.

## Orchestrator Behavior

### At Each Step
1. Load `state.json` (or initialize if new).
2. Announce and invoke the current step skill.
3. Wait for human review of its artifact.
4. Present the next-step options and update navigation state from the human's choice. Do not duplicate the completion or history entry written by the skill.

### After Init Step
**Prompt:** "Feature intent captured in `./qrspi/<feature>/request.md`. Next steps:
1. **Query** - Generate questions from this intent
2. **Refine Request** - Edit request.md before continuing
3. **Cancel** - Stop workflow"

### After Query Step
**Prompt:** "Queries generated in `./qrspi/<feature>/queries.md`. Next steps:
1. **Research** - Gather facts to answer these questions
2. **Regenerate Queries** - Rerun Query while preserving still-relevant questions
3. **Cancel** - Stop workflow"

### After Research Step
**Prompt:** "Research complete in `./qrspi/<feature>/research.md`. Next steps:
1. **Query Again** - Research surfaced new questions (iterations: N) — show only when `## New Questions` is non-empty; runs `qrspi-x:query` in refinement mode
2. **Spec** - Proceed to define behavioral delta — show only when `## New Questions` is empty
3. **Refine Research** - Modify research.md
4. **Cancel** - Stop workflow"

### After Spec Step
**Prompt:** "Spec complete in `./qrspi/<feature>/spec.md`. Next steps:
1. **Plan** - Break into implementation steps
2. **Back to Query/Research** - Need more codebase facts (regenerate questions while preserving prior ones, then research them)
3. **Refine Spec** - Modify spec.md
4. **Cancel** - Stop workflow"

### After Plan Step
**Prompt:** "Plan complete. Show the phase overview from `plan.md`. Next steps:
1. **Implement All** - Execute all phases in order
2. **Implement Phase N** - Execute a specific phase
3. **Autoloop** - Run implement → review unattended for one phase or all phases, gated only at entry and before the final review (`qrspi-x:autoloop`)
4. **Refine Plan** - Modify plan files
5. **Cancel** - Stop workflow"

### During Implementation (within a phase)
**Prompt after each step:** "Step N of phase M complete. Next steps:
1. **Continue** - Next step in this phase
2. **Checkpoint Review** - Review changes so far
3. **Stop** - Pause implementation"

### After Phase Completion
**Prompt:** "Phase M complete. Next steps:
1. **Phase Review** - Checkpoint review of phase M before continuing
2. **Continue to Phase M+1** - Start next phase immediately
3. **Stop** - Pause implementation"

### After All Phases Complete
**Prompt:** "All phases complete. Next steps:
1. **Final Review** - Full adversarial review of the branch
2. **Back to Plan** - Adjust plan and resume
3. **Stop** - Pause workflow"

### After Checkpoint Review
**Prompt based on verdict:**
- **PASS, phase still in progress**: "Checkpoint review passed. Continue with the next step in phase M?"
- **PASS, phase complete**: "Checkpoint review passed. Continue to the next phase (or Final Review if this was the last phase)?"
- **PASS WITH CONDITIONS** / **FAIL**: same options as After Final Review, then return to implementation of the current phase

### After Final Review
**Prompt based on verdict:**
- **PASS**: "Review PASSED. Workflow complete. Clean up QRSPI artifacts?"
- **PASS WITH CONDITIONS**: "Review passed with conditions. Address findings then re-review?"
- **FAIL**: "Review FAILED. Options: 1) Fix and re-implement 2) Revise plan 3) Revise spec"

## Key Features

1. **Iterative Discovery** - Query ↔ Research cycles are expected and tracked
2. **Human Gates** - Every transition requires explicit approval
3. **Resumable** - Can pause and resume at any step
4. **State Persistence** - Tracks history and current position
5. **Flexible Navigation** - Can jump back to earlier phases if needed
6. **Checkpoint Reviews** - Support incremental reviews during implementation

## Initialization

When starting a new workflow:
1. Check whether `./qrspi/<feature>/` exists
2. If it does not exist: invoke `qrspi-x:init` to capture the feature request into `request.md` and write the initial `state.json` (`currentPhase: "discovery"`, `currentStep: "init"`, `completedSteps: ["init"]`, `discoveryIterations: 0`, `planPhase: null`, `phaseBaseSha: null`, `activePlanStep: null`, `completedPlanSteps: []`, `blockers: []`, `decisions: []`, `history: [{"step": "init", "timestamp": "..."}]`)
3. If it does exist and `state.json` is present: this is a resume — go to the resume path below
4. After Init completes, present the After Init Step prompt and wait for the human's choice

When resuming:
1. Read `state.json` — if missing, warn the user and offer to reinitialize or abort
2. Read the artifacts for the current phase; read `plan.md` only when it exists or when `currentPhase` is `definition`/`execution`
3. If in implementation: load `plan-phase-<planPhase>.md` and scan for `[~]` (in-progress) and `[ ]` (not started) markers to confirm active step
4. Summarize current state to the user: current phase (name and number), active step, completed phases, any blockers or decisions on record
5. Offer to continue from current step or jump to another phase

After every step transition, update `state.json` before presenting options to the user.

## Cleanup

After a final review PASS, offer cleanup. Enumerate the exact existing paths under `./qrspi/<feature>/` first; never pass a broad glob to a removal command and remove nothing without the human's confirmation:
- Keep: `request.md`, `spec.md`, `reviews/`, `state.json`
- Remove only these generated artifacts when they exist (move to recoverable trash, e.g. with `trash`, rather than permanently deleting): `queries.md`, `research.md`, `plan.md`, `plan-phase-*.md`, `queries.md.bak*`, and `explain/`. If recoverable trash is unavailable, stop and ask rather than permanently deleting.
