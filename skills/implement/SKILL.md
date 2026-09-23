---
name: implement
description: 'Use when executing or resuming a QRSPI implementation plan.'
when_to_use: 'Use for the Implement step of a QRSPI workflow or to resume an interrupted implementation. Use `qrspi-x:autoloop` only when the human explicitly chooses unattended execution.'
disable-model-invocation: false
---

# QRSPI Implement

## Core Philosophy
- Execute the plan, don't deviate

## Task
Execute `./qrspi/<feature>/plan-phase-N.md` in order. For each step:

1. Read the step.
2. Make only its specified changes.
3. Run its verification.
4. Mark progress.
5. Pause where the execution mode requires.

## Implementation Principles
- Follow the plan exactly - don't add "improvements"
- Make atomic commits after each step, unless the human asks for one commit per phase
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
Do not modify, skip, reorder, or trim a step on your own. If a step can't be done as written, stop, explain why, and propose the change. Only after the human approves: update the phase file and record the change in `decisions` in state.json.

## Progress Tracking
Mark steps in the active phase file (`plan-phase-N.md`):
- `[ ]` - Not started
- `[~]` - In progress
- `[x]` - Complete
- `[!]` - Blocked or failed

Mark phases in `plan.md` the same way. A phase is complete when all its steps are `[x]`.

## Process
1. Read `./qrspi/<feature>/plan.md` to understand the phase overview
2. Read `./qrspi/<feature>/state.json` — `planPhase` identifies which phase file to load; use `activePlanStep`, `blockers`, and `decisions` to orient if resuming. Set `currentPhase: "execution"` and `currentStep: "implement"`. If `state.json` is missing, stop and ask the human to initialize or repair the workspace; do not silently run without tracking. If `planPhase` is null, take the first phase in `plan.md` not marked `[x]`, confirm it with the human, and record it in `state.json`.
3. Load `./qrspi/<feature>/plan-phase-<planPhase>.md`; if resuming, start from the first `[ ]` or `[~]` step
4. When starting a phase (no step in it has begun yet): inspect `git status --short --untracked-files=all`. Expected changes under `./qrspi/<feature>/` are allowed because QRSPI artifacts are not checked in; stop for unexpected changes outside that directory. Then set `phaseBaseSha` in `state.json` to the output of `git rev-parse HEAD`. Do not change it when resuming mid-phase.
5. For each step, in order:
   - Mark as in progress `[~]` in the phase file
   - Update `state.json`: set `activePlanStep` to `"<phase>.<step>"` (e.g. `"2.3"`)
   - Implement the changes
   - Run verification
   - Mark as complete `[x]` or blocked `[!]` in the phase file
   - Update `state.json`: if complete, ensure `"<phase>.<step>"` appears only once in `completedPlanSteps` and clear `activePlanStep`; if blocked, add a note to `blockers`
   - If a key decision was made (approach chosen, or a human-approved step change), append it to `decisions` in state.json
   - Commit changes (unless the human has asked for a single commit at the end of the phase). Before any checkpoint review, ensure new implementation/source files are tracked or staged; QRSPI artifacts remain excluded from the product diff.
   - Report the result
6. Pause where the execution mode requires.
7. When all steps in a phase are `[x]`: mark the phase `[x]` in `plan.md`, ensure all implementation changes are tracked or committed, and offer a phase checkpoint review (the review uses the current `planPhase` and `phaseBaseSha`). When moving on, increment `planPhase` and clear `phaseBaseSha` so step 4 records a fresh base for the next phase. When all phases are complete, ensure `"implement"` appears only once in `completedSteps`; do not start another phase.

## Error Handling
If a step fails:
1. Mark it as blocked `[!]` in the phase file (`plan-phase-N.md`)
2. Add a note to `blockers` in state.json describing what failed and why
3. Explain what went wrong
4. Suggest whether to fix the plan or adjust the implementation
5. Wait for human decision; once resolved, remove the blocker from state.json

Your job is to faithfully execute the plan, not to improve it during implementation.
