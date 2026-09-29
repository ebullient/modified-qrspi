import type { HistoryEntry, PhaseId } from "./types.ts";

/**
 * The next unused review label in each namespace. A label is used when
 * `reviews/<label>.md` exists or a history entry names it. Human labels
 * count up `-r2`, `-r3`, …; checkpoint labels count up `-chk1`, `-chk2`, ….
 * The namespaces never produce the same string, so one never reserves
 * another's label.
 */
export class ReviewLabels {
    private readonly used: ReadonlySet<string>;

    constructor(
        reviewFiles: readonly string[],
        history: readonly HistoryEntry[],
    ) {
        this.used = new Set([
            ...reviewFiles,
            ...history.flatMap((entry) =>
                entry.label !== undefined ? [entry.label] : [],
            ),
        ]);
    }

    /** Human phase review: `phase-N`, `phase-N-r2`, …. */
    phase(phase: PhaseId): string {
        return this.firstUnused(human(`phase-${phase}`));
    }

    /** Human mid-phase review after step `M`: `phase-N-step-M`, `phase-N-step-M-r2`, …. */
    step(phase: PhaseId, step: number): string {
        return this.firstUnused(human(`phase-${phase}-step-${step}`));
    }

    /** Human final review: `final`, `final-r2`, …. */
    final(): string {
        return this.firstUnused(human("final"));
    }

    /** Loop phase checkpoint: `phase-N-chk1`, `phase-N-chk2`, …. */
    checkpoint(phase: PhaseId): string {
        return this.firstUnused(checkpoint(`phase-${phase}`));
    }

    /** Loop mid-phase checkpoint after step `M`: `phase-N-step-M-chk1`, …. */
    stepCheckpoint(phase: PhaseId, step: number): string {
        return this.firstUnused(checkpoint(`phase-${phase}-step-${step}`));
    }

    private firstUnused(label: (n: number) => string): string {
        let n = 1;
        while (this.used.has(label(n))) n++;
        return label(n);
    }
}

function human(base: string): (n: number) => string {
    return (n) => (n === 1 ? base : `${base}-r${n}`);
}

function checkpoint(base: string): (n: number) => string {
    return (n) => `${base}-chk${n}`;
}
