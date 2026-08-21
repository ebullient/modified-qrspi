---
name: init
description: 'QRSPI Step 0: Capture feature intent and initialize the workspace'
metadata:
  disable-model-invocation: true
---

# QRSPI Init

## Core Philosophy
- Code is the source of truth - QRSPI artifacts are disposable scaffolding
- Humans gate every transition - never automatically proceed to Query
- Single responsibility - only capture intent and set up the workspace, nothing else

## Your Task
Capture what's being built, in the user's own words, before any question-generation or research begins. `request.md` is the one artifact allowed to say what the feature actually is — everything downstream (`queries.md`, `research.md`) must stay free of it.

1. Determine the feature name (short kebab-case identifier). If `./qrspi/<feature>/` already exists, this is a resume — read the existing `request.md`/`state.json` rather than overwriting them.
2. Write `./qrspi/<feature>/request.md` with the feature request/intent — verbatim or lightly cleaned up, not restructured into a spec or design.
3. Write `./qrspi/<feature>/state.json` with initial values (see `qrspi-x:workflow`'s schema).
4. Stop and wait for human confirmation that `request.md` captures the intent correctly.

## Output Format
`request.md` is freeform prose or a short list — whatever the user actually said. No acceptance criteria and no behavioral delta (that's Spec's job). Avoid writing a proposed technical approach here if you can help it — a stated approach at this stage biases Query's questions and Research's framing, the same way it would if it leaked into `queries.md` directly.

## Process
1. Take the feature request as given in the conversation or command
2. Write `./qrspi/<feature>/request.md`
3. Initialize `./qrspi/<feature>/state.json`
4. Stop and wait for human review

Do not generate questions, do research, or propose a design. Your job ends when `request.md` and `state.json` are written.

## When to Use
Use this as the first step in QRSPI workflow, before Query, to capture feature intent as a durable artifact.

Typically invoked by `qrspi-x:workflow` orchestrator at the start of a new feature. Can also be run standalone — and `qrspi-x:query` will create `request.md` itself if this step was skipped, so it's optional rather than a hard gate.
