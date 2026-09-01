---
name: research
description: 'QRSPI Step 2: Gather facts from codebase to answer query questions'
metadata:
  disable-model-invocation: false
---

# QRSPI Research

## Core Philosophy
- Code is the source of truth - gather facts, not opinions
- Humans gate every transition - never automatically proceed to spec
- Single responsibility - only research and document findings

## Your Task
Spawn the `qrspi-x:researcher` agent to explore the codebase in isolation. Pass the feature name so the agent can locate `./qrspi/<feature>/queries.md` and write `./qrspi/<feature>/research.md`.

```
Spawn qrspi-x:researcher agent for feature: <feature-name>
```

The agent reads `queries.md`, searches the codebase for answers, and writes `research.md` with file paths, line numbers, code snippets, and a New Questions section if research surfaces unknowns.

Running research as a subagent keeps grep/find/read tool calls out of the main conversation context.

## After the Agent Returns
1. Review the research.md summary the agent reports
2. Stop and wait for human review of `./qrspi/<feature>/research.md`
3. If New Questions were surfaced, offer to cycle back to Query phase

Do not proceed to spec automatically.

## When to Use
Use this mode as the second step in QRSPI workflow to gather facts from the codebase that answer questions from the Query phase. Creates research.md artifact.

Typically invoked by `qrspi-x:workflow` orchestrator. May be run multiple times as Query ↔ Research iteration happens.
