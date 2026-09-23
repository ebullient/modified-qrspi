---
name: research
description: 'Use when answering QRSPI research questions with facts from the codebase.'
when_to_use: 'Use for the Research step, including repeat runs in a Query ↔ Research cycle. Use `qrspi-x:query` when research reveals a question the code cannot answer.'
disable-model-invocation: false
---

# QRSPI Research

## Core Philosophy
- Gather facts, not opinions — only research and document findings

## Task
Spawn the `qrspi-x:researcher` agent to explore the codebase in isolation. Pass the feature name so the agent can locate `./qrspi/<feature>/queries.md` and write `./qrspi/<feature>/research.md`. If the human named other locations the research should cover (e.g. a reference or upstream repo on disk), pass them as paths only — no description of the feature:

```
Spawn qrspi-x:researcher agent for feature: <feature-name>
Additional locations: <paths, or omit>
```

The agent reads `queries.md`, searches the codebase for answers, and writes `research.md` with file paths, line numbers, code snippets, and a New Questions section if research surfaces unknowns. On a rerun, it retains answers for questions still present and adds missing answers.

Using a subagent keeps codebase reads out of the main conversation.

## After the Agent Returns
1. Review the research.md summary the agent reports
2. Stop and wait for human review of `./qrspi/<feature>/research.md`
3. If New Questions were surfaced, offer to cycle back to Query phase (`qrspi-x:query` runs in refinement mode)
4. If `state.json` exists, update it idempotently: set `currentPhase: "discovery"` and `currentStep: "research"`, ensure `"research"` appears only once in `completedSteps`, increment `discoveryIterations` once for this completed Research run, and append one history entry including the resulting iteration number.

Do not proceed to spec automatically.
