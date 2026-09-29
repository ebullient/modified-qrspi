---
name: plan
description: 'Use when turning an approved QRSPI spec into phased implementation steps.'
when_to_use: 'Use for the Plan step after Spec is approved. Use `qrspi-x:workflow` for orchestration or `qrspi-x:implement` to execute an existing plan.'
disable-model-invocation: false
compatibility: Node 22+
---

# QRSPI Plan

## Core Philosophy
- Only create the implementation roadmap

This skill is part of the QRSPI workflow and is normally invoked by `qrspi-x:workflow`. It may also be invoked directly.

## The helper
Helper installation, state tracking, recovery, and artifact-only fallback are defined by `qrspi-x:workflow`. When the helper is available, run `qrspi-x record plan --feature <feature> --project <path>` and surface its findings. If it exits 127, continue this interactive step without state tracking. Never edit `state.json` manually.

## Task
Turn the spec into a dependency-aware roadmap of small, testable steps. Ensure:

1. Each step is independently testable and names its files.
2. Each dependency names a concrete output from another phase; phase order alone is not a dependency.
3. Include test creation/updates in or as appropriate steps.
4. Risky work and rollback points are explicit.

## Plan Format

The plan is always two layers:

**`plan.md` — phase overview (short, readable in one pass):**
```
## QRSPI Plan: <feature>

| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | [Short name] | none | [What this phase accomplishes] | 5 | [ ] |
| 2 | [Short name] | 1 | [What this phase accomplishes] | 4 | [ ] |
| 3 | [Short name] | 1, 2 | [What this phase accomplishes] | 3 | [ ] |
```

`Depends On` contains only direct prerequisite phase IDs, or `none`. The table's phase order is the default presentation/execution order; it does not imply a dependency.

**`plans/plan-phase-N.md` — detailed steps for each phase (one file per phase):**
```
## Phase N: [Phase Name]

### Dependencies
- Depends on: [Phase IDs, or none]
- Why: [Concrete interface, type, schema, artifact, or other output required from those phases; explain why `none` when independent]

### Step 1: [Brief description]
- [ ] Status marker
- Files: path/to/file1.ts, path/to/file2.ts
- Changes: Specific changes to make
- Tests: How to verify this step
- Risk: [Low/Medium/High] - why

### Step 2: [Brief description]
...
```

Phase files live in `./qrspi/<feature>/plans/`; `plan.md` stays in the workspace root. Step numbers are local to each phase file — each phase starts at Step 1. For small plans (≤5 steps total), use a single phase; `plan.md` is still the overview, `plans/plan-phase-1.md` has all steps.

## Planning Principles
- Each step should take 5-15 minutes to implement
- Steps within a phase should be ordered to minimize breaking changes
- Include test updates alongside code changes
- Flag steps that might need extra attention
- Ensure each step is independently reviewable
- Phases are vertical slices: each phase ends with a thin, working, testable piece of behavior that cuts through every layer it needs (e.g. "create item end to end", then "list items end to end"), not a horizontal layer (all data layer, then all API). Layer-by-layer phases hide integration bugs until the last phase.
- Phases may be listed in a convenient default order, but only concrete prerequisites create dependencies. Independent phases remain unlinked even when they are listed consecutively.

## Process
1. Read `./qrspi/<feature>/spec.md`, `./qrspi/<feature>/research.md`, and `./qrspi/<feature>/approach.md` when Shape was run
2. If `approach.md` exists, stop unless its `## Decision` section is decided (holds something other than `None.`); the plan must not bypass the Shape decision gate.
3. Draft the full list of atomic steps, honoring the selected approach when `approach.md` exists
4. If total steps > 5: group into phases, each with a clear name and goal; pause and present the proposed phase breakdown to the user for approval before writing files
5. Once the phase structure is approved (or steps ≤ 5), perform the dependency check for every phase:
   - Ignore the phase's position in the table and identify the concrete inputs it requires from work in another phase.
   - If another phase produces a required input, record that phase's ID in `Depends On` and name the required output in the phase's `Dependencies` section.
   - If the phase can be implemented and reviewed without output from another phase, record `none`.
   - Do not create an edge merely because a phase is listed earlier or because serial execution is more convenient.
6. Write `./qrspi/<feature>/plan.md` with the phase overview table, then write each `./qrspi/<feature>/plans/plan-phase-N.md`
7. If the helper is available, run `qrspi-x record plan --feature <feature> --project <path>` (add `--mode revision --reason "<why>"` for a revision). Surface returned findings with the human. The helper selects the first ready phase from the phase markers.
8. Stop and wait for human review of the complete plan

Do not start implementation. Your job ends when all plan files are written.
