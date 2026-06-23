---
name: workflow
description: >-
  Orchestrate the full QRSPI workflow (Query → Research → Spec → Plan →
  Implement → Review) with human gates between steps
metadata:
  disable-model-invocation: true
---

# QRSPI Workflow Orchestrator

## Overview

Guides you through the complete QRSPI (Query, Research, Spec, Plan, Implement, Review) workflow for feature development. Handles human gates between steps and supports iterative Query ↔ Research cycles.

## Workflow Phases

### Discovery Phase (Iterative)
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

## Usage

```bash
# Start new workflow
/qrspi-x:workflow <feature-name>

# Resume existing workflow
/qrspi-x:workflow <feature-name>

# Jump to specific step
/qrspi-x:workflow <feature-name> --step research
```

## State Tracking

The orchestrator maintains state in `./qrspi/<feature>/state.json`. This file is the primary orientation aid for resuming in a fresh conversation context — write it after every transition, not just at the end.

```json
{
  "feature": "feature-name",
  "currentPhase": "discovery",
  "currentStep": "research",
  "discoveryIterations": 2,
  "completedSteps": ["query", "research"],
  "activeStepIndex": null,
  "blockers": [],
  "decisions": [],
  "history": [
    {"step": "query", "timestamp": "2026-05-26T10:00:00Z"},
    {"step": "research", "timestamp": "2026-05-26T10:15:00Z"},
    {"step": "query", "timestamp": "2026-05-26T10:30:00Z"}
  ]
}
```

Fields:
- `currentPhase` — `discovery`, `definition`, or `execution`
- `currentStep` — the step currently active or last completed
- `activeStepIndex` — during implementation, the plan step number in progress (null otherwise)
- `blockers` — free-text notes about anything currently blocked; clear when resolved
- `decisions` — key decisions made during the workflow that aren't obvious from artifacts (e.g. "chose approach B because X", "skipped step 4 because Y"); append, never overwrite
- `discoveryIterations` — how many Query→Research cycles have completed

## Orchestrator Behavior

### At Each Step
1. Load current state from `state.json` (or initialize if new)
2. Announce current step and what it will do
3. Invoke the appropriate skill (e.g., `qrspi-x:query`)
4. Wait for human review of the artifact
5. Present options for next step
6. Update state based on user choice

### After Query Step
**Prompt:** "Queries generated in `./qrspi/<feature>/queries.md`. Next steps:
1. **Research** - Gather facts to answer these questions
2. **Refine Queries** - Modify queries.md before researching
3. **Cancel** - Stop workflow"

### After Research Step
**Prompt:** "Research complete in `./qrspi/<feature>/research.md`. Next steps:
1. **Query Again** - Research surfaced new questions (iterations: N)
2. **Spec** - Proceed to define behavioral delta
3. **Refine Research** - Modify research.md
4. **Cancel** - Stop workflow"

### After Spec Step
**Prompt:** "Spec complete in `./qrspi/<feature>/spec.md`. Next steps:
1. **Plan** - Break into implementation steps
2. **Back to Research** - Need more codebase facts
3. **Refine Spec** - Modify spec.md
4. **Cancel** - Stop workflow"

### After Plan Step
**Prompt:** "Plan complete. Show the phase overview from `plan.md`. Next steps:
1. **Implement All** - Execute all phases in order
2. **Implement Phase N** - Execute a specific phase
3. **Refine Plan** - Modify plan files
4. **Cancel** - Stop workflow"

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
2. **Back to Plan** - Adjust plan and resume"

### After Review
**Prompt based on verdict:**
- **PASS**: "Review PASSED. Workflow complete. Cleanup QRSPI artifacts?"
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
2. If it does not exist: create the directory and write `state.json` with initial values (`currentPhase: "discovery"`, `currentStep: "query"`, `completedSteps: []`, `discoveryIterations: 0`, `activeStepIndex: null`, `blockers: []`, `decisions: []`, `history: []`)
3. If it does exist and `state.json` is present: this is a resume — go to the resume path below
4. Start with Query step

When resuming:
1. Read `state.json` — if missing, warn the user and offer to reinitialize or abort
2. Read `plan.md` to confirm phase structure and overall status
3. If in implementation: load `plan-phase-<currentPhase>.md` and scan for `[~]` (in-progress) and `[ ]` (not started) markers to confirm active step
4. Summarize current state to the user: current phase (name and number), active step, completed phases, any blockers or decisions on record
5. Offer to continue from current step or jump to another phase

After every step transition, update `state.json` before presenting options to the user.

## Cleanup

After successful completion:
- Offer to archive QRSPI artifacts to `./qrspi/<feature>/archive/`
- Keep spec.md and plan.md for reference
- Delete queries.md and research.md (captured in code/commits)
- Preserve review artifacts for audit trail

## When to Use

Use this skill when starting a new feature with QRSPI methodology. The orchestrator handles:
- Step sequencing and state management
- Human approval gates
- Discovery iteration cycles
- Navigation between steps

For one-off step execution (e.g., just running a review), use individual QRSPI skills directly.
