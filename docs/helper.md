# QRSPI-X helper notes

These notes are a short map of the helper for agents working on the workflow. They describe where the helper looks and the interactive invariants it protects; they are not a replacement for the workflow skills or a CLI reference.

When a note and the implementation disagree, read `tools/src` and tests first. The helper is the source of truth for persisted state and command behavior.

## Start here

- [Workspace](workspace.md) — artifact locations, progress detection, plan parsing, and labels.
- [Interaction](interaction.md) — human gates, evidence checks, recovery, and review outcomes.

## Source map

Paths below are relative to `tools/`.

- `src/cli.ts` parses options, dispatches commands, and chooses output/exit behavior.
- `src/command/` contains the command-level gates and writes.
- `src/workspace/Workspace.ts` owns artifact discovery, phase selection, and generated paths.
- `src/workspace/PlanTable.ts` owns dependency parsing and scope resolution.
- `src/workspace/LoopState.ts` owns unattended execution state and its next action.
- `src/workspace/History.ts` and `Decisions.ts` own the append-only timeline and durable rationale.
- `test/` is the executable contract for edge cases and idempotency.
