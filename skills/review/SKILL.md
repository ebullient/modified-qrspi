---
name: review
description: 'QRSPI Step 6: adversarial review of a phase checkpoint or the full branch against spec.md and the plan, producing a PASS / PASS WITH CONDITIONS / FAIL verdict.'
when_to_use: 'Use for phase checkpoint or final reviews in a QRSPI workflow, or a one-off review of changes that have a QRSPI spec and plan. Use only within a QRSPI workflow — a `./qrspi/<feature>/` workspace exists, or the user asks for QRSPI or names this step.'
disable-model-invocation: false
---

# QRSPI Review

## Core Philosophy
- Only review, never fix

## Your Task
Spawn the `qrspi-x:reviewer` agent to perform the adversarial review in isolation. Resolve the scope to an exact diff command first (see Scope guidance), then pass it with the feature name, label, and phase number if any.

```
Spawn qrspi-x:reviewer agent for feature: <feature-name>
Diff: <exact git diff command, or "staged">
Phase: <N, or omit>
Checkpoint step: <M for a mid-phase checkpoint, or omit when the whole phase is complete>
Label: <unique label, e.g. "phase-2", "phase-2-step-1", or "final">
```

The agent reads `spec.md` and `plan.md` from disk, checks prior review artifacts, runs the diff, and writes a verdict to `./qrspi/<feature>/reviews/<label>.md`.

Running review as a subagent keeps diff output and file reads out of the main conversation context while preserving the QRSPI-specific spec conformance and plan fidelity checks that generic code review tools lack.

## Optional: Explain alongside Review

Before spawning, ask the user: "Also generate an explanation of this change? (`qrspi-x:explainer` — a narrative walkthrough of what changed and why, independent of and isolated from the reviewer; not a verification step, just faster orientation.)" Wait for the answer, and spawn the explainer only on a clear yes — this is opt-in, not a standing part of the flow.

If yes, spawn both agents in the same turn so neither sees the other's output:

```
Spawn qrspi-x:reviewer agent for feature: <feature-name>
Diff: <exact git diff command, or "staged">
Phase: <N, or omit>
Checkpoint step: <M for a mid-phase checkpoint, or omit when the whole phase is complete>
Label: <unique label, e.g. "phase-2", "phase-2-step-1", or "final">

Spawn qrspi-x:explainer agent for feature: <feature-name>
Diff: <same as above>
Phase: <same as above>
Label: <same as above>
```

The explainer writes to `./qrspi/<feature>/explain/<label>.md`. Labels must be non-empty kebab-case path components; if the requested review or explanation label already exists, choose the next unused suffix (for example `phase-2-r2`) rather than overwriting it. If a collision occurs after spawning, the agent stops instead of overwriting. This is most useful at final review, where a whole-picture narrative pays off most, but can be offered at phase checkpoints too.

Treat the explainer's output as unverified narrative, not a substitute for the diff or for the reviewer's findings — if the two disagree about what the code does, that disagreement is itself worth looking at before trusting either one.

## Scope guidance
Resolve the scope to an exact diff command before spawning, so the agent never has to guess:
- Phase checkpoint: read `phaseBaseSha` from `state.json` and pass `git diff <phaseBaseSha>`. QRSPI artifacts under `./qrspi/<feature>/` are intentionally outside the product diff and are read directly by the agent; do not stage them. Before spawning, inspect `git status --short --untracked-files=all`: any untracked implementation/source file must be tracked or staged, and any unexpected change outside the feature's QRSPI directory must be reported and resolved. Pass `Phase: N`, `Checkpoint step: M` for a mid-phase checkpoint, and a unique label: use `phase-N-step-M` for a mid-phase checkpoint and `phase-N` only when the whole phase is complete. The explicit checkpoint step remains authoritative even after Implement clears `activePlanStep`. If `phaseBaseSha` is missing, ask the human for the base commit rather than guessing.
- Full branch / final: pass `git diff $(git merge-base HEAD <default-branch>)`, where `<default-branch>` is the repository's default branch (e.g. from `git symbolic-ref refs/remotes/origin/HEAD`, else `main`). Pass `Label: final`.
- Specific files: append them, e.g. `git diff <base> -- path/a.ts path/b.ts`
- Staged changes: pass `staged`
- Explicit: if the human gave a diff command, pass it unchanged

## After the Agent Returns
1. Read the verdict the agent reports (PASS / PASS WITH CONDITIONS / FAIL)
2. If the explainer was also spawned, note that `explain/<label>.md` is available as supplementary reading — do not merge its content into the verdict or treat it as part of the review
3. If `state.json` exists, append one `history` entry for the review with its unique label, verdict, and artifact path (e.g. `{"step": "review", "label": "phase-2-r2", "verdict": "PASS", "artifact": "reviews/phase-2-r2.md", ...}`); for a final review, also set `currentPhase: "execution"`, `currentStep: "review"`, and ensure `"review"` appears only once in `completedSteps`
4. Stop and wait for human decision on how to proceed
5. If FAIL: offer to fix and re-implement, revise plan, or revise spec
6. If PASS WITH CONDITIONS: offer to address findings then re-review
7. If this was a mid-phase checkpoint that passed, offer to continue with the next incomplete step in the same phase. If this was a phase-complete checkpoint that passed, offer to continue with the next phase (or Final Review if this was the last phase).

Do not fix issues or create PRs automatically.
