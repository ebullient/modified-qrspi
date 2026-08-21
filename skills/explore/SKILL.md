---
name: explore
description: >-
  QRSPI optional pre-step: survey an area of the codebase to find gaps and
  candidate directions before a feature request can be written
metadata:
  disable-model-invocation: true
---

# QRSPI Explore

## Core Philosophy
- Code is the source of truth - explore.md is a survey, not a commitment
- Humans gate every transition - never automatically proceed to Init
- This step is optional - skip it entirely when you already know what to build; go straight to `qrspi-x:init`
- Unlike Research (facts only, blind to intent) and Query (questions only, no opinions), Explore is allowed to synthesize and propose candidate directions - that's the point of it

## Your Task
Spawn the `qrspi-x:explorer` agent to survey the given topic/area. Pass an exploration name and the topic/area of interest:

```
Spawn qrspi-x:explorer agent for exploration: <exploration-name>
Topic: <area of interest, e.g. "what does <reference framework> provide that this extension doesn't yet adapt">
```

The agent has broad tool access (Read, Write, Bash, Glob, Grep) and is not scoped to a single feature's fixed question list the way Research is — it surveys, forms opinions, and proposes candidate directions. By default it stays within the current project (the parent of `qrspi`); if the survey should also cover a related reference/upstream repo on disk, name that path explicitly in the Topic so the agent knows it's in bounds.

Running explore as a subagent keeps its (likely large) volume of exploratory grep/find/read calls out of the main conversation context, same as Research and Review.

## After the Agent Returns
1. Review the explore.md summary the agent reports: observations, gaps, candidate directions, open questions
2. Stop and wait for human review of `./qrspi/<exploration-name>/explore.md`
3. If a candidate direction is worth pursuing, start the normal workflow for it: run `qrspi-x:init` with a specific feature name, optionally pointing at `explore.md` as background

Do not write request.md, generate queries, or otherwise start the normal QRSPI flow automatically — Explore only produces the survey.

## When to Use
Use this before Init when you don't yet know what to build — e.g. adapting a reference framework and unsure what capabilities are missing. Skip straight to Init when the feature is already clear.

Not part of the linear phase progression: one exploration can lead to zero, one, or several features, each starting its own `./qrspi/<feature>/` with Init. No `state.json` is created for the exploration itself.
