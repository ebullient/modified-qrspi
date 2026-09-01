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

## Scope guidance
Pass scope to the agent in natural language — it resolves the actual diff command:
- Phase checkpoint: "phase N" — agent reads `plan-phase-N.md` to understand what phase N was supposed to do, then diffs accordingly
- Staged changes: "staged changes" or "files: path/a.ts path/b.ts"
- Full review: "full branch"
- Explicit: pass the exact `git diff ...` command to run

For phase checkpoints, also pass the phase file path so the agent can check plan fidelity against that phase's steps specifically.

## After the Agent Returns
1. Read the verdict the agent reports (PASS / PASS WITH CONDITIONS / FAIL)
2. Stop and wait for human decision on how to proceed
3. If FAIL: offer to fix and re-implement, revise plan, or revise spec
4. If PASS WITH CONDITIONS: offer to address findings then re-review

Do not fix issues or create PRs automatically.

## When to Use
Use this mode after QRSPI Implement steps to review changes before merging. Supports
incremental checkpoint reviews and full branch review.

Typically invoked by `qrspi-x:workflow` orchestrator during or after Implementation phase, but can be used standalone for one-off reviews.
