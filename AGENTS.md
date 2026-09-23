# Working on this repo

Conventions for editing QRSPI-X itself. This file is for whoever (human or agent) is **modifying** the plugin. It is not shipped guidance for running a QRSPI workflow — that's [README.md](README.md), and the skills and agents are instructions to the agents that execute the workflow.

Everything here is markdown. There is no build, no test suite, and nothing that will catch a mistake for you: a wrong instruction just produces wrong behavior at runtime, in someone else's session. Read the file you're changing in full before changing it.

## Layout

```
skills/<name>/SKILL.md    one skill per directory, always named SKILL.md
agents/<name>.md          one agent per file
.claude-plugin/           plugin manifest (name, version)
```

Skills are invoked as `qrspi-x:<name>`. Agents are spawned by skills as `qrspi-x:<name>`.

## Skills vs agents

The split is deliberate and load-bearing:

- **A skill** runs in the main conversation. It orchestrates: it decides what happens next, talks to the human, updates `state.json`, and spawns agents.
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

Colors are cosmetic, but currently unique per agent — keep them that way when adding one, so a color identifies an agent at a glance in a multi-agent run. Taken: purple (explainer), yellow (explorer), orange (implementer), green (query), blue (researcher), red (reviewer).

### Skill frontmatter

```yaml
---
name: <matches the directory>
description: 'QRSPI Step N: <what it does>'
when_to_use: '<when to invoke, and when NOT to — name the alternative>'
disable-model-invocation: false
---
```

`when_to_use` should always say what to use *instead* for adjacent cases. Most of these skills are near-misses for each other, and the disambiguation is what stops the wrong one firing.

Each skill opens with a `## Core Philosophy` section of one or two lines — the single rule that skill exists to enforce ("Only review, never fix", "Execute the plan, don't deviate"). Keep it that short. It's the line that survives when everything else is skimmed.

## Artifacts and state

Workflow artifacts live in `./qrspi/<feature>/` in the *user's* project, never in this repo. They are disposable scaffolding; the code is the source of truth.

`state.json`'s schema is documented in [skills/workflow/SKILL.md](skills/workflow/SKILL.md) and that is the single source of truth for it. If you add a field, document it there, and say which skill owns it.

Rules that hold across every skill:

- **Updates are idempotent.** `completedSteps` is a set — a rerun doesn't add a second entry. `history` is append-only; each completed invocation appends exactly one entry.
- **Each skill owns its own completion fields.** The orchestrator owns navigation and `--step` jumps, and nothing else. Don't write another skill's fields.
- **Write state before acting, not after.** Especially in `autoloop`: a session that dies mid-spawn must leave behind what it was *doing*, not what it last *finished*. This is what makes resume work.
- **QRSPI artifacts are never committed** to the user's project and never counted as product files in a diff.

## Labels

Review and explain artifacts are keyed by label (`phase-2`, `phase-2-r2`, `final`). Labels must be non-empty kebab-case path components, and **never reused** — the reviewer stops rather than overwrite an existing artifact. That stop is correct behavior, but it will strand an automated loop, so any skill generating labels must generate fresh ones (see `autoloop`'s re-review).

## Duplication to keep in sync

**Per-step implementation mechanics** appear in two places:

- [skills/implement/SKILL.md](skills/implement/SKILL.md) — interactive, gated, human present
- [agents/implementer.md](agents/implementer.md) — unattended, spawned by `autoloop`

The shared part is the step sequence: mark `[~]` → set `activePlanStep` → change → verify → mark `[x]` → update `completedPlanSteps` → commit. **If you change that sequence, change it in both.**

The differences are intentional and should not be "fixed" into agreement:

| | `implement` skill | `implementer` agent |
|---|---|---|
| Approval | pauses per execution mode | never pauses — nobody's there |
| Execution modes | four (single/partial/phase/full) | one: the phase it's given |
| Commits | per step, unless human asks per-phase | always per step |
| Bookkeeping | updated per step | *immediately* per step, never batched |
| Bad plan | stop, explain, propose, await approval | stop, record, report |
| Repair mode | none | half the contract |

The agent is stricter because it is unattended. Don't import that strictness into the interactive skill, and don't relax it in the agent.

**Diff scope resolution** appears in `reviewer`, `explainer`, and `explorer` with near-identical wording (the `git merge-base` fallback, the untracked-files check, the allowed-artifact list). These drifting apart is a real risk; check the others when you touch one.

## Gate contracts

`workflow` gates every transition. `autoloop` gates only entry and exit, and says so explicitly rather than quietly making an exception.

If you add another orchestrator, state its gate contract in the skill itself. "Humans gate every transition" is `workflow`'s property, not a global invariant — but a skill that departs from it has to be honest about doing so, in the skill and in the README.

## Style

Write instructions that say what to do and why, in that order, with the reason attached to anything counterintuitive. An agent that knows *why* a rule exists follows it in situations the rule didn't anticipate; one that only knows the rule optimizes it away the first time it looks redundant. The "never batch the bookkeeping" note in `implementer` is the pattern: the rule, then one sentence on what breaks without it.

Prefer mechanical criteria over judgment where a rule has to hold. The reviewer's verdict rules are a table, not a vibe, which is why the verdict is reproducible.

Second person for agents ("You are a QRSPI..."), imperative for skills. Match the surrounding file.

## Before committing

- Re-read the whole file you edited. A skill is a prompt; a contradiction two sections apart is a bug.
- Check whether the change affects one of the duplicated sections above.
- If behavior visible to a workflow-runner changed, update [README.md](README.md).
- If `state.json` changed, update the schema in [skills/workflow/SKILL.md](skills/workflow/SKILL.md).
- Bump `version` in [.claude-plugin/](.claude-plugin/) for a release.

Commit messages in this repo use a gitmoji prefix (`✨`, `🐛`, `📝`, `🔧`, `🔖`) — match what's already in `git log`.
