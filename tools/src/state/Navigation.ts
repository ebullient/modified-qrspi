import { firstUnfinishedStep } from "../workspace/PhaseFile.ts";
import { isHumanReviewLabel } from "../workspace/ReviewArtifact.ts";
import type { Workspace } from "../workspace/Workspace.ts";
import { Findings } from "./Findings.ts";
import { isFinalLabel } from "./ids.ts";
import { clean } from "./loop/helpers.ts";
import { ReviewLabels } from "./ReviewLabels.ts";
import { artifactOfStep } from "./steps.ts";
import {
    type Finding,
    type HistoryEntry,
    isDefinitionStep,
    type NextPosition,
    phaseOf,
    type State,
    type WorkflowStep,
    workflowOrder,
} from "./types.ts";

export interface NavigationResult {
    next: NextPosition | null;
    alternatives: string[];
    findings: Finding[];
}

export interface NavigationInput {
    /** The recovered state, or `null` when neither `state.json` nor `request.md` exists. */
    state: State | null;
    workspace: Workspace;
}

const definitionStepOrder = workflowOrder.filter(isDefinitionStep);

export function navigate(input: NavigationInput): NavigationResult {
    const { state, workspace } = input;

    // No state.json: init recreates it. No request.md: only a human can supply it.
    const hasRequest = workspace.hasFile("request.md");
    if (state === null) {
        return { next: { step: "init" }, alternatives: [], findings: [] };
    }
    if (!hasRequest) {
        return {
            next: null,
            alternatives: [],
            findings: [Findings.workspaceIncomplete("request.md")],
        };
    }

    // An active loop short-circuits every other position.
    if (state.loop && state.loop.cycle !== "done") {
        return {
            next: { step: "loop" },
            alternatives: [],
            findings: staleDownstream(state, workspace),
        };
    }

    const result = navigateByStep(state, workspace);
    return {
        ...result,
        findings: [...staleDownstream(state, workspace), ...result.findings],
    };
}

function navigateByStep(s: State, workspace: Workspace): NavigationResult {
    switch (s.currentStep) {
        case "init":
            return {
                next: {
                    step: "query",
                    mode: workspace.hasFile("queries.md")
                        ? "regeneration"
                        : "initial",
                },
                alternatives: [],
                findings: [],
            };

        case "query":
            return {
                next: { step: "research" },
                alternatives: ["query"],
                findings: [],
            };

        case "research":
            return navigateResearch(workspace);

        case "shape":
            // Decided means approach.md has a filled-in Decision section.
            return !workspace.decided()
                ? {
                      next: { step: "shape", gate: "decide" },
                      alternatives: ["query", "research"],
                      findings: [],
                  }
                : {
                      next: { step: "spec" },
                      alternatives: ["query", "research", "shape"],
                      findings: [],
                  };

        case "spec":
            return {
                next: { step: "plan" },
                alternatives: ["shape", "query", "spec"],
                findings: [],
            };

        case "plan":
            return navigatePlan(workspace);

        case "implement":
            return navigateImplement(s, workspace);

        case "review":
            return navigateReview(s, workspace);

        case "checkpoint":
            // Only reachable during a loop, which returns above.
            return { next: null, alternatives: [], findings: [] };
    }
}

function navigatePlan(workspace: Workspace): NavigationResult {
    const eligible = workspace.firstReadyPhase();

    return {
        next: {
            step: "implement",
            ...(eligible !== null ? { phase: eligible } : {}),
        },
        alternatives: ["loop", "plan"],
        findings: [],
    };
}

function navigateResearch(workspace: Workspace): NavigationResult {
    if (workspace.newQuestions().open.length > 0) {
        return {
            next: { step: "query", mode: "refinement" },
            alternatives: ["research", "shape", "spec"],
            findings: [],
        };
    }

    if (workspace.hasFile("approach.md") && !workspace.decided()) {
        return {
            next: { step: "shape", gate: "decide" },
            alternatives: [],
            findings: [],
        };
    }

    return {
        next: { step: "spec" },
        alternatives: ["shape", "query"],
        findings: [],
    };
}

