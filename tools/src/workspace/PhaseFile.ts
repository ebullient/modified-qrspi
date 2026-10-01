export type StepMarker = "[ ]" | "[~]" | "[x]" | "[!]";

const STEP_MARKER_PATTERN = /^### Step \d+.*\n- (\[[ ~x!]\])/gm;

/**
 * Parses a phase file's `### Step K` markers, in file order.
 */
export function parseSteps(text: string): StepMarker[] {
    const markers: StepMarker[] = [];
    for (const match of text.matchAll(STEP_MARKER_PATTERN)) {
        markers.push(match[1] as StepMarker);
    }
    return markers;
}

/**
 * True only when every step marker is `[x]`. A phase file with no steps
 * is not done — an empty/malformed file should never read as complete.
 */
export function isPhaseComplete(text: string): boolean {
    const markers = parseSteps(text);
    return markers.length > 0 && markers.every((marker) => marker === "[x]");
}
