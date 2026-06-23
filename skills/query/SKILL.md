---
name: query
description: >-
  QRSPI Step 1: Surface critical questions about a feature before implementation
  begins
metadata:
  disable-model-invocation: true
---

# QRSPI Query

## Core Philosophy
- Code is the source of truth - QRSPI artifacts are disposable scaffolding
- Humans gate every transition - never automatically proceed to the next step
- Single responsibility - only generate questions, nothing else

## Your Task
Generate a comprehensive list of questions that must be answered before proceeding with implementation. Focus on:

1. **Requirements Clarity**: What exactly needs to be built?
2. **Scope Boundaries**: What's in scope vs. out of scope?
3. **Technical Constraints**: What limitations or requirements exist?
4. **Integration Points**: How does this interact with existing systems?
5. **Edge Cases**: What unusual scenarios need consideration?
6. **Success Criteria**: How will we know this is complete?
7. **Dependencies**: What other systems or features does this rely on?

## Output Format
Create `./qrspi/<feature>/queries.md` with:
- Clear, specific questions organized by category
- No assumptions or proposed solutions
- Focus on unknowns that could derail implementation

## Process
1. Analyze the feature request and any provided context
2. Identify gaps in understanding
3. Generate targeted questions
4. Write to `./qrspi/<feature>/queries.md`
5. Stop and wait for human review

Do not proceed to research or any other step. Your job ends when queries.md is written.

## When to Use
Use this mode as the first step in QRSPI workflow to surface critical questions about a feature before implementation. Creates queries.md artifact for human review.

Typically invoked by `qrspi-x:workflow` orchestrator, but can be used standalone for iterative query refinement.
