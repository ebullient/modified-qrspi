---
name: spec
description: 'QRSPI Step 3: Define behavioral delta - what changes and what stays the same'
metadata:
  disable-model-invocation: false
---

# QRSPI Spec

## Core Philosophy
- Code is the source of truth - specs describe changes, not the entire system
- Humans gate every transition - never automatically proceed to planning
- Single responsibility - only define the behavioral contract

## Your Task
Based on queries and research, define exactly what will change. Focus on:

1. **Behavioral Changes**: What new behaviors are being added?
2. **API Contracts**: What interfaces will change or be added?
3. **Data Changes**: What data structures or schemas will change?
4. **Integration Points**: How will this interact with existing systems?
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
3. Check whether any "Questions for the User" from the query cycles were answered and folded back into `request.md` (look for a `## Clarifications` section or similar additions). If clarifications are missing — i.e., open intent questions were raised but `request.md` shows no trace of answers — **stop**, surface the unresolved questions to the human, and wait for them to update `request.md` before continuing.
4. Confirm the request reads as a concrete feature intent, not as a conversational fragment or a list of still-open options. If it is too vague or contradictory to support a behavioral delta, **stop**, describe what is unclear, and wait for the human to refine `request.md`.
5. Only proceed once `request.md` is settled. If it is already clear and complete, say so in one sentence and continue immediately — this is a guard, not a gate that requires explicit approval when nothing is wrong.

### Step 1 — Define the behavioral delta
1. Using the settled `request.md`, `queries.md`, and `research.md`, define the behavioral delta
2. Write to `./qrspi/<feature>/spec.md`
3. Stop and wait for human review

Do not create implementation plans. Your job ends when spec.md is written.

## When to Use
Use this mode as the third step in QRSPI workflow to define the behavioral delta based on queries and research. Creates spec.md artifact.

Typically invoked by `qrspi-x:workflow` orchestrator after Query ↔ Research cycles complete.
