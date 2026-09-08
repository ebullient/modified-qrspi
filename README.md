# QRSPI-X

A modified version of Dexter Horthy's QRSPI method for spec-driven, human-gated feature development with coding agents. Built as a set of Claude Code skills and subagents.

This README is for the human running the workflow. The `skills/*/SKILL.md` and `agents/*.md` files are instructions for the agents. This file explains how and why to use them, and what makes the human-approval steps actually work.

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
| Review | Adversarial check against the spec and plan; PASS / PASS WITH CONDITIONS / FAIL | isolated subagent, full read tools |

Query and Research can loop — research turns up a new question, you go back to query, then research again — for as long as needed. Everything after Spec runs in order, but you can always go back a step: "back to research," "revise spec," "revise plan" are all valid at any approval point.

State is saved in `./qrspi/<feature>/state.json`, so you can pause a workflow and pick it up later in a fresh conversation without re-explaining where it left off.

## How to actually run this well

The tooling doesn't enforce any of this. It's just what makes the process work in practice.

**Run Review on a different model or provider than the one that wrote the code.**

- Every agent here (`query`, `researcher`, `reviewer`, `explorer`) is set to `model: inherit` — the subagent runs on whatever model drives your current session.
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

## Cleanup

Once things are done, keep `request.md` and `spec.md` for reference. `queries.md`, `research.md`, and `plan*.md` can be deleted once their content is reflected in the code and commits. Review artifacts may worth keeping. Use your own judgement for long-term utility vs. noise.

## See also

- ["Everything We Got Wrong About Research-Plan-Implement"](https://www.youtube.com/watch?v=YwZR6tc7qYg) — Dexter Horthy's retrospective this workflow is built from
