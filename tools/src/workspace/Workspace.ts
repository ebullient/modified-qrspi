import { humanRoundSource, phaseIdSource } from "../state/ids.ts";
import type { WorkspaceFileSystem } from "../state/ports.ts";
import type { PhaseId, Verdict } from "../state/types.ts";
import { parseDecision } from "./Decision.ts";
import {
    allStepsDone,
    hasBegunStep,
    lastDoneStep,
    type PhaseFile,
    parsePhaseFile,
} from "./PhaseFile.ts";
import { type PlanTable, parsePlanTable } from "./PlanTable.ts";
import {
    parseQuestionSection,
    type QuestionSection,
} from "./QuestionSection.ts";
import {
    parseReviewArtifact,
    parseVerdict,
    type ReviewArtifact,
} from "./ReviewArtifact.ts";

const phaseFilePattern = new RegExp(`^plan-phase-(${phaseIdSource})\\.md$`);
const reviewFilePattern = /^(.+)\.md$/;
const roundPatterns = {
    human: new RegExp(`^${humanRoundSource}$`),
    checkpoint: /^-chk([1-9][0-9]*)$/,
};

/** Workspace-relative path of the review artifact for `label`. */
export function reviewPath(label: string): string {
    return `reviews/${label}.md`;
}

/** Workspace-relative path of the phase file for `id` in the `plans/` layout. */
export function phaseFilePath(id: string): string {
    return `plans/plan-phase-${id}.md`;
}

/** A thunk that runs `compute` once and returns the same value thereafter. */
function memo<T>(compute: () => T): () => T {
    let cached: { value: T } | undefined;
    return () => {
        cached ??= { value: compute() };
        return cached.value;
    };
}

/** A lookup that runs `compute(key)` once per key and returns the same value thereafter. */
function memoByKey<K, T>(compute: (key: K) => T): (key: K) => T {
    const cache = new Map<K, T>();
    return (key) => {
        if (!cache.has(key)) cache.set(key, compute(key));
        return cache.get(key) as T;
    };
}

/** Read-only, memoized access to a feature's workspace artifacts. */
export class Workspace {
    private readonly root: string;
    private readonly fs: WorkspaceFileSystem;

    private readonly planMemo = memo(() => {
        const markdown = this.fs.read(this.path("plan.md"));
        return markdown === null ? null : parsePlanTable(markdown, "plan.md");
    });
    private readonly phaseFileMemo = memoByKey((phaseId: string) => {
        const name = `plan-phase-${phaseId}.md`;
        let file = phaseFilePath(phaseId);
        let markdown = this.fs.read(this.path(file));
        if (markdown === null) {
            file = name;
            markdown = this.fs.read(this.path(file));
        }
        return markdown === null ? null : parsePhaseFile(markdown, file);
    });
    private readonly phaseFileIdsMemo = memo((): readonly string[] => {
        const ids = [
            ...this.phaseIdsIn(this.path("plans")),
            ...this.phaseIdsIn(this.root),
        ];
        return [...new Set(ids)];
    });
    private readonly openQuestionsMemo = memo(() =>
        this.questionSection("request.md", "Open Questions"),
    );
    private readonly newQuestionsMemo = memo(() =>
        this.questionSection("research.md", "New Questions"),
    );
    private readonly reviewMarkdownMemo = memoByKey((label: string) =>
        this.fs.read(this.path(reviewPath(label))),
    );
    private readonly reviewMemo = memoByKey((label: string) => {
        const markdown = this.reviewMarkdownMemo(label);
        return markdown === null ? null : parseReviewArtifact(markdown);
    });
    private readonly verdictMemo = memoByKey((label: string) => {
        const markdown = this.reviewMarkdownMemo(label);
        return markdown === null ? null : parseVerdict(markdown);
    });
    private readonly reviewLabelsMemo = memo((): readonly string[] =>
        this.fs
            .list(this.path("reviews"))
            .map((name) => reviewFilePattern.exec(name)?.[1])
            .filter((label): label is string => label !== undefined),
    );
    private readonly decidedMemo = memo(() => {
        const markdown = this.fs.read(this.path("approach.md"));
        return markdown === null ? false : parseDecision(markdown);
    });

    constructor(root: string, fs: WorkspaceFileSystem) {
        this.root = root;
        this.fs = fs;
    }

    plan(): PlanTable | null {
        return this.planMemo();
    }

    /**
     * The phase file for `phaseId`, from `plans/` when present and the
     * workspace root otherwise, so workspaces written before plans moved
     * still resolve. The reported name is the location it was found in.
     */
    phaseFile(phaseId: string): PhaseFile | null {
        return this.phaseFileMemo(phaseId);
    }

    /** Whether any step in the phase file is not `[ ]`. */
    phaseBegun(phaseId: string): boolean {
        const file = this.phaseFile(phaseId);
        return file !== null && hasBegunStep(file);
    }

