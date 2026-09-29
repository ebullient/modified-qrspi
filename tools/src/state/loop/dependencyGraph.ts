import { type PlanTable, rowIndexOf } from "../../workspace/PlanTable.ts";
import type { PhaseId } from "../types.ts";

/** Why the selected phases' dependencies cannot be resolved. */
export interface ScopeError {
    kind: "missing-dependency" | "cycle";
    message: string;
}

/** A resolved scope: the phases to run, dependencies first. */
export interface ResolvedScope {
    kind: "scope";
    phases: PhaseId[];
}

/**
 * The loop scope for the selected phases: every incomplete target plus
 * every incomplete phase it transitively depends on, dependencies first,
 * ties broken by plan row order. Complete phases are satisfied and left
 * out, but the walk continues through them. Missing rows and cycles
 * among the reachable phases are reported before any scope is built.
 */
export function resolveScope(
    targets: readonly PhaseId[],
    planTable: PlanTable,
    isComplete: (phase: PhaseId) => boolean,
): ResolvedScope | ScopeError {
    const dependsOn = new Map(
        planTable.rows.map((row) => [row.phase, row.dependsOn]),
    );

    const reachable = new Map<PhaseId, readonly PhaseId[]>();
    const error = walk(targets, dependsOn, reachable);
    if (error !== null) return error;

    const scope = [...reachable.keys()].filter((phase) => !isComplete(phase));
    return {
        kind: "scope",
        phases: dependencyOrder(scope, reachable, planTable),
    };
}

/**
 * Depth-first walk from the targets, recording each reachable phase's
 * transitive dependencies. Stops at the first missing row or cycle.
 */
function walk(
    targets: readonly PhaseId[],
    dependsOn: ReadonlyMap<PhaseId, readonly PhaseId[]>,
    reachable: Map<PhaseId, readonly PhaseId[]>,
): ScopeError | null {
    const path: PhaseId[] = [];

    const visit = (phase: PhaseId, from?: PhaseId): ScopeError | null => {
        if (reachable.has(phase)) return null;
        const cycleStart = path.indexOf(phase);
        if (cycleStart >= 0) {
            const cycle = [...path.slice(cycleStart), phase].join(" -> ");
            return {
                kind: "cycle",
                message: `Depends On forms a cycle: ${cycle}`,
            };
        }
        const deps = dependsOn.get(phase);
        if (deps === undefined) {
            return {
                kind: "missing-dependency",
                message:
                    from === undefined
                        ? `Phase ${phase} is not in plan.md`
                        : `Phase ${from} depends on ${phase}, which is not in plan.md`,
            };
        }

        path.push(phase);
        const transitive = new Set<PhaseId>();
        for (const dep of deps) {
            const error = visit(dep, phase);
            if (error !== null) return error;
            transitive.add(dep);
            for (const inherited of reachable.get(dep) ?? []) {
                transitive.add(inherited);
            }
        }
        path.pop();
        reachable.set(phase, [...transitive]);
        return null;
    };

    for (const target of targets) {
        const error = visit(target);
        if (error !== null) return error;
    }
    return null;
}

/** Repeatedly takes the earliest-row phase with no in-scope dependency left to place. */
function dependencyOrder(
    scope: readonly PhaseId[],
    reachable: ReadonlyMap<PhaseId, readonly PhaseId[]>,
    planTable: PlanTable,
): PhaseId[] {
    const remaining = [...scope].sort(
        (a, b) => rowIndexOf(planTable, a) - rowIndexOf(planTable, b),
    );
    const ordered: PhaseId[] = [];

    while (remaining.length > 0) {
        // The walk rejected cycles, so some phase is always ready.
        const index = remaining.findIndex((phase) =>
            (reachable.get(phase) ?? []).every(
                (dep) => !remaining.includes(dep),
            ),
        );
        ordered.push(...remaining.splice(index, 1));
    }
    return ordered;
}
