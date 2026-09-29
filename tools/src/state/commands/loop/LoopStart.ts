import { scopeErrorFinding } from "../../checks.ts";
import { UsageError } from "../../errors.ts";
import { Findings } from "../../Findings.ts";
import { resolveScope } from "../../loop/dependencyGraph.ts";
import { loopPreconditions } from "../../loop/preconditions.ts";
import { parseSelector } from "../../loop/selector.ts";
import type { CommandOutcome, PhaseId, State, StateView } from "../../types.ts";
import {
    type CommandInputs,
    requireText,
    type TransitionOptions,
} from "../inputs.ts";
import {
    type LoopDecision,
    loopTransition,
    noChange,
    refuses,
    writes,
} from "./shared.ts";

export interface LoopStartOptions extends TransitionOptions {
    selector: string;
}

export interface LoopStartResult {
    action: "implement" | "done";
    selector: string;
    phases: PhaseId[];
    state: StateView;
}

/** Creates a new dependency-closed loop scope without replacing active work. */
export function loopStart(
    inputs: CommandInputs,
    options: LoopStartOptions,
): CommandOutcome<LoopStartResult> {
    requireText(options.selector, "--start");
    return loopTransition(inputs, options, (state) =>
        decideStart(inputs, options, state),
    );
}

function decideStart(
    { services }: CommandInputs,
    options: LoopStartOptions,
    state: State | null,
): LoopDecision<LoopStartResult> {
    const { workspace } = services;
    if (state?.loop !== undefined && state.loop.cycle !== "done") {
        return refuses(
            Findings.loopRefused(
                "--start",
                "a loop is active; resume it, or end it with loop --abandon",
            ),
        );
    }

    const plan = workspace.plan();
    if (plan === null) return refuses(Findings.workspaceIncomplete("plan.md"));

    const selected = parseSelector(options.selector, plan);
    if (selected.kind !== "phases") {
        if (selected.kind === "syntax") throw new UsageError(selected.message);
        return refuses(scopeErrorFinding(selected));
    }

    const resolved = resolveScope(selected.phases, plan, (phase) =>
        workspace.phaseComplete(phase),
    );
    if (resolved.kind !== "scope") {
        return refuses(scopeErrorFinding(resolved));
    }

    const findings = loopPreconditions({
        state,
        workspace,
        git: services.git,
        phases: resolved.phases,
    });
    if (state === null || findings.length > 0) {
        return { kind: "refuse", findings };
    }

    const [first] = resolved.phases;
    if (first === undefined) {
        return noChange({
            action: "done",
            selector: options.selector,
            phases: [],
        });
    }

    const next: State = {
        ...state,
        loop: {
            scope: options.selector,
            phases: resolved.phases,
            cycle: "implement",
            phase: first,
            conditions: state.loop?.conditions ?? [],
            stoppedReason: null,
        },
    };
    return writes(next, {
        action: "implement",
        selector: options.selector,
        phases: resolved.phases,
    });
}