    /** Whether the phase file is well-formed, has steps, and every step is `[x]`. */
    phaseComplete(phaseId: string): boolean {
        const file = this.phaseFile(phaseId);
        if (file === null || file.findings.length > 0) return false;
        return allStepsDone(file);
    }

    /** The first incomplete phase, in table order, whose dependencies are complete. */
    firstReadyPhase(exclude: readonly PhaseId[] = []): PhaseId | null {
        const rows = this.plan()?.rows ?? [];
        return (
            rows.find(
                (row) =>
                    !exclude.includes(row.phase) &&
                    !this.phaseComplete(row.phase) &&
                    row.dependsOn.every((dep) => this.phaseComplete(dep)),
            )?.phase ?? null
        );
    }

    /** Every `plan-phase-<id>.md` file present in the workspace, keyed by phase id. */
    phaseFiles(): ReadonlyMap<string, PhaseFile> {
        const result = new Map<string, PhaseFile>();
        for (const phaseId of this.phaseFileIdsMemo()) {
            const file = this.phaseFile(phaseId);
            if (file !== null) result.set(phaseId, file);
        }
        return result;
    }

    openQuestions(): QuestionSection {
        return this.openQuestionsMemo();
    }

    newQuestions(): QuestionSection {
        return this.newQuestionsMemo();
    }

    review(label: string): ReviewArtifact | null {
        return this.reviewMemo(label);
    }

    /** The verdict line of `reviews/<label>.md`; nothing else in the file is parsed. */
    verdict(label: string): Verdict | null {
        return this.verdictMemo(label);
    }

    /**
     * The newest round of `base` among review files: human rounds are
     * `<base>`, `<base>-r2`, …; checkpoint rounds `<base>-chk1`, `<base>-chk2`, ….
     */
    newestReview(
        base: string,
        kind: "human" | "checkpoint" = "human",
    ): string | null {
        let newest: { label: string; round: number } | null = null;
        for (const label of this.reviewLabels()) {
            const round =
                kind === "human" && label === base
                    ? 1
                    : label.startsWith(base)
                      ? Number(
                            roundPatterns[kind].exec(
                                label.slice(base.length),
                            )?.[1] ?? 0,
                        )
                      : 0;
            if (round > 0 && (newest === null || round > newest.round)) {
                newest = { label, round };
            }
        }
        return newest?.label ?? null;
    }

    /**
     * The review the markers call for now, newest round: `final` when every
     * phase is complete (else that phase's own review), the phase's review
     * when it is complete, or a mid-phase review at its last `[x]` step.
     */
    latestReview(phase: PhaseId | null): string | null {
        const rows = this.plan()?.rows ?? [];
        const bases: string[] = [];
        if (
            rows.length > 0 &&
            rows.every((row) => this.phaseComplete(row.phase))
        ) {
            bases.push("final");
        }
        if (phase !== null && this.phaseComplete(phase)) {
            bases.push(`phase-${phase}`);
        } else if (phase !== null) {
            const phaseFile = this.phaseFile(phase);
            const lastDone =
                phaseFile === null ? undefined : lastDoneStep(phaseFile);
            if (lastDone !== undefined) {
                bases.push(`phase-${phase}-step-${lastDone.step}`);
            }
        }
        for (const base of bases) {
            const label = this.newestReview(base);
            if (label !== null) return label;
        }
        return null;
    }

    /** Every `reviews/<label>.md` file present in the workspace, by label. */
    reviewLabels(): readonly string[] {
        return this.reviewLabelsMemo();
    }

    /**
     * The `plan-phase-*.md` files sitting in the workspace root rather than
     * `plans/`, sorted by name. They resolve either way; this is what lets
     * `report` say so instead of tolerating the layout silently.
     */
    legacyPhaseFileNames(): readonly string[] {
        return this.fs
            .list(this.root)
            .filter((name) => phaseFilePattern.test(name))
            .toSorted();
    }

    /**
     * Whether `plans` exists but is not a directory, so nothing can be read
     * from it. Phase files still resolve from the root, so this is worth
     * reporting rather than failing on.
     */
    plansBlocked(): boolean {
        return this.fs.read(this.path("plans")) !== null;
    }

    hasFile(name: string): boolean {
        return this.fs.read(this.path(name)) !== null;
    }

    /** Whether `approach.md` has a filled-in decision section. */
    decided(): boolean {
        return this.decidedMemo();
    }

    /** Phase ids named by the `plan-phase-<id>.md` files directly in `directory`. */
    private phaseIdsIn(directory: string): string[] {
        return this.fs
            .list(directory)
            .map((name) => phaseFilePattern.exec(name)?.[1])
            .filter((id): id is string => id !== undefined);
    }

    private questionSection(file: string, heading: string): QuestionSection {
        const markdown = this.fs.read(this.path(file));
        return markdown === null
            ? { open: [], resolved: [] }
            : parseQuestionSection(markdown, heading);
    }

    private path(name: string): string {
        return `${this.root}/${name}`;
    }
}
