---
name: shape
description: 'Use when a feature has settled intent and codebase facts but multiple viable implementation approaches remain.'
when_to_use: 'Use optionally after Query ↔ Research and before Spec when the solution direction is not obvious. Skip it and use `qrspi-x:spec` when one reasonable approach is clear; use `qrspi-x:query` or `qrspi-x:research` when intent or codebase facts are still unclear.'
disable-model-invocation: false
---

# QRSPI Shape

## Core Philosophy
- Resolve meaningful implementation alternatives before freezing the behavioral contract

## Task
Explore and compare candidate implementation approaches for a settled feature. Shape is an optional, human-gated definition step: it decides how the feature should be approached, but it does not write product code, define the behavioral spec, or create an implementation plan.

The shaper uses all available pre-definition context:
- `./qrspi/<feature>/request.md` — the settled intent
- `./qrspi/<feature>/background.md` — optional human context and prior art
- `./qrspi/<feature>/queries.md` — the questions that framed research
- `./qrspi/<feature>/research.md` — codebase facts and constraints

1. Verify that `request.md`, `queries.md`, and `research.md` exist. If any is missing, stop and direct the caller to Init, Query, or Research. `background.md` is optional.
2. If `research.md` has a non-empty `## New Questions`, stop and return to Query before shaping; do not design around unresolved facts.
3. Before spawning, prefer the declared agent when the runtime supports named agents:
   - If `qrspi-x:shaper` is registered, spawn it directly so the runtime can apply its declared settings.
   - Otherwise, read `../../agents/shaper.md`, resolved relative to this `SKILL.md`, and spawn a generic subagent with its full contents as the role instructions.
4. Pass the feature name so the agent can locate the four artifacts, noting that `background.md` may be absent. The agent may read the codebase to validate candidate approaches, but it must write only `./qrspi/<feature>/approach.md`.
5. If `approach.md` already exists, preserve its prior decision and rationale while refining the alternatives; never silently replace a recorded decision.

The approach artifact should make the choice reviewable:

```markdown
# QRSPI Approach: <feature>

## Context
...

## Constraints and Facts
...

## Candidate Approaches
### Option A: ...
...

## Recommendation
...

## Human Decision
<!-- Record the selected option and rationale here before Spec. -->

## Open Questions
...
```

## After the Agent Returns

1. Read the agent's report and inspect `approach.md` for candidate approaches, tradeoffs, and a recommendation.
2. If the comparison exposes missing facts, stop and return to Query/Research rather than guessing.
3. Stop for human review. The human may approve the recommendation, select another option, or edit `approach.md`; record the selected approach and rationale under `## Human Decision` before proceeding to Spec. The shaping pass is complete when `approach.md` is written, but the human decision is a separate gate.
4. If `state.json` exists, set `currentPhase: "definition"` and `currentStep: "shape"`, ensure `"shape"` appears only once in `completedSteps`, and append one history entry for this completed shaping pass. The orchestrator records the later human choice in `state.json.approachDecision`, `decisions`, and `history`; if `approachDecision` is null, a resume remains at the Shape gate and must not dispatch Spec.

Do not write `spec.md` or plan files. If the approach is obvious, skip this step entirely and use `qrspi-x:spec`.
