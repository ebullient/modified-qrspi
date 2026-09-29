---
name: workflow
description: 'Use when starting or resuming a feature through the full QRSPI workflow.'
when_to_use: 'Use for `/qrspi-x:workflow <feature-name>`. For one step, such as a standalone review, use that step''s skill directly.'
disable-model-invocation: false
compatibility: Node 22+
---

# QRSPI Workflow Orchestrator

## Overview

Guides you through the complete QRSPI (Init, Query, Research, optional Shape, Spec, Plan, Implement, Review) workflow for feature development. Handles human gates between steps and supports iterative Query ↔ Research cycles.

## Core Philosophy

These apply to all QRSPI skills:
- **Code is the source of truth** — QRSPI artifacts are disposable scaffolding
- **Humans gate every transition** — work stops at the gate and waits; never carry on past it automatically. The granularity varies: `qrspi-x:workflow` gates every step, `qrspi-x:autoloop` gates at the phase or the whole plan. The gate itself does not move — nothing is integrated without a human reviewing it.
- **Single responsibility** — each step does one job and nothing from the steps around it

## The helper

The helper is recommended for interactive work and required for `autoloop`. Install it globally from the `@ebullient/qrspi-x` npm package. Choose the Helper-assisted or Interactive-only workflow below; never read or edit `state.json` directly.

## Workflow Phases

### Optional Pre-Discovery: Explore
Use `qrspi-x:explore` when you don't yet know what to build — e.g. surveying what a reference framework provides that isn't yet adapted here. Produces `./qrspi/explore/<exploration-name>/explore.md`: observations, gaps, and candidate directions. Not tied to a specific feature, not part of the phase progression below, and has no `state.json` of its own — when a direction is chosen, start the normal flow with `qrspi-x:init` for that feature. Skip this entirely when the feature is already clear.

### Discovery Phase (Iterative)
0. **Init** - Capture feature intent (`qrspi-x:init`)
1. **Query** - Surface critical questions (`qrspi-x:query`)
2. **Research** - Gather facts from codebase (`qrspi-x:research`)
   - **Cycle back to `qrspi-x:query`** if research surfaces new questions
   - Repeat until discovery is complete

### Definition Phase (Shape optional)
3. **Shape** *(optional)* - Compare implementation approaches (`qrspi-x:shape`)
4. **Spec** - Define behavioral delta (`qrspi-x:spec`)
5. **Plan** - Break into atomic steps (`qrspi-x:plan`)

### Execution Phase (Linear with Checkpoints)
6. **Implement** - Execute plan steps (`qrspi-x:implement`)
7. **Review** - Adversarial code review (`qrspi-x:review`)
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

`--step <name>` runs that step next instead of the reported or artifact-derived position. Check that step's input artifacts first. For a backward jump in helper-backed mode, the jumped-to skill records its own step with `--reason "<why>"` (`qrspi-x:query` also needs its `--mode`); do not edit `state.json` by hand. Shape is skipped when `approach.md` is absent; when it exists, its `## Decision` section is the gate.

## Helper-assisted workflow

When `qrspi-x` is available, it manages state and recovery:

- `report` is authoritative for position and the next action.
- The owning `record` command persists each step and surfaces findings.
- Helper commands handle state recovery, review labels, and phase diff scope.
- `autoloop` is available only in this mode.

### State tracking and transition contract

`./qrspi/<feature>/state.json` is written only by `qrspi-x`, installed globally from the `@ebullient/qrspi-x` npm package:

```bash
qrspi-x report --feature <feature> --project <path-to-project-root>
qrspi-x record <step> --feature <feature> --project <path> [options]
```

`--project` is the path to the project root, which `qrspi-x` treats as the project regardless of where it is installed or invoked from.

`qrspi-x` describes itself: `qrspi-x --help` lists the commands, `--help <command>` lists that command's forms, and `--help <command> <step-or-action>` gives one form's options and an example result.

