---
name: spec
description: 'QRSPI Step 3: Define behavioral delta - what changes and what stays the same'
metadata:
  disable-model-invocation: true
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
1. Read `./qrspi/<feature>/queries.md` and `./qrspi/<feature>/research.md`
2. Read `./qrspi/<feature>/request.md` for the original feature intent, if it exists; otherwise use whatever constraints the user has provided in conversation
3. Define the behavioral delta
4. Write to `./qrspi/<feature>/spec.md`
5. Stop and wait for human review

Do not create implementation plans. Your job ends when spec.md is written.

## When to Use
Use this mode as the third step in QRSPI workflow to define the behavioral delta based on queries and research. Creates spec.md artifact.

Typically invoked by `qrspi-x:workflow` orchestrator after Query ↔ Research cycles complete.
