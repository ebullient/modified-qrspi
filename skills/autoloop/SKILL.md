---
name: autoloop
description: 'Use when a trusted QRSPI spec and plan should run unattended for one phase or all remaining phases.'
when_to_use: 'Use when a `./qrspi/<feature>/` workspace has an approved spec and plan and you want unattended execution. For human-gated execution, use `qrspi-x:workflow` or `qrspi-x:implement`.'
disable-model-invocation: false
compatibility: Node 22+
---

# QRSPI Autoloop

## Core Philosophy
- Spawn and track; never implement or review in this conversation
- One repair attempt per phase, then a human

This skill is part of the QRSPI workflow and is normally invoked by `qrspi-x:workflow`. It may also be invoked directly. Unlike the interactive skills, it requires the helper and cannot fall back to artifact-only mode.

## What this is

Autoloop is the unattended sibling of `qrspi-x:workflow`. The human approves the scope and readiness at entry, then owns the final review; autoloop implements each phase, reviews it, repairs once after a failure, and advances or stops.

This is a coarser gate, not a removed one. The human approves the scope and reviews the result; what changes is how much work accumulates in between. State that distinction at entry.

### What you give up

Interim reviews use the same inherited model that wrote the code, so they are a **fast filter, not an independent check**. Autoloop deliberately stops before final review so the human can run that review separately, ideally on a different model. Interim PASSes do not replace it.

## The helper

All loop state goes through the helper. Run `qrspi-x <command> --feature <feature> --project <path>`. Every command prints one JSON envelope with `ok`, `result`, `findings`, and `wrote`. Do not edit `state.json` directly.

A refused command (`ok: false`, a `loop-refused` finding) wrote nothing. Do not work around it; run `report` and follow what it recommends.

If `qrspi-x` is not found (exit 127), tell the human to run `npm i -g @ebullient/qrspi-x`. Autoloop cannot run unattended without it — this is a hard stop, not a degrade-and-continue case.

## Entry gate

Run `report`. If `result.loop` is present and not `{"action": "done"}`, a loop already exists: go to **Resuming** instead.

Agree the run with the human:

- **Scope** — a single phase or all remaining phases. Default to a single phase if unstated; all-phases is the larger commitment and should be chosen deliberately. The helper takes this as a selector: `all`, one phase id (`3`), a range (`2..4`), or a comma list (`1,3`).
- **Commit mode** — `phase` (one commit per phase, amended as steps complete) or `step` (one commit per plan step, the finer record). Default to `phase` if unstated; `step` is worth choosing when you expect a phase to need unpicking. Repairs are always a separate commit.
- **What it will do unattended** — implement and commit each phase, review each phase, and repair once on failure.
- **What it will not do** — run the final review.

Then run `loop --start <selector>`. It runs the helper's entry checks and resolves the scope, adding any incomplete phases the selection depends on. If it refuses, it wrote nothing: each finding's message says what is wrong and usually how to fix it, so work through them with the human and run it again.

Once it succeeds, nothing has been spawned yet. Show the human the resolved `phases` and wait for a clear yes. This is the only approval you will get. If the human rejects the scope, run `loop --abandon "<reason>"` and start over with a different selector.

## Loop state

The helper owns the `loop` block in `state.json`; `report` summarizes it as `result.current.loop` (scope, phases, current phase, cycle, stop reason, `checkpoints`, and `conditions`, the non-blocking findings carried to the end).

Each spawn is bracketed: `loop --begin <action>` **before** spawning, `loop --end <action>` after the agent returns. The begin records what the run is doing, so a session that dies mid-spawn leaves that behind rather than what it last finished. The end reads the agent's output from disk — phase markers, commits, the review artifact — and records the outcome; it does not trust the agent's report.

## The loop

Before each spawn, prefer the declared agent when the runtime supports named agents:

- If `qrspi-x:implementer` or `qrspi-x:reviewer` is registered, spawn it directly so the runtime can apply its declared settings.
- Otherwise, read the matching bundled role definition, resolved relative to this `SKILL.md`, and spawn a generic subagent with its full contents as the role instructions:
  - Implementer: `../../agents/implementer.md`
  - Reviewer: `../../agents/reviewer.md`

Apply the same rule to implementation, review, repair, and re-review spawns.

Drive the loop from the helper. Run `report` and act on `result.loop.action`, then run `report` again, until the action is `done`, `stop`, or `acknowledge-required`:

### `implement`

Run `loop --begin implement --commit-mode <approved mode>`. The result carries `phase` and `commitMode`; when resuming a phase, `commitMode` is the mode already recorded, so pass on the result's value.

```
Spawn qrspi-x:implementer agent for feature: <feature-name>
Mode: phase
Phase: <result.phase>
Commit mode: <result.commitMode>
```

When it returns, run `loop --end implement`, adding `--result STOPPED --note "<its Stopped because paragraph>"` if it stopped. Do not retry a stopped implementer.

### `review` or `re-review`

Run `loop --begin review` (or `loop --begin re-review`). The result carries the checkpoint `label` and the phase `diff` command. Use them exactly; never compose a label — the reviewer stops rather than overwrite a finished review, which would strand the loop.

If `./qrspi/<feature>/reviews/<label>.md` does not exist, create it with your file-writing tool containing exactly the line `## Verdict: PENDING`. If it exists, leave it alone. The stub marks the review as launched; the reviewer overwrites it, but refuses any other existing file.

```
Spawn qrspi-x:reviewer agent for feature: <feature-name>
Diff: <result.diff>
Phase: <result.phase>
Label: <result.label>
```

Do not spawn the explainer; it is an opt-in aid for a human who is present.

When it returns, run `loop --end review` (or `loop --end re-review`), with no `--result`: the helper reads the verdict from the artifact and decides what follows. Conditions never trigger a repair; they are reported at the end.

### `repair`

Run `loop --begin repair`. This consumes the phase's one repair attempt before the agent runs, so a crash cannot buy a second one. The result's `review` is the failed review's path relative to `./qrspi/<feature>/`.

```
Spawn qrspi-x:implementer agent for feature: <feature-name>
Mode: repair
Phase: <result.phase>
Review: ./qrspi/<feature>/<result.review>
```

When it returns, run `loop --end repair`, with `--result STOPPED --note "<reason>"` if it stopped.

### `end`

A launch is open and its output is already on disk — typically a session that died after the agent finished. Run `loop --end <result.loop.launch>` without spawning anything.

### `advance`

Mark the finished phase `[x]` in `plan.md`, then run `loop --advance`. The helper moves to the next phase in scope, or marks the loop `done` when the scope is complete.

### `stop`, `acknowledge-required`, or `done`

Go to **Handing back**. For `stop`, first run `loop --stop "<result.loop.reason>"` so the stop is recorded. If the helper returns an action it has not listed here, stop and hand back rather than guess.

## Context discipline

Do not read source files, run diffs, or read review artifacts beyond the verdict and findings table. Put every heavy read in a subagent. The orchestrator holds only scope, verdicts, and state so it can survive to the end of the run.

## Resuming

Run `report`. If there is no `result.loop`, this is not a resumable autoloop run; start from the entry gate.

Otherwise dispatch on `result.loop.action` exactly as in **The loop**. The helper has already worked out where the run was: a relaunch of an interrupted implementer continues at the first step not marked `[x]`; `end` records an agent that finished before the session died; a review action reuses its label and any PENDING stub.

If the action is `acknowledge-required`, the loop is stopped (`reason`) or has open `blockers`. Report them and wait for the human; do not resume past them. After the human has acted — fixed the problem, written a verdict into a leftover PENDING stub, or relaunched it themselves — run `loop --ok "<what they did>"` and continue from its `result.action`. If the human wants to end the run instead, run `loop --abandon "<reason>"`.

## Handing back

Stop and report. Do not run the final review, create a PR, or clean up artifacts.

Report:
1. **Outcome** — completed in full, or stopped (and why, from `report`'s `current.loop.stoppedReason`).
2. **Phases completed**, with each review label and verdict (`report`'s `current.loop.checkpoints`; these span every loop run on the feature, so report the entries for this run's `phases`).
3. **Accumulated conditions** from `report`'s `current.loop.conditions` — every non-blocking finding the loop advanced past, grouped by phase. These were never fixed; they are the human's to triage.
4. **Where it stopped**, if it stopped: the phase, the cycle, the blocker, and the relevant review artifact path.
5. **What's next** — the final review, run by the human, ideally on a different model than this session used.

In `step` commit mode, commits are one per step, plus one per repair. Offer to squash before the final review, but do not squash unasked — the commits are the record of what the loop did, and they are the only way to see where a phase went wrong.
