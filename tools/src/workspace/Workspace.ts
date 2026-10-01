import { access, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isDecided } from "./ApproachDecision.ts";
import {
    isPhaseComplete as parsePhaseComplete,
    parseSteps,
} from "./PhaseFile.ts";
import {
    completed,
    type PhaseGraph,
    parsePlanTable,
    phaseGraphAt,
    type ResolvedScope,
    UnknownPhaseError,
} from "./PlanTable.ts";
import { isPending } from "./ReviewVerdict.ts";

export type Step =
    | "query"
    | "research"
    | "shape"
    | "spec"
    | "plan"
    | "implement"
    | "done";

export type PhaseSatisfaction = {
    dependenciesSatisfied: boolean;
    total: number;
    complete: number;
};

export type StaleInput = {
    phaseFile: string;
    specMtime: Date;
    phaseFileMtime: Date;
};

export type ActivePhase = {
    phase: string;
    planProgress: string;
    staleInput?: StaleInput;
};

export class NoActivePhaseError extends Error {
    constructor(public readonly blockedPhases: string[]) {
        super(
            `No active phase: every incomplete row is blocked on an unsatisfied dependency (${blockedPhases.join(", ")}).`,
        );
        this.name = "NoActivePhaseError";
    }
}

export type NextFileType =
    | "query"
    | "research"
    | "approach"
    | "spec"
    | "review"
    | "final";

export type NextFileOpts = {
    phase?: string;
    step?: number;
};

export type LastFileType = "review" | "final";

export type Workspace = {
    deriveStep: () => Promise<Step>;
    isPhaseComplete: (phaseId: string) => Promise<boolean>;
    checkProgress: (phaseId: string) => Promise<PhaseSatisfaction>;
    findActivePhase: () => Promise<ActivePhase>;
    nextLabel: (type: NextFileType, opts?: NextFileOpts) => Promise<string>;
    nextFile: (type: NextFileType, opts?: NextFileOpts) => Promise<string>;
    lastLabel: (
        type: LastFileType,
        opts?: NextFileOpts,
    ) => Promise<string | undefined>;
    pendingReviewLabel: (phaseId: string) => Promise<string | undefined>;
    lastFile: (
        type: LastFileType,
        opts?: NextFileOpts,
    ) => Promise<string | undefined>;
    resolveScope: (selector: string) => Promise<ResolvedScope>;
    isPhaseDone: (phaseId: string) => Promise<boolean>;
    reviewExists: (label: string) => Promise<boolean>;
};

export function phaseFilePath(phaseId: string): string {
    return `plans/plan-phase-${phaseId}.md`;
}

export function reviewPath(label: string): string {
    return `reviews/${label}.md`;
}

export function reviewStem(opts: NextFileOpts): string {
    if (opts.phase === undefined) {
        throw new Error("review labels require opts.phase.");
    }
    return opts.step !== undefined
        ? `phase-${opts.phase}-step-${opts.step}`
        : `phase-${opts.phase}`;
}

export function reReviewLabel(phaseId: string): string {
    return `${reviewStem({ phase: phaseId })}-r1`;
}

export function parseReviewLabel(label: string): {
    phaseId?: string;
    isReReview: boolean;
} {
    const phaseId = /^phase-([^-]+)(?:-|$)/.exec(label)?.[1];
    return { phaseId, isReReview: /-r\d+$/.test(label) };
}

export function backupPath(stem: string, n: number): string {
    return `backups/${stem}-${n}.md`;
}

