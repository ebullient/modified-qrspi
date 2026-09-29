import { type PlanTable, rowIndexOf } from "../../workspace/PlanTable.ts";
import { isPhaseId } from "../ids.ts";
import type { PhaseId } from "../types.ts";

/**
 * Why a selector could not be resolved. `syntax` is wrong on its face;
 * `missing` names a phase `plan.md` lacks; `plan` is a range `plan.md`'s
 * row order cannot satisfy.
 */
export interface SelectorError {
    kind: "syntax" | "missing" | "plan";
    message: string;
}

/** The phases a selector names, in plan row order. */
export interface SelectedPhases {
    kind: "phases";
    phases: PhaseId[];
}

/**
 * Resolves a `loop --start` selector to the phases it names, in plan row
 * order without duplicates. A range covers every row from its first
 * endpoint's row to its second's, so inserted phases between them are
 * included.
 */
export function parseSelector(
    raw: string,
    planTable: PlanTable,
): SelectedPhases | SelectorError {
    if (raw === "") return syntax("The selector is empty");
    if (/\s/.test(raw)) {
        return syntax(`Selector "${raw}" must not contain whitespace`);
    }

    const rows = planTable.rows;
    if (raw === "all") {
        return { kind: "phases", phases: rows.map((row) => row.phase) };
    }

    const tokens = raw.split(",");
    const seen = new Set<string>();
    for (const token of tokens) {
        if (token === "all") {
            return syntax(`"all" cannot be combined with other phases`);
        }
        if (!isPhaseToken(token)) {
            return syntax(`"${token}" is not a phase id or range`);
        }
        if (seen.has(token)) {
            return syntax(`"${token}" appears more than once`);
        }
        seen.add(token);
    }

    const selected = new Set<number>();
    for (const token of tokens) {
        const [first, last = first] = token.split("..") as [string, string?];
        const start = rowIndexOf(planTable, first as PhaseId);
        const end = rowIndexOf(planTable, last as PhaseId);
        for (const [id, index] of [
            [first, start],
            [last, end],
        ] as const) {
            if (index < 0) {
                return {
                    kind: "missing",
                    message: `Phase ${id} in "${token}" is not in plan.md`,
                };
            }
        }
        if (end < start) {
            return plan(
                `Range "${token}" is reversed: ${last} comes before ${first} in plan.md`,
            );
        }
        for (let i = start; i <= end; i++) selected.add(i);
    }

    return {
        kind: "phases",
        phases: rows
            .filter((_, index) => selected.has(index))
            .map((row) => row.phase),
    };
}

function isPhaseToken(token: string): boolean {
    const ids = token.split("..");
    return ids.length <= 2 && ids.every((id) => isPhaseId(id));
}

function syntax(message: string): SelectorError {
    return { kind: "syntax", message };
}

function plan(message: string): SelectorError {
    return { kind: "plan", message };
}
