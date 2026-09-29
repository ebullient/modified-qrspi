/** The state file inside a feature workspace; the one place its name is spelled. */
export const stateFileName = "state.json";

declare const phaseIdBrand: unique symbol;

export type PhaseId = string & { readonly [phaseIdBrand]: true };

export type WorkflowPhase = "discovery" | "definition" | "execution";

/** The workflow's steps in order; the loop's `checkpoint` runs within `implement`. */
export const workflowOrder = [
    "init",
    "query",
    "research",
    "shape",
    "spec",
    "plan",
    "implement",
    "review",
] as const;

export type WorkflowStep = (typeof workflowOrder)[number];

export type CurrentStep = WorkflowStep | "checkpoint";

/** Whether `step` is a discovery or definition step, `init` through `plan`. */
export function isDefinitionStep(step: CurrentStep): step is WorkflowStep {
    return (
        step !== "checkpoint" &&
        workflowOrder.indexOf(step) <= workflowOrder.indexOf("plan")
    );
}

/** The loop's cycles. */
export const loopCycles = [
    "implement",
    "review",
    "repair",
    "re-review",
    "advance",
    "done",
] as const;

export type LoopCycle = (typeof loopCycles)[number];

/** A review's verdict, as written in its artifact and recorded in history. */
export const verdicts = ["PASS", "PASS WITH CONDITIONS", "FAIL"] as const;

export type Verdict = (typeof verdicts)[number];

/** A loop-run history entry's outcome. */
export const outcomes = ["COMPLETE", "STOPPED", "incomplete"] as const;

export type Outcome = (typeof outcomes)[number];

/** How a phase's work is committed. */
export const commitModes = ["phase", "step"] as const;

export type CommitMode = (typeof commitModes)[number];

export interface HistoryEntry {
    step: CurrentStep;
    timestamp?: string;
    mode?: string;
    reason?: string;
    label?: string;
    verdict?: Verdict;
    artifact?: string;
    phase?: PhaseId;
    by?: string;
    outcome?: Outcome;
}

export interface LoopCondition {
    phase: PhaseId;
    label: string;
    note: string;
}

export interface LoopBlock {
    scope: string;
    phases: PhaseId[];
    cycle: LoopCycle;
    phase: PhaseId;
    conditions: LoopCondition[];
    stoppedReason: string | null;
}

/** Live implementation progress, computed from phase markers, never persisted. */
export interface PlanProgress {
    current: string | null;
    completed: string[];
    blocked: string[];
}

/** The workflow phase a step belongs to. The single owner of that mapping. */
export function phaseOf(step: CurrentStep): WorkflowPhase {
    switch (step) {
        case "init":
        case "query":
        case "research":
            return "discovery";
        case "shape":
        case "spec":
        case "plan":
            return "definition";
        case "implement":
        case "review":
        case "checkpoint":
            return "execution";
    }
}

export interface State {
    feature: string;
    currentStep: CurrentStep;
    blockers: string[];
    decisions: string[];
    history: HistoryEntry[];
    /** Absent reads as `null` until `record plan` or `record implement` sets it. */
    planPhase?: PhaseId | null;
    /** Absent reads as `null` until a phase starts. */
    phaseBaseSha?: string | null;
    /** Absent reads as `"phase"` until a phase selects a mode. */
    commitMode?: CommitMode;
    loop?: LoopBlock;
    /** Stored only when `true`; absent reads as not done. Set by `record done`; removed by any other `record <step>`, since resuming work is itself evidence the feature isn't done. */
    completed?: boolean;
}

/** A state as command output: the persisted state plus the phase derived from its step. */
export type StateView = State & { currentPhase: WorkflowPhase };

/** Adds the derived `currentPhase` to a state for output; the key comes right after `feature`. */
export function viewOf(state: State): StateView {
    const { feature, ...rest } = state;
    return {
        feature,
        currentPhase: phaseOf(state.currentStep),
        ...rest,
    };
}

export type FindingCode =
    | "state-invalid"
    | "workspace-incomplete"
    | "plan-not-current"
    | "open-questions"
    | "new-questions"
    | "approach-undecided"
    | "multiple-in-progress"
    | "step-blocked"
    | "phase-row-mismatch"
    | "phase-complete"
    | "dependency-incomplete"
    | "phase-base-reset"
    | "advance-pending"
    | "dirty-tree"
    | "stale-downstream"
    | "review-pending"
    | "loop-stopped"
    | "blockers"
    | "loop-refused"
    | "loop-active"
    | "base-not-ancestor"
    | "legacy-plan-location"
    | "plans-not-a-directory"
    | "format-invalid";

export interface Finding {
    code: FindingCode;
    message: string;
    file?: string;
    line?: number;
}

/** The recommended next position. `mode` qualifies a Query pass, `gate` marks a human decision, `phase`/`planStep` locate implementation. */
export interface NextPosition {
    step: WorkflowStep | "loop";
    mode?: "initial" | "regeneration" | "refinement" | "revision";
    gate?: "decide";
    phase?: PhaseId;
    /** The plan step id (e.g. `"2.3"`) recommended to start next. */
    planStep?: string;
    /** The human review label a recommended review should use. */
    label?: string;
}

export interface CommandOutcome<Result = unknown> {
    exitCode: 0 | 1 | 2 | 3 | 4;
    result?: Result;
    findings: Finding[];
    wrote: boolean;
}
