# Working on this repo

Conventions for editing QRSPI-X itself. This file is for whoever (human or agent) is **modifying** the plugin. It is not shipped guidance for running a QRSPI workflow — that's [README.md](README.md), and the skills and agents are instructions to the agents that execute the workflow.

Most of this repo is markdown, with the private TypeScript helper under `tools/`. Read the file you're changing in full before changing it.

## Layout

```
skills/<name>/SKILL.md    one skill per directory, always named SKILL.md
agents/<name>.md          one agent per file
.claude-plugin/           plugin manifest (name, version)
tools/                    published helper source and build metadata
```

Skills are invoked as `qrspi-x:<name>`. Agents are spawned by skills as `qrspi-x:<name>`.

## Skills vs agents

The split is deliberate and load-bearing:

- **A skill** runs in the main conversation. It orchestrates: it decides what happens next, talks to the human, records state through the helper, and spawns agents.
- **An agent** runs in an isolated subagent with its own context. It does the heavy reading and writing, then discards its context when it returns.

Work goes in an agent when it would otherwise flood the main conversation with diffs or file contents, or when isolation is the point — Query must not see the codebase, Research must not see Query's reasoning, the reviewer must not see the implementer's.

When a step needs both, the skill is the thin caller and the agent holds the contract. `review` and `autoloop` are the clearest examples.

### Agent frontmatter

```yaml
---
name: <matches the filename>
description: <what it does, and which skill spawns it>
tools: Read, Write, Bash, Glob, Grep
model: inherit
color: <terminal color>
---
```

**`model: inherit` on every agent, always.** Never name a specific model. It keeps the plugin portable across whatever the user has access to, and it keeps model choice where it belongs: the human picks the session model, which is how the README's "review on a different model than you implemented on" advice is actually honored. Hardcoding a model would silently break that and age badly.

Tools are the minimum the agent needs. `query` gets `Write` only — it *cannot* read the codebase even if it tried, which is the entire mechanism behind unbiased question generation. Don't widen a toolset for convenience; a narrower toolset is often the guarantee.

`implementer` is the only agent with `Edit`, because it's the only one that writes product code.

Colors are cosmetic, but currently unique per agent — keep them that way when adding one, so a color identifies an agent at a glance in a multi-agent run. Taken: purple (explainer), yellow (explorer), orange (implementer), green (query), blue (researcher), red (reviewer), cyan (shaper).

### Skill frontmatter

```yaml
---
name: <matches the directory>
description: 'QRSPI Step N: <what it does>'
when_to_use: '<when to invoke, and when NOT to — name the alternative>'
disable-model-invocation: false
compatibility: Node 22+   # when the skill calls the helper
---
```

`when_to_use` should always say what to use *instead* for adjacent cases. Most of these skills are near-misses for each other, and the disambiguation is what stops the wrong one firing.

Each skill opens with a `## Core Philosophy` section of one or two lines — the single rule that skill exists to enforce ("Only review, never fix", "Execute the plan, don't deviate"). Keep it that short. It's the line that survives when everything else is skimmed.

## Artifacts and state

Workflow artifacts live in `./qrspi/<feature>/` in the *user's* project, never in this repo. They are disposable scaffolding; the code is the source of truth. Per-phase plan files live in the `plans/` subdirectory; `plan.md` and the other artifacts stay in the workspace root, reviews stay in `reviews/`, and the artifacts Query, Research, Shape, and Spec displace on a rerun go to `backups/` as `<stem>-<n>.md`.

`state.json`'s schema is documented in [skills/workflow/SKILL.md](skills/workflow/SKILL.md) and that is the single source of truth for it. If you add a field, document it there, and say which skill owns it.

Rules that hold across every skill:

- **Updates are idempotent.** Helper records are no-ops when they would change nothing; history is append-only for completed transitions.
- **Each skill owns its own completion fields.** The orchestrator owns navigation and `--step` jumps, and nothing else. Don't write another skill's fields.
- **Record transitions before acting, not after.** Especially in `autoloop`: a session that dies mid-spawn must leave behind what it was *doing*, not what it last *finished*. Use the helper's `loop --begin` commands.
- **QRSPI artifacts are never committed** to the user's project and never counted as product files in a diff.

## Labels

