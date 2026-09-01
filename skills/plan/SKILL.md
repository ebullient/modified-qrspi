---
name: plan
description: 'QRSPI Step 4: Break spec into atomic, ordered implementation steps'
metadata:
  disable-model-invocation: false
---

# QRSPI Plan

## Core Philosophy
- Code is the source of truth - plans are temporary scaffolding
- Humans gate every transition - never automatically start implementation
- Single responsibility - only create the implementation roadmap

## Your Task
Transform the spec into a sequence of small, testable implementation steps. Focus on:

1. **Atomic Changes**: Each step should be independently testable
2. **Logical Order**: Steps should build on each other
3. **Risk Management**: Identify steps that might be complex or risky
4. **Testing Strategy**: Include test creation/updates in appropriate steps
5. **Rollback Points**: Ensure each step leaves code in a working state
6. **File-Level Granularity**: Specify which files will be modified in each step

## Plan Format

The plan is always two layers:

**`plan.md` — phase overview (short, readable in one pass):**
```
## QRSPI Plan: <feature>

| Phase | Name | Description | Steps | Status |
|-------|------|-------------|-------|--------|
| 1 | [Short name] | [What this phase accomplishes] | 5 | [ ] |
| 2 | [Short name] | [What this phase accomplishes] | 4 | [ ] |
| 3 | [Short name] | [What this phase accomplishes] | 3 | [ ] |
```

**`plan-phase-N.md` — detailed steps for each phase (one file per phase):**
```
## Phase N: [Phase Name]

### Step 1: [Brief description]
- [ ] Status marker
- Files: path/to/file1.ts, path/to/file2.ts
- Changes: Specific changes to make
- Tests: How to verify this step
- Risk: [Low/Medium/High] - why

### Step 2: [Brief description]
...
```

Step numbers are local to each phase file — each phase starts at Step 1. For small plans (≤5 steps total), use a single phase; `plan.md` is still the overview, `plan-phase-1.md` has all steps.

## Planning Principles
- Each step should take 5-15 minutes to implement
- Steps should be ordered to minimize breaking changes
- Include test updates alongside code changes
- Flag steps that might need extra attention
- Ensure each step is independently reviewable
- Phase boundaries should align with natural checkpoints (e.g. data layer complete, API layer complete)

## Process
1. Read `./qrspi/<feature>/spec.md` and research artifacts
2. Draft the full list of atomic steps
3. If total steps > 5: group into phases, each with a clear name and goal; pause and present the proposed phase breakdown to the user for approval before writing files
4. Once phase structure is approved (or steps ≤ 5): write `plan.md` with the phase overview table, then write each `plan-phase-N.md`
5. Stop and wait for human review of the complete plan

Do not start implementation. Your job ends when all plan files are written.

## When to Use
Use this mode as the fourth step in QRSPI workflow to break the spec into atomic, ordered implementation steps. Creates plan.md artifact.

Typically invoked by `qrspi-x:workflow` orchestrator after Spec phase completes.
