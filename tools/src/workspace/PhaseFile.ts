import type { Finding } from "../state/types.ts";

/** Source text of the marker character class, shared by phase files and the plan table. */
export const markerClassSource = "[ ~x!]";

export type StepMarker = " " | "~" | "x" | "!";

export interface PhaseStep {
    step: number;
    title: string;
    marker: StepMarker;
}

export interface PhaseFile {
    steps: PhaseStep[];
    findings: Finding[];
    /**
     * Where this phase file was read from, relative to the workspace root:
     * `plans/plan-phase-<id>.md`, or the bare name for a legacy root layout.
     * Findings that name a plan file use this, so the path they print is the
     * one that exists.
     */
    file: string;
}

const stepHeadingPattern = /^### Step (\d+): (.+)$/;
const markerLinePattern = new RegExp(
    `^- \\[(${markerClassSource})\\] Status marker$`,
);

export function parsePhaseFile(markdown: string, file: string): PhaseFile {
    const lines = markdown.split(/\r?\n/);
    const steps: PhaseStep[] = [];
    const findings: Finding[] = [];
    const seenSteps = new Set<number>();

    for (let i = 0; i < lines.length; i++) {
        const heading = stepHeadingPattern.exec(lines[i] ?? "");
        if (!heading) continue;

        const step = Number(heading[1]);
        const title = heading[2] ?? "";
        const markerLine = lines[i + 1];
        const marker = markerLinePattern.exec(markerLine ?? "")?.[1] as
            | StepMarker
            | undefined;

        if (!marker) {
            findings.push({
                code: "format-invalid",
                message: `Step ${step} heading is not followed by a status marker line`,
                file,
                line: i + 2,
            });
            continue;
        }

        if (seenSteps.has(step)) {
            findings.push({
                code: "format-invalid",
                message: `Step ${step} is declared more than once`,
                file,
                line: i + 1,
            });
            i++;
            continue;
        }
        seenSteps.add(step);

        steps.push({ step, title, marker });
        i++;
    }

    return { steps, findings, file };
}

/** The steps marked `[~]`, in file order. */
export function inProgressSteps(file: PhaseFile): PhaseStep[] {
    return file.steps.filter((step) => step.marker === "~");
}

/** The steps marked `[!]`, in file order. */
export function blockedSteps(file: PhaseFile): PhaseStep[] {
    return file.steps.filter((step) => step.marker === "!");
}

/** The steps marked `[x]`, in file order. */
export function doneSteps(file: PhaseFile): PhaseStep[] {
    return file.steps.filter((step) => step.marker === "x");
}

/** The last step marked `[x]`, or undefined when none is. */
export function lastDoneStep(file: PhaseFile): PhaseStep | undefined {
    return doneSteps(file).at(-1);
}

/** The first step not marked `[x]`, or undefined when every step is. */
export function firstUnfinishedStep(file: PhaseFile): PhaseStep | undefined {
    return file.steps.find((step) => step.marker !== "x");
}

/** Whether any step is not `[ ]`. */
export function hasBegunStep(file: PhaseFile): boolean {
    return file.steps.some((step) => step.marker !== " ");
}

/** Whether the file has steps and every one is `[x]`. */
export function allStepsDone(file: PhaseFile): boolean {
    return file.steps.length > 0 && file.steps.every((s) => s.marker === "x");
}
