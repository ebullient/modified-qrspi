---
name: implement
description: 'QRSPI Step 5: Execute the implementation plan step by step'
metadata:
  disable-model-invocation: true
---

# QRSPI Implement

## Core Philosophy
- Code is the source of truth - implementation makes the plan real
- Humans gate every transition - wait for approval between major steps
- Single responsibility - execute the plan, don't deviate

## Your Task
Execute steps from the current phase file (`./qrspi/<feature>/plan-phase-N.md`) in order. For each step:

1. **Read the Step**: Understand what needs to be done
2. **Implement Changes**: Make the exact changes specified
3. **Verify**: Run tests or checks as specified in the step
4. **Update Progress**: Mark the step as complete
5. **Pause**: Wait for human approval before continuing to next step

## Implementation Principles
- Follow the plan exactly - don't add "improvements"
- Make atomic commits after each step
- Run tests after each step
- If a step fails, stop and report the issue
- If you discover the plan is wrong, stop and explain why

## Execution Modes
- Full execution: All phases, all steps
- Phase execution: All steps within a specified phase
- Partial execution: Steps N through M within the current phase
- Single step: Only step N within the current phase

## Progress Tracking
Mark steps in the active phase file (`plan-phase-N.md`):
- `[ ]` - Not started
- `[~]` - In progress
- `[x]` - Complete
- `[!]` - Blocked or failed

Mark phases in `plan.md` the same way. A phase is complete when all its steps are `[x]`.

## Process
1. Read `./qrspi/<feature>/plan.md` to understand the phase overview
2. Read `./qrspi/<feature>/state.json` — `currentPhase` identifies which phase file to load; use `activeStepIndex`, `blockers`, and `decisions` to orient if resuming
3. Load `./qrspi/<feature>/plan-phase-<currentPhase>.md`; if resuming, start from the first `[ ]` or `[~]` step
4. For each step:
   - Mark as in progress `[~]` in the phase file
   - Update `state.json`: set `activeStepIndex` to the current step number
   - Implement the changes
   - Run verification
   - Mark as complete `[x]` or blocked `[!]` in the phase file
   - Update `state.json`: if complete, append step to `completedSteps` and clear `activeStepIndex`; if blocked, add a note to `blockers`
   - If a key decision was made (approach chosen, step modified, scope trimmed), append it to `decisions` in state.json
   - Commit changes
   - Report status
5. After each step, wait for human approval to continue
6. When all steps in a phase are `[x]`: mark the phase `[x]` in `plan.md`, update `state.json` with the next phase, and offer a checkpoint review before continuing

## Error Handling
If a step fails:
1. Mark it as blocked `[!]` in plan.md
2. Add a note to `blockers` in state.json describing what failed and why
3. Explain what went wrong
4. Suggest whether to fix the plan or adjust the implementation
5. Wait for human decision; once resolved, remove the blocker from state.json

Your job is to faithfully execute the plan, not to improve it during implementation.

## When to Use
Use this mode as the fifth step in QRSPI workflow to execute the implementation plan. Can execute all steps or a specific range. Updates plan.md with progress.

Typically invoked by `qrspi-x:workflow` orchestrator after Plan phase completes, but can be used standalone to resume interrupted implementation.
