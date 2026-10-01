export type StatusMarker = "[ ]" | "[~]" | "[x]" | "[!]";

export type PlanRow = {
    phase: string;
    name: string;
    dependsOn: string[];
    status: StatusMarker;
};

const STATUS_MARKERS = new Set(["[ ]", "[~]", "[x]", "[!]"]);

/**
 * Parses plan.md's phase table: | Phase | Name | Depends On |
 * Description | Steps | Status |. Ignores the header row, the separator
 * row, and anything outside the table.
 */
export function parsePlanTable(text: string): PlanRow[] {
    const rows: PlanRow[] = [];

    for (const line of text.split("\n")) {
        if (!line.trim().startsWith("|")) {
            continue;
        }

        const cells = line
            .split("|")
            .slice(1, -1)
            .map((cell) => cell.trim());
        if (cells.length < 6) {
            continue;
        }

        const [phase, name, dependsOn, , , status] = cells;
        if (phase === "Phase" || /^-+$/.test(phase)) {
            continue;
        }
        if (!STATUS_MARKERS.has(status)) {
            continue;
        }

        rows.push({
            phase,
            name,
            dependsOn: parseDependsOn(dependsOn),
            status: status as StatusMarker,
        });
    }

    return rows;
}

export type PhaseSatisfaction = {
    dependenciesSatisfied: boolean;
    total: number;
    complete: number;
};

export type ResolvedScope = {
    scope: string[];
    phaseIds: string[];
};

export type PhaseGraph = {
    rows: PlanRow[];
    isSatisfied(phaseId: string): boolean;
    resolveScope(selector: string): ResolvedScope;
};

export class DependencyCycleError extends Error {
    constructor(public readonly cycle: string[]) {
        super(`Dependency cycle in plan.md: ${cycle.join(" -> ")}`);
        this.name = "DependencyCycleError";
    }
}

export class UnknownPhaseError extends Error {
    constructor(public readonly phaseId: string) {
        super(`Unknown phase id: ${phaseId}`);
        this.name = "UnknownPhaseError";
    }
}

/**
 * The phase dependency graph: Depends On, not row order, decides what's
 * satisfied and what a scope selector expands to.
 */
export function phaseGraphAt(rows: PlanRow[]): PhaseGraph {
    const byId = new Map(rows.map((row) => [row.phase, row]));

    // Is phaseId [x], and are all its dependencies [x] too, recursively?
    function isDone(phaseId: string, seen: Set<string>): boolean {
        if (seen.has(phaseId)) {
            throw new DependencyCycleError([...seen, phaseId]);
        }
        const row = byId.get(phaseId);
        if (!row) {
            throw new UnknownPhaseError(phaseId);
        }
        if (incomplete(row)) {
            return false;
        }
        const nextSeen = new Set(seen).add(phaseId);
        return row.dependsOn.every((id) => isDone(id, nextSeen));
    }

    function isSatisfied(phaseId: string): boolean {
        const row = byId.get(phaseId);
        if (!row) {
            throw new UnknownPhaseError(phaseId);
        }
        return row.dependsOn.every((id) => isDone(id, new Set([phaseId])));
    }

    // Visits phaseId's full Depends On closure, dependencies before
    // dependents (topological order), always recursing regardless of a
    // dependency's own completeness — otherwise a complete phase could
    // hide an incomplete or cyclic one behind it. Appends each not-yet-
    // [x] phase to `out`; `visited` is shared across calls so a
    // dependency common to several requested phases is walked once.
    function visitDependencies(
        phaseId: string,
        seen: Set<string>,
        out: string[],
        visited: Set<string>,
    ) {
        if (seen.has(phaseId)) {
            throw new DependencyCycleError([...seen, phaseId]);
        }
        if (visited.has(phaseId)) {
            return;
        }
        const row = byId.get(phaseId);
        if (!row) {
            throw new UnknownPhaseError(phaseId);
        }

        const nextSeen = new Set(seen).add(phaseId);
        for (const depId of row.dependsOn) {
            visitDependencies(depId, nextSeen, out, visited);
        }
        visited.add(phaseId);
        if (incomplete(row)) {
            out.push(phaseId);
        }
    }

    function resolveScope(selector: string): ResolvedScope {
        const scope = parseSelector(selector, rows);

        const out: string[] = [];
        const visited = new Set<string>();
        for (const phaseId of scope) {
            visitDependencies(phaseId, new Set(), out, visited);
        }
        return { scope, phaseIds: out };
    }

    return { rows, isSatisfied: (id) => isSatisfied(id), resolveScope };
}

function parseSelector(selector: string, rows: PlanRow[]): string[] {
    if (selector === "all") {
        return rows.map((row) => row.phase);
    }
    if (selector.includes("..")) {
        const [from, to] = selector.split("..");
        const fromIndex = rows.findIndex((row) => row.phase === from);
        const toIndex = rows.findIndex((row) => row.phase === to);
        if (fromIndex === -1) {
            throw new UnknownPhaseError(from);
        }
        if (toIndex === -1) {
            throw new UnknownPhaseError(to);
        }
        if (toIndex < fromIndex) {
            throw new Error(
                `Invalid range "${selector}": "${to}" comes before "${from}" in plan.md.`,
            );
        }
        return rows.slice(fromIndex, toIndex + 1).map((row) => row.phase);
    }
    if (selector.includes(",")) {
        return selector.split(",").map((id) => id.trim());
    }
    return [selector];
}

// Empty and the literal "none" (any case) both mean no dependencies.
function parseDependsOn(cell: string): string[] {
    if (cell === "" || cell.toLowerCase() === "none") {
        return [];
    }
    return cell
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
}

export function completed(row: PlanRow): boolean {
    return row.status === "[x]";
}

function incomplete(row: PlanRow): boolean {
    return !completed(row);
}
