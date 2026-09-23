# QRSPI-X

A modified version of Dexter Horthy's QRSPI method for spec-driven, human-gated feature development with coding agents. Built as a set of Claude Code skills and subagents.

This README is for the human running the workflow. The `skills/*/SKILL.md` and `agents/*.md` files are instructions for the agents. This file explains how and why to use them, and what makes the human-approval steps actually work.

## Package layout for agent roles

Codex discovers the workflow skills by finding `SKILL.md` files under the package's `skills/` directory. It does not automatically register the Markdown files under `agents/` as named subagents. Each caller skill should prefer a registered named agent when the runtime provides one; otherwise, it loads the appropriate role definition and passes its contents to a generic subagent.

Keep the role definitions bundled in an `agents/` directory that is a peer of `skills/` at the package root:

```
<package-root>/
├── agents/
│   └── <agent>.md
└── skills/
    └── <skill>/
        └── SKILL.md
```

Caller skills resolve role files package-relatively (for example, `../../agents/query.md` from `skills/query/SKILL.md`). Keep the agent frontmatter for runtimes that support it. A generic fallback is behaviorally equivalent, but its tool permissions are runtime-dependent.

## Why this exists

Horthy's retrospective on Research-Plan-Implement (["Everything We Got Wrong About Research-Plan-Implement"](https://www.youtube.com/watch?v=YwZR6tc7qYg)) found four recurring problems:

- One giant planning prompt overloads the model.
- Research done with knowledge of the intended feature turns into opinions instead of facts.
- 1,000-line plans take as long to read as the code they produce.
- Plans that go layer by layer (all DB, then all services, then all API) hide integration bugs until the end.

QRSPI-X addresses each one:

- **Research gets biased by the feature idea** → Query and Research each run in their own isolated subagent with limited tools. Query only gets `Write` — it can't read the codebase even if it tried. Neither subagent sees the other's reasoning or the main conversation.
- **Plans are unreadable** → the plan always has two layers: a short phase overview (`plan.md`) you can read in one pass, and per-phase detail files you only open when you're implementing that phase.
- **Layer-by-layer plans hide integration bugs** → you approve phase boundaries *before* `plan.md` is written, not after. You're approving how the work is cut up, not just what's inside each piece.
- **One prompt does too much** → each stage of the pipeline (Query, Research, Spec, Plan, Implement, Review) is its own skill with one job, run fresh instead of piled into a single prompt.

## The pipeline

```
(Explore) → Init → Query ⇄ Research → Spec → Plan → Implement → Review
```

| Phase | What it does | Runs as |
|---|---|---|
| Explore *(optional)* | Look around an area of the codebase before a feature request exists; suggests candidate directions | subagent, broad tools |
| Init | Write down the feature request as-is, into `request.md` | main conversation |
| Query | Generate questions from the request — no codebase access | isolated subagent, `Write`-only |
| Research | Answer those questions by reading the codebase — facts only, no opinions | isolated subagent, full read tools |
| Spec | Define what changes and what doesn't | main conversation |
| Plan | Break the spec into small, ordered steps; **you approve the phase boundaries before the files are written** | main conversation |
| Implement | Do one step at a time, commit after each, pause for approval | main conversation |
| Review | Adversarial check against the spec and plan; PASS / PASS WITH CONDITIONS / FAIL. Optionally also spawns an explainer for a narrative walkthrough of the change | isolated subagent(s), full read tools |

Query and Research can loop — research turns up a new question, you go back to query, then research again — for as long as needed. Everything after Spec runs in order, but you can always go back a step: "back to research," "revise spec," "revise plan" are all valid at any approval point.

State is saved in `./qrspi/<feature>/state.json`, so you can pause a workflow and pick it up later in a fresh conversation without re-explaining where it left off.

## How to actually run this well

The tooling doesn't enforce any of this. It's just what makes the process work in practice.

**Run Review on a different model or provider than the one that wrote the code.**

- Every agent here (`query`, `researcher`, `reviewer`, `explainer`, `explorer`) is set to `model: inherit` — the subagent runs on whatever model drives your current session.
- That isolates the reviewer from the conversation history, but not from that model's blind spots. A model tends to miss the same things reviewing its own work that it missed writing it.
- So do it yourself: start Review in a different harness or with a different model than the one that ran Implement. It's easy to forget out of habit — watch for that.

**Use Query and Research to find the real intent, not just to check a finished task.**

- No fully-formed feature request yet? That's fine — run Query and Research against a rough idea.
- Use what comes back to rewrite `request.md` itself, not just to answer fixed questions.
- Do this before Spec. Catching a misunderstanding here is cheap; catching it later isn't.

**You don't need to read the plan closely to review it well.**

- The detailed phase files are often harder to absorb than the code they produce. "I read the plan" can be false confidence.
- Instead: skim `plan-phase-N.md`, review the actual diff at each phase boundary (the adversarial reviewer catches what you miss), and do one full pass at the end for how the phases fit together.
- Spend your attention where it pays off, not where the process says you should.

## Autoloop: running execution unattended

The pipeline above gates at every step. `qrspi-x:autoloop` is an alternate path for execution only — it gates at the phase, or at the whole plan, instead. You still approve the scope going in and still review the result before anything is integrated; what changes is how much work piles up behind one gate. Use it when the plan is straightforward enough that reviewing it in one pass is faster than reviewing it in six.

It runs one phase or all remaining phases:

```
implement phase → review → PASS: next phase
                         → FAIL: one repair pass → re-review → PASS: next phase
                                                             → FAIL: stop for you
```

Four things make it different from `qrspi-x:implement`:

- **Implementation runs in a subagent, one per phase.** The orchestrator only spawns agents and tracks state — it never reads a diff or a source file. It has to survive to the end of the run to make phase-boundary decisions, so its context stays empty on purpose.
- **One repair attempt per phase, then it stops.** Not a convergence heuristic, just a cap. A phase that fails review twice is something you should look at, and grinding on it unattended costs more than stopping.
- **It commits once per step** — the loop's undo stack as much as your history. When it hands back a half-repaired phase, per-step commits are how you find where it went wrong. Squash after you've looked, not before.
- **It stops before the final review.** Autoloop never runs it and never opens a PR.

**What you give up.** Interim reviews run on the same model that just wrote the code — every agent is `model: inherit` so the skill stays portable, and there's no human mid-loop to switch harnesses. So treat interim reviews as a fast filter, not an independent check. The independent check is the final review, which is yours to run, on a different model, exactly as described above. A run of green interim reviews is not a substitute.

It resumes. Every cycle writes its position to `state.json` before acting, so a session that dies mid-phase picks up from the first uncommitted step rather than redoing the phase.

Non-blocking findings (`PASS WITH CONDITIONS`) don't stop the loop — they accumulate and get reported together at the end for you to triage.

## Cleanup

Once the final review passes, the workflow offers to clean up (and asks before removing anything). It keeps `request.md`, `spec.md`, `reviews/`, and `state.json`, and moves only the enumerated generated artifacts (`queries.md`, `research.md`, `plan.md`, `plan-phase-*.md`, query backups, and `explain/`) to recoverable trash. Product/source files must be tracked or staged and included in the final review before cleanup. Use your own judgement for long-term utility vs. noise.

## See also

- ["Everything We Got Wrong About Research-Plan-Implement"](https://www.youtube.com/watch?v=YwZR6tc7qYg) — Dexter Horthy's retrospective this workflow is built from
