---
name: query
description: >-
  QRSPI Step 1: Surface critical questions about a feature before implementation
  begins
metadata:
  disable-model-invocation: false
---

# QRSPI Query

## Core Philosophy
- Code is the source of truth - QRSPI artifacts are disposable scaffolding
- Humans gate every transition - never automatically proceed to the next step
- Single responsibility - only generate questions, nothing else
- Questions come from the feature request, not the codebase - exploring the code to ground or answer questions is Research's job, not Query's
- Not every question is for Research - some are about intent only the requester can resolve; those get asked and answered directly, then folded into request.md, never left sitting in queries.md

## Your Task
For the **initial** queries.md on a feature, spawn the `qrspi-x:query` agent so question generation happens in isolation from the codebase and from anything already explored in this conversation (a prior feature's research, earlier tool calls, etc.).

1. Check for `./qrspi/<feature>/request.md`.
   - If it exists, read it — this is the feature intent to pass to the agent.
   - If it doesn't exist (the `qrspi-x:init` step was skipped), capture the feature request from the current conversation/command and write `./qrspi/<feature>/request.md` with it yourself before continuing. This keeps the durable record even when Query is invoked directly on a brand-new feature.
2. Spawn the agent, passing the feature name and the contents of `request.md` verbatim:

```
Spawn qrspi-x:query agent for feature: <feature-name>
Feature request: <contents of request.md>
```

The agent has no tools beyond `Write` — it cannot read files, grep, or run commands, so it cannot cite file paths, class names, or "confirmed via" findings. If output like that shows up in queries.md, question generation didn't stay isolated and the step should be re-run.

## Refining an Existing queries.md

When research surfaces "New Questions" (a refinement cycle, not the initial pass), append them directly to the existing `queries.md` yourself rather than re-spawning the agent — by this point a human has already reviewed research.md, so isolation no longer matters, and the isolated agent can't edit an existing file anyway (its `Write`-only toolset can't satisfy the read-before-overwrite requirement).

## After the Agent Returns
1. Read the agent's report: question count per category, plus any Questions for the User
2. If there are Questions for the User: ask them directly, then append the Q&A to `./qrspi/<feature>/request.md` (a "## Clarifications" section works well — keep the original request intact and add to it). This is a revision to intent, not to queries.md.
3. If request.md changed in step 2: re-spawn the `qrspi-x:query` agent against the updated request.md — this regenerates `queries.md` so it reflects the clarified intent, not just the original ambiguity. Repeat from step 1.
4. Once a pass comes back with no Questions for the User (or the human chooses to proceed despite open ones), stop and wait for human review of `./qrspi/<feature>/queries.md`

Do not proceed to research or any other step automatically.

## When to Use
Use this mode as the first step in QRSPI workflow to surface critical questions about a feature before implementation. Creates queries.md artifact for human review.

Typically invoked by `qrspi-x:workflow` orchestrator, but can be used standalone for iterative query refinement.