export function workspaceAt(root: string): Workspace {
    // plan.md is read at most once per workspaceAt(root) — every call
    // that needs the table or its dependency graph shares this one parse
    // instead of re-reading the file per phase.
    let graph: Promise<PhaseGraph> | undefined;
    const readGraph = () => {
        if (!graph) {
            graph = readFile(join(root, "plan.md"), "utf8")
                .then(parsePlanTable)
                .then(phaseGraphAt);
        }
        return graph;
    };

    /**
     * A tree walk, latest-to-earliest: presence is checked first at each
     * node, content is opened only once something is found and its
     * meaning is still ambiguous. Only ever called once the caller has
     * already confirmed the feature isn't parked (history's job, not
     * this walk's).
     */
    async function deriveStep(): Promise<Step> {
        if (await exists(join(root, "plan.md"))) {
            const { rows } = await readGraph();
            const allDone = rows.every(completed);
            return allDone ? "done" : "implement";
        }
        if (await exists(join(root, "spec.md"))) {
            return "plan";
        }
        if (await exists(join(root, "approach.md"))) {
            const text = await readFile(join(root, "approach.md"), "utf8");
            return isDecided(text) ? "spec" : "shape";
        }
        if (await exists(join(root, "research.md"))) {
            return "research";
        }
        if (await exists(join(root, "queries.md"))) {
            return "research";
        }
        return "query";
    }

    async function isPhaseComplete(phaseId: string): Promise<boolean> {
        try {
            const text = await readFile(
                join(root, phaseFilePath(phaseId)),
                "utf8",
            );
            return parsePhaseComplete(text);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                return false;
            }
            throw err;
        }
    }

    /**
     * Reads `phaseId`'s own step markers for `{total, complete}`
     */
    async function checkProgress(phaseId: string): Promise<PhaseSatisfaction> {
        const { isSatisfied } = await readGraph();

        const phaseText = await readFile(
            join(root, phaseFilePath(phaseId)),
            "utf8",
        );
        const markers = parseSteps(phaseText);

        return {
            dependenciesSatisfied: isSatisfied(phaseId),
            total: markers.length,
            complete: markers.filter((marker) => marker === "[x]").length,
        };
    }

    /**
     * Walks the plan table in row order; the active phase is the first
     * row whose own Status isn't `[x]` and whose `dependenciesSatisfied`
     * comes back `true`. A row blocked on an unsatisfied dependency is
     * skipped, not active, and the walk continues to the next row.
     * Throws if no row qualifies — `deriveStep()` having answered
     * `implement` implies something should be active.
     */
    async function findActivePhase(): Promise<ActivePhase> {
        const { rows, isSatisfied } = await readGraph();
        const blockedPhases: string[] = [];

        for (const row of rows) {
            if (completed(row)) {
                continue;
            }
            if (!isSatisfied(row.phase)) {
                blockedPhases.push(row.phase);
                continue;
            }

            const satisfaction = await checkProgress(row.phase);
            const phaseFile = phaseFilePath(row.phase);
            const phaseFileMtime = (await stat(join(root, phaseFile))).mtime;

            let staleInput: StaleInput | undefined;
            if (await exists(join(root, "spec.md"))) {
                const specMtime = (await stat(join(root, "spec.md"))).mtime;
                if (phaseFileMtime < specMtime) {
                    staleInput = { phaseFile, specMtime, phaseFileMtime };
                }
            }

            return {
                phase: row.phase,
                planProgress: `${satisfaction.complete}/${satisfaction.total} steps`,
                staleInput,
            };
        }

        throw new NoActivePhaseError(blockedPhases);
    }

    /**
     * Scans the relevant directory and returns the next unused bare
     * label/stem — no directory, no extension. Query/Research/Approach/
     * Spec scan backups/ for `<stem>-<n>.md`; Review scans reviews/ for
     * the bare stem (`phase-<id>`, or `phase-<id>-step-<k>` with `step`)
     * then its own `-r<n>` sequence; Final scans reviews/ for
     * `final`/`final-r<n>`.
     */
    async function nextLabel(
        type: NextFileType,
        opts: NextFileOpts = {},
    ): Promise<string> {
        if (type === "review") {
            if (opts.phase === undefined) {
                throw new Error("nextLabel('review') requires opts.phase.");
            }
            const stem = reviewStem(opts);
            return nextInSequence(
                join(root, "reviews"),
                stem,
                (n) => `${stem}-r${n}`,
            );
        }
        if (type === "final") {
            return nextInSequence(
                join(root, "reviews"),
                "final",
                (n) => `final-r${n}`,
            );
        }
        return nextNumbered(join(root, "backups"), (n) => `${type}-${n}`);
    }

    async function nextFile(
        type: NextFileType,
        opts?: NextFileOpts,
    ): Promise<string> {
        const label = await nextLabel(type, opts);
        return type === "review" || type === "final"
            ? reviewPath(label)
            : `backups/${label}.md`;
    }

    /**
     * nextLabel's mirror: the most recently used label in the same
     * review/final sequence, or undefined if none exists yet. Only
     * review/final are bounded append sequences where "last" means
     * anything — the backup stems (query/research/approach/spec) have no
     * caller that needs this.
     */
    async function lastLabel(
        type: LastFileType,
        opts: NextFileOpts = {},
    ): Promise<string | undefined> {
        if (type === "review") {
            if (opts.phase === undefined) {
                throw new Error("lastLabel('review') requires opts.phase.");
            }
            const stem = reviewStem(opts);
            return lastInSequence(
                join(root, "reviews"),
                stem,
                (n) => `${stem}-r${n}`,
            );
        }
        return lastInSequence(
            join(root, "reviews"),
            "final",
            (n) => `final-r${n}`,
        );
    }

    async function lastFile(
        type: LastFileType,
        opts?: NextFileOpts,
    ): Promise<string | undefined> {
        const label = await lastLabel(type, opts);
        return label === undefined ? undefined : reviewPath(label);
    }

    async function pendingReviewLabel(
        phaseId: string,
    ): Promise<string | undefined> {
        const label = await lastLabel("review", { phase: phaseId });
        if (label === undefined) {
            return undefined;
        }

        const text = await readFile(join(root, reviewPath(label)), "utf8");
        return isPending(text) ? label : undefined;
    }

    /**
     * Resolves a raw `loop --start` selector (`all` | phase id | range
     * `2..4` | list `1,3`) into the selected traversal scope and the full
     * dependency-inclusive, topologically-ordered execution list.
     */
    async function resolveScope(selector: string): Promise<ResolvedScope> {
        const { resolveScope: resolve } = await readGraph();
        return resolve(selector);
    }

    /**
     * Is phaseId's own plan.md row marked [x]? Distinct from
     * checkProgress()'s {total,complete}, which reads the phase FILE's
     * step markers — this reads the table row a human marks done, the
     * fact `loop --advance` is gated on.
     */
    async function isPhaseDone(phaseId: string): Promise<boolean> {
        const { rows } = await readGraph();
        const row = rows.find((r) => r.phase === phaseId);
        if (!row) {
            throw new UnknownPhaseError(phaseId);
        }
        return completed(row);
    }

    /**
     * Does reviews/<label>.md exist, PENDING stub or real verdict alike?
     * `autoloop` writes the PENDING stub before a reviewer agent ever
     * runs (skills/autoloop/SKILL.md), so this answers "has a review been
     * launched for this label," not "has it finished."
     */
    async function reviewExists(label: string): Promise<boolean> {
        return exists(join(root, reviewPath(label)));
    }

    return {
        deriveStep,
        isPhaseComplete,
        checkProgress,
        findActivePhase,
        nextLabel,
        nextFile,
        lastLabel,
        lastFile,
        pendingReviewLabel,
        resolveScope,
        isPhaseDone,
        reviewExists,
    };
}

