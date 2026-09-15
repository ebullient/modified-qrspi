---
name: plan
description: 'QRSPI Step 4: break spec.md into phased, atomic, ordered implementation steps (plan.md + plan-phase-N.md).'
when_to_use: 'Use for the Plan step of a QRSPI workflow, after the spec is approved. Use only within a QRSPI workflow — a `./qrspi/<feature>/` workspace exists, or the user asks for QRSPI or names this step.'
disable-model-invocation: false
---

# QRSPI Plan

## Core Philosophy
- Only create the implementation roadmap

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
- Phases are vertical slices: each phase ends with a thin, working, testable piece of behavior that cuts through every layer it needs (e.g. "create item end to end", then "list items end to end"), not a horizontal layer (all data layer, then all API). Layer-by-layer phases hide integration bugs until the last phase.

## Process
1. Read `./qrspi/<feature>/spec.md` and research artifacts
2. Draft the full list of atomic steps
3. If total steps > 5: group into phases, each with a clear name and goal; pause and present the proposed phase breakdown to the user for approval before writing files
4. Once phase structure is approved (or steps ≤ 5): write `plan.md` with the phase overview table, then write each `plan-phase-N.md`
5. If `state.json` exists, update it idempotently: set `currentPhase: "definition"` and `currentStep: "plan"`, ensure `"plan"` appears only once in `completedSteps`, set `planPhase: 1` for a new plan, and append one history entry. When this is a plan revision after implementation began, rewrite phase and step markers as not started, reset `planPhase`, `phaseBaseSha`, `activePlanStep`, and `completedPlanSteps`, and record the revision in `decisions` so stale execution progress is not reused.
6. Stop and wait for human review of the complete plan

Do not start implementation. Your job ends when all plan files are written.
