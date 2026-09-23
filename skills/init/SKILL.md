---
name: init
description: 'Use when starting a QRSPI feature workspace before Query.'
when_to_use: 'Use when starting a new QRSPI feature before Query. If the feature is already clear but Init was skipped, `qrspi-x:query` can create the request artifact.'
disable-model-invocation: false
---

# QRSPI Init

## Core Philosophy
- Only capture intent and set up the workspace, nothing else
- Optional rather than a hard gate — `qrspi-x:query` creates `request.md` itself if this step was skipped

## Task
Capture what's being built, in the user's own words, before any question-generation or research begins. `request.md` is the one artifact allowed to say what the feature actually is — everything downstream (`queries.md`, `research.md`) must stay free of it.

1. Use the feature request from the conversation or command. If only a feature name was given (for example, `/qrspi-x:workflow <feature-name>`), ask the human for the request; do not infer it from the name.
2. Determine the feature name as a short kebab-case identifier matching `[a-z0-9]+(?:-[a-z0-9]+)*`. Reject path separators, `.`/`..`, and `explore` (reserved for surveys).
3. If `./qrspi/<feature>/request.md` and `./qrspi/<feature>/state.json` both exist, treat this as a resume: read them, preserve them, and do not reinitialize either file. If the directory exists with only one of these files, stop and report the incomplete workspace rather than overwriting the existing artifact.
4. For a new workspace, write `request.md` with the feature request/intent — verbatim or lightly cleaned up, not restructured into a spec or design — and write `state.json` with the initial values from `qrspi-x:workflow`'s schema. If the human explicitly supplies prior-art comparisons or other context to preserve, write that separately to optional `background.md`; keep it clearly contextual rather than turning it into requirements or a design.
5. On a new workspace, record Init as completed in `state.json` and append one Init entry to `history`. On resume, do not add another completion entry merely for opening the workspace.
6. Stop for human confirmation that a new `request.md` captures the intent.

## Output Format
`request.md` is freeform prose or a short list — whatever the user actually said. No acceptance criteria and no behavioral delta (that's Spec's job). Avoid writing a proposed technical approach here if you can help it — a stated approach at this stage biases Query's questions and Research's framing, the same way it would if it leaked into `queries.md` directly. `background.md`, when present, is for human context and is not passed to Query or Research automatically.

Do not generate questions, do research, or propose a design. Your job ends when `request.md` and `state.json` are written.