async function usedStems(dir: string): Promise<Set<string>> {
    let names: string[];
    try {
        names = await readdir(dir);
    } catch {
        names = [];
    }
    return new Set(names.map((name) => name.replace(/\.md$/, "")));
}

/**
 * `bareLabel` tried unused first, then `-r1`, `-r2`, ... (review/final).
 * A missing directory is treated as empty — bareLabel is unused by
 * definition.
 */
async function nextInSequence(
    dir: string,
    bareLabel: string,
    nth: (n: number) => string,
): Promise<string> {
    const used = await usedStems(dir);
    if (!used.has(bareLabel)) {
        return bareLabel;
    }
    for (let n = 1; ; n++) {
        const candidate = nth(n);
        if (!used.has(candidate)) {
            return candidate;
        }
    }
}

/**
 * `nextInSequence`'s mirror: walks the same bareLabel, `-r1`, `-r2`, ...
 * sequence and returns the last one actually used, or undefined if
 * bareLabel itself is unused (nothing in the sequence exists yet).
 */
async function lastInSequence(
    dir: string,
    bareLabel: string,
    nth: (n: number) => string,
): Promise<string | undefined> {
    const used = await usedStems(dir);
    if (!used.has(bareLabel)) {
        return undefined;
    }
    let last = bareLabel;
    for (let n = 1; ; n++) {
        const candidate = nth(n);
        if (!used.has(candidate)) {
            return last;
        }
        last = candidate;
    }
}

/**
 * `<stem>-1`, `<stem>-2`, ... (the backup stems — never a bare,
 * un-suffixed name).
 */
async function nextNumbered(
    dir: string,
    nth: (n: number) => string,
): Promise<string> {
    const used = await usedStems(dir);
    for (let n = 1; ; n++) {
        const candidate = nth(n);
        if (!used.has(candidate)) {
            return candidate;
        }
    }
}

async function exists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}