function navigateImplement(s: State, workspace: Workspace): NavigationResult {
    const planPhase = s.planPhase ?? null;
    const phaseFile =
        planPhase === null ? null : workspace.phaseFile(planPhase);
    const plan = workspace.plan();

    if (planPhase !== null && phaseFile !== null) {
        const unfinishedStep = firstUnfinishedStep(phaseFile);
        if (unfinishedStep !== undefined) {
            return {
                next: {
                    step: "implement",
                    phase: planPhase,
                    planStep: `${planPhase}.${unfinishedStep.step}`,
                },
                alternatives: ["review"],
                findings: [],
            };
        }
    }

    // planPhase's file is missing, empty, or malformed: stay on the phase.
    if (planPhase !== null && !workspace.phaseComplete(planPhase)) {
        return {
            next: { step: "implement", phase: planPhase },
            alternatives: ["plan"],
            findings: [],
        };
    }

    // planPhase is complete.
    const labels = reviewLabels(s, workspace);
    const phasesRemain =
        plan?.rows.some((row) => !workspace.phaseComplete(row.phase)) ?? false;
    if (phasesRemain) {
        return {
            next: {
                step: "review",
                ...(planPhase !== null
                    ? { phase: planPhase, label: labels.phase(planPhase) }
                    : {}),
            },
            alternatives: ["implement"],
            findings: [],
        };
    }

    return {
        next: { step: "review", label: labels.final() },
        alternatives: ["plan"],
        findings: [],
    };
}

function navigateReview(s: State, workspace: Workspace): NavigationResult {
    const humanReviews = s.history.filter(
        (entry): entry is HistoryEntry & { label: string; verdict: string } =>
            entry.step === "review" &&
            typeof entry.label === "string" &&
            isHumanReviewLabel(entry.label) &&
            typeof entry.verdict === "string",
    );
    const lastReview = humanReviews.at(-1);
    const plan = workspace.plan();
    const allPhasesDone =
        plan?.rows.every((row) => workspace.phaseComplete(row.phase)) ?? false;

    if (lastReview === undefined) {
        return { next: null, alternatives: [], findings: [] };
    }

    if (isFinalLabel(lastReview.label)) {
        if (!clean(lastReview.verdict)) {
            return {
                next: { step: "plan", mode: "revision" },
                alternatives: ["spec", "review"],
                findings: [],
            };
        }
        if (allPhasesDone) {
            return { next: null, alternatives: [], findings: [] };
        }
        // A passing final review, but phases were added after it.
        return {
            next: { step: "implement" },
            alternatives: ["plan", "spec", "review"],
            findings: [],
        };
    }

    // The last human phase or mid-phase review (not a "final" one).
    if (clean(lastReview.verdict)) {
        return {
            next: allPhasesDone
                ? { step: "review", label: reviewLabels(s, workspace).final() }
                : { step: "implement" },
            alternatives: ["review"],
            findings: [],
        };
    }

    return {
        next: { step: "plan", mode: "revision" },
        alternatives: ["review", "spec"],
        findings: [],
    };
}

function reviewLabels(s: State, workspace: Workspace): ReviewLabels {
    return new ReviewLabels(workspace.reviewLabels(), s.history);
}

function staleDownstream(s: State, workspace: Workspace): Finding[] {
    if (phaseOf(s.currentStep) === "execution") {
        return [];
    }

    const currentIndex = definitionStepOrder.indexOf(
        s.currentStep as WorkflowStep,
    );
    if (currentIndex < 0) return [];

    const staleSteps = definitionStepOrder.filter((step) => {
        const stepIndex = definitionStepOrder.indexOf(step);
        if (stepIndex <= currentIndex) return false;
        const artifact = artifactOfStep(step);
        return artifact !== undefined && workspace.hasFile(artifact);
    });

    return staleSteps.length > 0
        ? [Findings.staleDownstream(staleSteps.join(", "))]
        : [];
}
