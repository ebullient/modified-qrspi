---
name: explore
description: 'Use when a QRSPI feature is not yet defined and the codebase needs surveying for gaps and candidate directions.'
when_to_use: 'Use when the user wants a QRSPI exploration or does not yet know what to build. Skip it when the feature is clear; use `qrspi-x:init` instead.'
disable-model-invocation: false
---

# QRSPI Explore

## Core Philosophy
- Survey and propose options; do not commit to a feature.
- Optional: skip it when the feature is clear and use `qrspi-x:init`. It is not part of the linear workflow and creates no `state.json`.

## Task
Spawn `qrspi-x:explorer` with an exploration name and topic:

```
Spawn qrspi-x:explorer agent for exploration: <exploration-name>
Topic: <area of interest, e.g. "what does <reference framework> provide that this extension doesn't yet adapt">
```

The agent surveys broadly, forms opinions, and proposes candidate directions. It stays in the current project unless the topic explicitly names a local reference or upstream path.

Using a subagent keeps exploratory reads out of the main conversation.

## After the Agent Returns
1. Review its observations, gaps, candidate directions, and open questions.
2. Stop for human review of `./qrspi/explore/<exploration-name>/explore.md`.
3. If a direction is worth pursuing, start `qrspi-x:init` with a specific feature name; optionally provide `explore.md` as context.

Do not write request.md, generate queries, or otherwise start the normal QRSPI flow automatically — Explore only produces the survey.
