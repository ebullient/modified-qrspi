---
name: review
description: >-
  QRSPI Step 6: Adversarial code review — incremental checkpoints or full
  branch, produces a PASS/FAIL verdict
metadata:
  disable-model-invocation: false
---

# QRSPI Review

## Core Philosophy
- Code is the source of truth - QRSPI artifacts are disposable scaffolding
- Humans gate every transition - never automatically proceed to PR
- Single responsibility - only review, never fix

## Your Task
Spawn the `qrspi-x:reviewer` agent to perform the adversarial review in isolation. Pass the feature name and any scope information (explicit diff command, specific files, or "staged" / "full branch").

```
Spawn qrspi-x:reviewer agent for feature: <feature-name>
Scope: <staged | full branch | git diff --staged | specific files>
Label: <checkpoint-label or "final">
```

The agent reads `spec.md` and `plan.md` from disk, checks prior review artifacts, diffs the scoped changes, and writes a verdict to `./qrspi/<feature>/reviews/<checkpoint-label>.md` or `./qrspi/<feature>/reviews/final.md`.

Running review as a subagent keeps diff output and file reads out of the main conversation context while preserving the QRSPI-specific spec conformance and plan fidelity checks that generic code review tools lack.

## Optional: Explain alongside Review

Before spawning, ask the user: "Also generate an explanation of this change? (`qrspi-x:explainer` — a narrative walkthrough of what changed and why, independent of and isolated from the reviewer; not a verification step, just faster orientation.)" Default to no if the user doesn't answer — this is opt-in, not a standing part of the flow.

If yes, spawn both agents in the same turn so neither sees the other's output:

```
Spawn qrspi-x:reviewer agent for feature: <feature-name>
Scope: <staged | full branch | git diff --staged | specific files>
Label: <checkpoint-label or "final">

Spawn qrspi-x:explainer agent for feature: <feature-name>
Scope: <same as above>
Label: <same as above>
```

The explainer writes to `./qrspi/<feature>/explain/<checkpoint-label>.md` or `./qrspi/<feature>/explain/final.md`. This is most useful at final review, where a whole-picture narrative pays off most, but can be offered at phase checkpoints too.

Treat the explainer's output as unverified narrative, not a substitute for the diff or for the reviewer's findings — if the two disagree about what the code does, that disagreement is itself worth looking at before trusting either one.

## Scope guidance
Pass scope to the agent in natural language — it resolves the actual diff command:
- Phase checkpoint: "phase N" — agent reads `plan-phase-N.md` to understand what phase N was supposed to do, then diffs accordingly
- Staged changes: "staged changes" or "files: path/a.ts path/b.ts"
- Full review: "full branch"
- Explicit: pass the exact `git diff ...` command to run

For phase checkpoints, also pass the phase file path so the agent can check plan fidelity against that phase's steps specifically.

## After the Agent Returns
1. Read the verdict the agent reports (PASS / PASS WITH CONDITIONS / FAIL)
2. If the explainer was also spawned, note that `explain/<label>.md` is available as supplementary reading — do not merge its content into the verdict or treat it as part of the review
3. Stop and wait for human decision on how to proceed
4. If FAIL: offer to fix and re-implement, revise plan, or revise spec
5. If PASS WITH CONDITIONS: offer to address findings then re-review

Do not fix issues or create PRs automatically.

## When to Use
Use this mode after QRSPI Implement steps to review changes before merging. Supports
incremental checkpoint reviews and full branch review.

Typically invoked by `qrspi-x:workflow` orchestrator during or after Implementation phase, but can be used standalone for one-off reviews.