Review and explain artifacts are keyed by label (`phase-2`, `phase-2-r2`, `final`). Labels must be non-empty kebab-case path components, and **never reused** — the reviewer stops rather than overwrite an existing artifact. That stop is correct behavior, but it will strand an automated loop, so any skill generating labels must generate fresh ones (see `autoloop`'s re-review).

## Duplication to keep in sync

**Per-step implementation mechanics** appear in two places:

- [skills/implement/SKILL.md](skills/implement/SKILL.md) — interactive, gated, human present
- [agents/implementer.md](agents/implementer.md) — unattended, spawned by `autoloop`

The shared part is the step sequence: mark `[~]` → change → verify → commit → mark `[x]`. Commit before marking `[x]`, so a completed marker always has a commit behind it. Progress comes from phase markers; state is written by the caller through the helper. **If you change that sequence, change it in both.**

The differences are intentional and should not be "fixed" into agreement:

| | `implement` skill | `implementer` agent |
|---|---|---|
| Approval | pauses per execution mode | never pauses — nobody's there |
| Execution modes | four (single/partial/phase/full) | one: the phase it's given |
| Commits | per step, unless human asks per-phase | the commit mode it's given; repairs always a new commit |
| Bookkeeping | markers and commits per step | markers and commits per step |
| Bad plan | stop, explain, propose, await approval | stop, record, report |
| Repair mode | none | half the contract |

The agent is stricter because it is unattended. Don't import that strictness into the interactive skill, and don't relax it in the agent.

The transition table in `skills/workflow/SKILL.md` and the command implementations under `tools/src/state/` must change together. So must any skill text that names a helper command, option, result field, finding code, or Markdown heading the helper parses — the helper is the contract, and a skill that disagrees with it fails at runtime. **The bare `qrspi-x` invocation form is duplicated across all ten stateful skills and `README.md`; change one and check the others.** Before committing helper or skill changes, run `cd tools && npm run fullbuild`; the generated bundle is ignored. Don't bump versions by hand: the manual release workflow sets the version in `tools/package.json` and `.claude-plugin/plugin.json` and commits the bump.

**Diff scope resolution** appears in `reviewer` and `explainer` with near-identical wording (the `git merge-base` fallback against the default branch, and stopping rather than guessing a scope). These two drifting apart is a real risk; check the other when you touch one. `explorer` has no diff-scope section — it surveys a codebase rather than a change.

**No agent enumerates the artifacts.** The reviewer decides by location: everything under `qrspi/` is scaffolding, never a product file and never blocking, whatever it is named and whichever feature it belongs to. Only an untracked source file *outside* `qrspi/` blocks, because that one silently leaves the diff under review. Nothing inside `qrspi/` is reported at all, recognized or not — humans and agents leave working notes and checklists in the workspace, and naming them would reintroduce recognition-by-filename through the back door. `explainer` likewise states only that QRSPI artifacts are read directly and are not part of the product diff, and `explorer` says nothing about artifacts at all.

This replaced an allowlist of filenames, which twice blocked a layout the rest of the plugin supported — once for `plan-phase-*.md`, once for `queries.md.bak*` — because a list of names cannot anticipate what a skill or agent will legitimately write. So adding an artifact needs no reviewer change; don't go looking for a list to update.

**The QRSPI artifact inventory** — including the `plans/`, `backups/`, and `reviews/` subdirectories, not just the root-level files — is repeated in the workflow staleness rules. `workflow` never cleans up `./qrspi/<feature>/`; disposing of any artifact there, done or not, is the human's call, so there is no cleanup keep/remove list to keep in sync. When adding or renaming an artifact, check the staleness rules so resume logic still agrees about what is metadata, what is retained, and what becomes stale. The reviewer is not one of these copies — it goes by location, not by name.

**The backup rule** is stated four times, once in each skill that owns a rerunnable artifact: `query` (`queries`), `research` (`research`), `shape` (`approach`), and `spec` (`spec`). Each copy is deliberately self-contained — a skill is a prompt loaded on its own, so a cross-reference to another skill is a read the agent may never make. The load-bearing part is identical by design — the stem aside, the numbering, the no-overwrite guarantee, and the "create `backups/` only when there is something to put in it" clause must match word for word. What follows that clause may differ: `query` and `research` add that the agent cannot overwrite the old file, and `research` says to do it before spawning, because those two hand the artifact to a subagent; `shape` and `spec` write it themselves and need no such warning. Change one and change all four, or reruns of different steps will number or overwrite backups differently, which is exactly the inconsistency the old undefined `queries.md.bak` scheme produced.

## Gate contracts

`workflow` and `autoloop` both gate; they differ in granularity. `workflow` gates every step, `autoloop` gates the phase or the whole plan, and says which it is.

If you add another orchestrator, state its gate granularity in the skill itself. "Humans gate every transition" holds across the plugin — what an orchestrator may choose is how much work sits behind one gate, never whether a human sees the result before it is integrated.

## Style

Write instructions that say what to do and why, in that order, with the reason attached to anything counterintuitive. An agent that knows *why* a rule exists follows it in situations the rule didn't anticipate; one that only knows the rule optimizes it away the first time it looks redundant. The "never batch the bookkeeping" note in `implementer` is the pattern: the rule, then one sentence on what breaks without it.

Prefer mechanical criteria over judgment where a rule has to hold. The reviewer's verdict rules are a table, not a vibe, which is why the verdict is reproducible.

Second person for agents ("You are a QRSPI..."), imperative for skills. Match the surrounding file.

## Before committing

- Re-read the whole file you edited. A skill is a prompt; a contradiction two sections apart is a bug.
- Check whether the change affects one of the duplicated sections above.
- If behavior visible to a workflow-runner changed, update [README.md](README.md).
- If `state.json` changed, update the schema in [skills/workflow/SKILL.md](skills/workflow/SKILL.md).

Commit messages in this repo use a gitmoji prefix (`✨`, `🐛`, `📝`, `🔧`, `🔖`) — match what's already in `git log`.
