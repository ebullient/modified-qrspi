---
name: spec
description: 'Use when defining the behavioral delta for a QRSPI feature.'
when_to_use: 'Use for the Spec step after Query ↔ Research is complete. Use `qrspi-x:query` or `qrspi-x:research` if intent or codebase facts are still unclear.'
disable-model-invocation: false
---

# QRSPI Spec

## Core Philosophy
- Specs describe changes, not the entire system — only define the behavioral contract

## Task
Using the settled request, queries, and research, define exactly what changes. Cover:

1. **Behavioral Changes**: What new behaviors are being added?
2. **API Contracts**: What interfaces will change or be added?
3. **Data Changes**: What data structures or schemas will change?
4. **Integration Points**: Which existing systems, contracts, or boundaries are affected?
5. **Backwards Compatibility**: What existing behavior must be preserved?
6. **Success Criteria**: How will we verify this works correctly?
7. **Out of Scope**: What explicitly will NOT change?

## Spec Format
Create `./qrspi/<feature>/spec.md` with:
- Clear before/after descriptions for each change
- Concrete examples of inputs and outputs
- Explicit statements about what stays the same
- No implementation details (no "how", only "what")
- Testable acceptance criteria

## Process

### Step 0 — Verify the request is settled
Before writing any spec, confirm that `request.md` captures a clear, agreed-upon intent:

1. Read `./qrspi/<feature>/request.md`.
2. Read `./qrspi/<feature>/queries.md` and `./qrspi/<feature>/research.md`.
3. Check `request.md` for a non-empty `## Open Questions` section — these are Questions for the User from the query cycles that haven't been answered yet. If any remain, **stop**, surface them to the human, and wait for answers; move each answered question to `## Clarifications` with its answer before continuing. Check `research.md`'s `## New Questions` too: if it is non-empty, **stop** and return to Query before writing the spec.
4. Confirm the request reads as a concrete feature intent, not as a conversational fragment or a list of still-open options. If it is too vague or contradictory to support a behavioral delta, **stop**, describe what is unclear, and wait for the human to refine `request.md`.
5. Only proceed once `request.md` is settled. If it is already clear and complete, say so in one sentence and continue immediately — this is a guard, not a gate that requires explicit approval when nothing is wrong.

### Step 1 — Define the behavioral delta
1. Using the settled `request.md`, `queries.md`, and `research.md`, define the behavioral delta
2. Write to `./qrspi/<feature>/spec.md`
3. If `state.json` exists, update it idempotently: set `currentPhase: "definition"` and `currentStep: "spec"`, ensure `"spec"` appears only once in `completedSteps`, and append one history entry.
4. Stop and wait for human review

Do not create implementation plans. Your job ends when spec.md is written.
