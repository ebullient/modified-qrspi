# Interactive rules

The workflow supports two styles of execution: a human-gated interactive workflow and an unattended loop. Both rely on on-disk evidence, and neither should be made to guess past an ambiguity.

## Interactive mode without the helper

The helper is optional for interactive work. The skills can run the complete human-gated workflow using the artifacts, plan table, phase markers, and review files directly. Without the helper, there is no durable `history.jsonl`, automatic recovery state, generated-label service, or helper-derived status; navigation stays in the conversation and the human remains responsible for resuming from the artifacts.

The unattended loop is different: it requires the helper because it needs durable loop state and crash-safe transitions.

## Human gates

The workflow skill owns navigation and asks the human before moving to the next step, phase, or review. A command may prepare or record a transition, but that bookkeeping is not approval to continue. Review results are also gates: `PASS` can continue, `PASS WITH CONDITIONS` continues only with conditions reported for later triage, and `FAIL` returns to repair or planning.

Agents should keep the responsibilities separate:

- the workflow/orchestrator chooses what happens next and talks to the human;
- implementation changes product code and phase markers;
- review reads the scoped diff and writes a verdict artifact;
- the helper records facts and derives the next action from those facts.

## Unattended execution

`loop-state.json` is a cache of execution state, not a replacement for the source artifacts. It records the selected scope, current phase, in-flight task, review checkpoint, open conditions, and stop reason. The helper combines it with phase markers, review files, and history to derive the next action.

Before an unattended spawn, the intended task is recorded. After the agent returns, the helper reads the phase file, commits, or review artifact and then clears/completes the in-flight record. A crash therefore leaves a resumable intent instead of silently appearing idle.

Conceptually, the loop repeats this cycle:

1. establish the approved phase scope and cache its position;
2. record the task before spawning an implementer or reviewer;
3. inspect the returned on-disk evidence and record completion;
4. advance after `PASS` or `PASS WITH CONDITIONS`, or make one repair/re-review attempt after `FAIL`;
5. stop and hand back to the human when the run is blocked or ambiguous.

The exact command shape is intentionally left to the helper's own help and the autoloop skill.

There is at most one repair/re-review attempt for a failed phase in an unattended run. A second failure stops for the human. Conditions accumulate as pointers to review labels; the review history remains the durable record after loop state is removed.

## Evidence and retries

Regardless of mode, transitions use on-disk evidence. Completion checks the phase markers rather than an agent's prose report, and review decisions come from the review file's `## Verdict: PASS`, `PASS WITH CONDITIONS`, or `FAIL` line.

In helper-assisted execution, starting work records a `begin` event before the agent is spawned and finishing work records an `end` event after the evidence is present. Retries use existing state to avoid duplicating begin/end history, loop transitions, or review launches. Do not hand-edit `history.jsonl` or `loop-state.json`; use the helper's owning operation so recovery remains consistent.

## Results

Normal structured results are flat JSON objects. At the result layer, `exitCode`, `findings`, and `wrote` are reserved; the JSON output omits `exitCode` and includes the other two only when non-empty. Command-specific fields stay at the top level. Exit code `0` is clean, `1` is blocked/refused, `2` is a usage error, `3` is usable with findings, and `4` is unexpected failure.

Some read-oriented operations intentionally return bare content or a bare path rather than a JSON envelope.