Every `report`, `record`, and `loop` command prints one JSON envelope on stdout: `ok`, `command`, `feature`, `result`, `findings`, and `wrote`. Three invocations are shaped differently and are not envelopes: `--help` returns a help document, `--version` returns `{version}`, and a usage error (exit 2) or internal error (exit 4) prints a plain message on **stderr** with nothing on stdout. Parse stdout as JSON only when the exit code is 0, 1, or 3. `report`'s `result` holds `current` (position and, during execution, `planPhase` and `planProgress`; `completed: true` once the human has asserted the feature is done; and, when a loop exists, `loop`, which holds the persisted loop block's `scope`, `phases`, `cycle`, `phase`, `stoppedReason`, the `checkpoints` recorded for the feature, oldest first as `{phase, label, verdict}` (every loop run's, not only the current one's), and the accumulated `conditions` as `{phase, label, note}`, both `[]` when empty), `next` (the recommended step), `labels` (the next unused human review labels: `phase`, `step`, `final`), `diff` (the active phase's checkpoint diff command, once it has a base), and, when a loop exists, `loop` (the next loop action).

`planPhase`, `phaseBaseSha`, `commitMode`, `loop`, and `completed` are optional state fields — don't assume they're present. `currentPhase` is not persisted: the `phase` in `report`'s `current` and the `state.currentPhase` in other output are derived from `currentStep`. Progress is derived from phase-file markers; it is not duplicated in state. History entries may include `mode`, `reason`, `label`, `verdict`, `artifact`, `phase`, `by`, and `outcome`.

`record done` asserts the feature is finished: it sets `completed: true` with no position change and no history entry, and is a no-op when already set. Any other `record <step>` removes `completed`, since resuming work is itself evidence the feature isn't done. `completed` is advisory only — `qrspi-x` never refuses a `record` call because a workspace is marked done; it is up to the human and the orchestrating skill to notice and decide whether to reopen it.

| Transition | Helper command |
|---|---|
| Start/resume a definition step | `record init`, `record query --mode …`, `record research`, `record shape`, `record spec`, or `record plan` |
| Start/resume implementation | `record implement --phase <id> --commit-mode <step\|phase>` |
| Record a human review | `record review --label <label>` |
| Persist a decision | `record decision --text "<text>"` |
| Assert the feature is finished | `record done` |
| Read position and next action | `report` |
| Start/end or advance an unattended loop | `loop --start <selector>`, `loop --begin <action>`, `loop --end <action>`, `loop --advance`, `loop --stop "<reason>"`, `loop --ok ["<reason>"]`, `loop --abandon "<reason>"` (see `qrspi-x:autoloop`) |

The helper validates these Markdown formats: `plan.md` has `Phase`, `Name`, `Depends On`, and `Status` columns; each `plans/plan-phase-<id>.md` has `### Step K` headings and `- [ ]`, `- [~]`, `- [x]`, or `- [!]` markers; review files begin with `## Verdict: PASS`, `PASS WITH CONDITIONS`, `FAIL`, or checkpoint `PENDING`; question sections use list items; and a selected Shape approach is recorded under `## Decision` in `approach.md`. That section counts as decided once it holds any line other than blank lines or the literal `None.`, so leave `None.` in place until the human decides.

`report` is read-only and is the resume source. A command may return findings alongside success; surface them to the human. Hard stops and ambiguous recovery write nothing. Use `--dry-run` to inspect any write without changing state.

Staleness flows forward: changes to `request.md`, `queries.md`, or `research.md` invalidate `approach.md`, `spec.md`, plan files, and implementation progress; changes to `approach.md` invalidate `spec.md`, plan files, and implementation progress. Existing files do not prove freshness. Run the affected steps forward before using a downstream artifact. A skill may replace its own current artifact in place; Query, Research, Shape, and Spec each back up their previous artifact to `backups/` and record the rerun in history, and in every case the newest artifact is the authoritative one. Writing a backup does not make anything stale — the rerun that produced it is what drives staleness, and nothing in the workflow reads `backups/`. An optional `background.md` is human context only: it is retained when present, but is not an automatic input to Query or Research.

## Interactive-only workflow

When `qrspi-x` is unavailable, continue with human-gated execution:

- Use the artifacts, plan overview, and phase-file markers to determine progress.
- Keep navigation in the conversation and confirm each transition with the human.
- Use the direct-review rules for review scope and deterministic labels.
- There is no recovery, durable history, autoloop, or helper-derived diff scope.
- Never create or edit `state.json` manually.

## Orchestrator Behavior

### At Each Step
1. In helper-assisted mode, run `report` to read the position; in interactive-only mode, determine the next step from the workflow artifacts (or invoke `qrspi-x:init` if the workspace is new).
2. Announce and invoke the current step skill.
3. Wait for human review of its artifact.
4. Present the next-step options. In helper-assisted mode, update navigation through the helper; in interactive-only mode, keep navigation in the conversation. Do not duplicate the completion or history entry written by the skill.

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
2. **Shape** - Compare implementation approaches when the direction is not obvious — show only when `## New Questions` is empty.
3. **Spec** - Proceed directly to define the behavioral delta when the approach is obvious, or after an approved `approach.md`. If choosing Spec directly, helper-assisted mode records why Shape was skipped with `record decision --text "<why>"`; interactive-only mode states the reason to the human.
4. **Refine Research** - Modify research.md
5. **Cancel** - Stop workflow"

### After Shape Step
**Prompt:** "Approach options are in `./qrspi/<feature>/approach.md`. When the human selects an option, replace the `None.` placeholder under `## Decision` with the option and rationale before offering Spec. Then choose:
1. **Spec** - Define the behavioral delta using the selected approach
2. **Back to Query/Research** - Resolve an evidence gap exposed by shaping
3. **Refine Shape** - Recompare the approaches
4. **Cancel** - Stop workflow"

### After Spec Step
**Prompt:** "Spec complete in `./qrspi/<feature>/spec.md`. Next steps:
1. **Plan** - Break into implementation steps
2. **Back to Shape** - Reconsider the implementation approach
3. **Back to Query/Research** - Need more codebase facts (regenerate questions while preserving prior ones, then research them)
4. **Refine Spec** - Modify spec.md
5. **Cancel** - Stop workflow"

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
- **PASS**: "Review PASSED. Workflow complete. In helper-assisted mode, mark this feature done? In interactive-only mode, report completion?" On yes, run `record done` when the helper is available. `./qrspi/<feature>/` is left as-is either way; cleaning it up is the human's call, not the workflow's.
- **PASS WITH CONDITIONS**: "Review passed with conditions. Address findings then re-review?"
- **FAIL**: "Review FAILED. Options: 1) Fix and re-implement 2) Revise plan 3) Revise spec"

## Key Features

1. **Iterative Discovery** - Query ↔ Research cycles are expected and tracked
2. **Human Gates** - Every transition requires explicit approval
3. **Resumable in helper-assisted mode** - Can pause and resume at any step
4. **State Persistence in helper-assisted mode** - Tracks history and current position
5. **Flexible Navigation** - Can jump back to earlier phases if needed
6. **Optional Shaping** - Compare implementation approaches only when the direction is not obvious
7. **Checkpoint Reviews** - Support incremental reviews during implementation

## Helper-driven workflow

1. Check whether `./qrspi/<feature>/` exists
2. If it does not exist: invoke `qrspi-x:init`; that skill writes `request.md`, then calls `record init`.
3. If it exists, ensure that `request.md` captures the feature intent. If `request.md` is missing, route back through `qrspi-x:init` to capture it and stop. If it exists, this is a resume — go to the resume path below. Helper commands recover or create missing state as needed.

When resuming:

1. Run `report` and surface its findings. If recovery reports an ambiguity, stop and show it so the human can repair it.
2. Read the artifacts for the phase named by `result.current.phase`; read `plan.md` when it exists or when the current phase is definition or execution.
3. If `report` returns an `approach-undecided` finding or `next.gate` is `decide`, remain at the human Shape gate and do not dispatch `qrspi-x:spec`.
4. During implementation, use `result.current.planPhase` and `result.current.planProgress`; do not infer the next phase or step from the files when `result.next` provides it.
5. If `result.loop` is present, hand the run to `qrspi-x:autoloop` to resume.
6. Summarize the position, findings, blockers, decisions, and `result.next` action reported by the helper.
7. Offer to continue from `result.next.step` or jump to another phase.

After every step transition, the owning skill calls the helper before presenting options to the user.

## Interactive-only workflow

1. Check whether `./qrspi/<feature>/` exists
2. If it does not exist: invoke `qrspi-x:init`; that skill writes `request.md` and continues without state tracking.
3. If it exists, ensure that `request.md` captures the feature intent. If `request.md` is missing, route back through `qrspi-x:init` to capture it and stop. If it exists, this is a resume — determine the next step from the artifacts and plan markers.

After Init completes, present the After Init Step prompt and wait for the human's choice.

When resuming:

1. Read the artifacts in workflow order: `request.md`, `queries.md`, `research.md`, optional `approach.md`, `spec.md`, `plan.md`, and the phase files.
2. If an earlier required artifact is missing, resume at the skill that creates it. If `research.md` has a non-empty `## New Questions`, resume at `qrspi-x:query`.
3. If `approach.md` exists, inspect its `## Decision` section. If it is undecided, stop at the human Shape gate; do not dispatch `qrspi-x:spec`.
4. If implementation has begun, read the plan table and phase-file markers. Select the first incomplete phase whose dependencies are complete, then the first incomplete step in that phase. Stop on an ambiguous or `[!]` marker and ask the human.
5. For a review, inspect the relevant plan and diff scope, then use the direct-review label rules; do not infer helper labels or phase diff commands.
6. Summarize the artifacts examined, the proposed next step, and any ambiguity. Ask the human to confirm before continuing.

After every step transition, the step's artifact and the human's choice are the progress record.

## Completion

After a final review PASS, helper-assisted mode may offer to mark the feature done with `record done` (see **State tracking and transition contract**). Interactive-only mode reports completion without state tracking. The workflow does not clean up `./qrspi/<feature>/` itself, before or after marking done — disposing of any artifact there, including the generated ones, is the human's call.
