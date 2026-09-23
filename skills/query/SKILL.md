---
name: query
description: 'Use when generating isolated research questions from a QRSPI feature request.'
when_to_use: 'Use for the Query step, including refinement after Research surfaces new questions. Use `qrspi-x:research` to answer the questions; Query must not read the codebase.'
disable-model-invocation: false
---

# QRSPI Query

## Core Philosophy
- Only generate questions, nothing else
- Questions come from the feature request, not the codebase - exploring the code to ground or answer questions is Research's job, not Query's
- Not every question is for Research - some are about intent only the requester can resolve; those get asked and answered directly, then folded into request.md, never left sitting in queries.md

## Task
Always generate `queries.md` with the `qrspi-x:query` agent, so question generation happens in isolation from the codebase and from anything already explored in this conversation (research findings, a prior feature's work, earlier tool calls, etc.). Never write or append questions to `queries.md` yourself.

1. Check `./qrspi/<feature>/request.md`.
   - If it exists, read it — this is the feature intent to pass to the agent.
   - If it doesn't exist (the `qrspi-x:init` step was skipped), capture the feature request from the current conversation/command and write `./qrspi/<feature>/request.md` with it yourself, plus an initial `state.json` (see `qrspi-x:workflow`'s schema), before continuing.
2. Determine the mode before moving any artifact:
   - **Initial** — no `queries.md` exists.
   - **Refinement** — this pass follows Research whose `research.md` has a non-empty `## New Questions` section.
   - **Regeneration** — `queries.md` exists and Query is being rerun after clarification, a backward jump, or an explicit request to revise questions.
3. If `queries.md` exists, retain its complete contents and move it to `queries.md.bak` (or the next unused numbered backup). The agent can write a fresh file but cannot overwrite the old one.
4. Spawn the agent with the feature name and `request.md` verbatim. In refinement mode, also pass prior queries and New Questions verbatim. In regeneration mode, pass prior queries verbatim and preserve still-relevant questions. Pass any post-Spec questions verbatim as `Additional questions from the human`; do not summarize, answer, or add research findings:

```
Spawn qrspi-x:query agent for feature: <feature-name>
Mode: <initial | refinement | regeneration>
Feature request: <contents of request.md>
Prior queries: <contents of the moved-aside queries.md — refinement or regeneration>
New questions from research: <verbatim ## New Questions list — refinement only>
Additional questions from the human: <verbatim list, if any>
```

The agent has no tools beyond `Write` — it cannot read files, grep, or run commands, so it cannot cite file paths, class names, or "confirmed via" findings. If output like that shows up in queries.md, question generation didn't stay isolated and the step should be re-run.

## After the Agent Returns
1. Read the agent's report for question counts and any Questions for the User.
2. If there are Questions for the User, append them to `request.md` under `## Open Questions` (create the section if needed; preserve the original request), then ask them. Move each answered question to `## Clarifications` with its answer. This revises intent, not `queries.md`.
3. If `## Clarifications` changed in step 2, rerun in Regeneration mode so `queries.md` reflects the clarified intent while preserving still-relevant questions.
4. Once a pass comes back with no Questions for the User, stop and wait for human review of `./qrspi/<feature>/queries.md`. Do not treat unanswered Open Questions as resolved; Spec will block on them.
5. If `state.json` exists, update it idempotently: set `currentPhase: "discovery"` and `currentStep: "query"`, ensure `"query"` appears only once in `completedSteps`, and append one history entry for this completed pass including the mode and, when applicable, the clarification or backward-jump reason.

Do not proceed to research or any other step automatically.
