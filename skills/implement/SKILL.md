---
name: implement
description: 'Use when executing or resuming a QRSPI implementation plan.'
when_to_use: 'Use for the Implement step of a QRSPI workflow or to resume an interrupted implementation. Use `qrspi-x:autoloop` only when the human explicitly chooses unattended execution.'
disable-model-invocation: false
compatibility: Node 22+
---

# QRSPI Implement

## Core Philosophy
- Execute the plan, don't deviate

This skill is part of the QRSPI workflow and is normally invoked by `qrspi-x:workflow`. It may also be invoked directly.

## The helper
Helper installation, state tracking, recovery, and artifact-only fallback are defined by `qrspi-x:workflow`. When the helper is available, run `qrspi-x record implement --feature <feature> --project <path> --phase <id> --commit-mode <step|phase>` and use `qrspi-x record decision --feature <feature> --project <path> --text "<decision>"` for durable decisions. If it exits 127, continue this interactive step without state tracking. Never edit `state.json` manually.

## Task
Execute `./qrspi/<feature>/plans/plan-phase-N.md` in order. For each step:

1. Read the step.
2. Make only its specified changes.
3. Run its verification.
4. Mark progress.
5. Pause where the execution mode requires.

## Implementation Principles
- Follow the plan exactly - don't add "improvements"
- Make one commit per phase, amended as steps complete, unless the human asks for a commit per step
- Run the verification specified for each step.
- If a step fails, stop and report the issue
- If you discover the plan is wrong, stop and explain why

## Execution Modes
The mode sets both the range of steps and where to pause for human approval:
- Single step: only step N within the current phase — pause after the step
- Partial execution: steps N through M within the current phase — pause after each step
- Phase execution: all steps within a specified phase — pause at the end of the phase
- Full execution: all phases, all steps — pause at each phase boundary

In every mode, stop immediately and wait for the human when a step fails, a blocker appears, or a step can't be done as written. If no mode was specified, use single step.

## Changing the Plan
Do not modify, skip, reorder, or trim a step on your own. If a step can't be done as written, stop, explain why, and propose the change. Only after the human approves: update the phase file; in helper-assisted mode, also run the helper's `record decision --text "<decision>"` (see Process). In interactive-only mode, report the decision to the human without editing `state.json`.

## Progress Tracking
Mark steps in the active phase file (`plans/plan-phase-N.md`):
- `[ ]` - Not started
- `[~]` - In progress
- `[x]` - Complete
- `[!]` - Blocked or failed

Mark phases in `plan.md` the same way. A phase is complete when all its steps are `[x]`.

## Process
When the helper is available, run `qrspi-x <command> --feature <feature> --project <path>`; otherwise continue this interactive step from the plan and phase-file markers without state tracking.

1. Read `./qrspi/<feature>/plan.md` to understand the phase overview
2. Orient yourself:
    - If the helper is available, run `report` to orient. If recovery reports an ambiguity, stop and ask the human. Missing state is not by itself a stop; helper commands recover or create it as needed. `result.next.phase` (or `result.current.planPhase` when resuming) is the phase to work; `result.current.planProgress` shows which steps the markers say are done.
    - Without the helper, determine the phase from the plan and markers and confirm it with the human.
3. Inspect `git status --short --untracked-files=all` and stop for unexpected changes outside `qrspi/`.
4. State update: If the helper is available, run `record implement --phase <id> --commit-mode <step|phase>`: `phase` by default, `step` if the human asked for one commit per step. The same command starts a fresh phase and resumes the active one, and a repeat call changes nothing. The helper records the phase base on a fresh start and keeps it on resume. Surface any findings (dirty tree, incomplete dependency, base reset) before continuing.
5. Load `./qrspi/<feature>/plans/plan-phase-<id>.md`; if resuming, start from the first `[ ]` or `[~]` step
6. For each step, in order:
   - Mark as in progress `[~]` in the phase file
   - Implement the changes
   - Run verification. If it fails, or the step is blocked, follow Error Handling; do not commit a half-finished step.
   - Commit (in `phase` commit mode, create the phase's commit on its first step and amend it afterward). Stage new source files explicitly; QRSPI artifacts remain excluded from the product diff.
   - Mark as complete `[x]` in the phase file. Commit first, so a step marked `[x]` is always committed. The markers are the progress record; do not edit `state.json` for step progress.
   - Decisions: When the helper is available, run `record decision --text "<decision>"` to create a record of the decision, otherwise, report it to the human.
   - Report the result
7. Pause where the execution mode requires.
8. When all steps in a phase are `[x]`, mark the phase `[x]` in `plan.md`, ensure all implementation changes are tracked or committed, and offer a checkpoint review.
    - In helper-assisted mode, use `report`'s `result.diff` as the phase diff. The helper derives completed plan steps from markers; do not edit state for phase completion.
    - In interactive-only mode, use the direct-review scope rules.

## Error Handling
If a step fails:
1. Mark it as blocked `[!]` in the phase file (`plans/plan-phase-N.md`)
2. Leave the step `[!]` and report the reason; interactive implementation does not write loop blockers.
3. Explain what went wrong
4. Suggest whether to fix the plan or adjust the implementation
5. Wait for the human decision.

Your job is to faithfully execute the plan, not to improve it during implementation.
