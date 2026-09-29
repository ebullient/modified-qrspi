import type { PhaseId } from "./types.ts";

/** Source text of the phase-id grammar (`3`, `12`, `2b`), for embedding in larger patterns. */
export const phaseIdSource = "[1-9][0-9]*[a-z]?";

/** Source text of the kebab-case grammar, for embedding in larger patterns and messages. */
export const kebabSource = "[a-z0-9]+(?:-[a-z0-9]+)*";

/** Source text of the human review round suffix: `-r2`, `-r3`, … `-r10`; never `-r0`, `-r1`, `-r01`. Capture group 1 is the round number. */
export const humanRoundSource = "-r([2-9]|[1-9][0-9]+)";

const phaseIdPattern = new RegExp(`^${phaseIdSource}$`);
const kebabPattern = new RegExp(`^${kebabSource}$`);
const humanRoundPattern = new RegExp(`^${humanRoundSource}$`);
const labelPhasePattern = new RegExp(`^phase-(${phaseIdSource})(?:-|$)`);
const finalLabelPattern = new RegExp(`^final(?:${humanRoundSource})?$`);

/** True when the whole string is a phase id. */
export function isPhaseId(value: string): value is PhaseId {
    return phaseIdPattern.test(value);
}

/** True when the whole string is non-empty kebab-case. */
export function isKebab(value: string): boolean {
    return kebabPattern.test(value);
}

/** True when the whole string is a human review round suffix such as `-r2`. */
export function isHumanRoundSuffix(value: string): boolean {
    return humanRoundPattern.test(value);
}

/** True for a final review label: `final`, `final-r2`, … */
export function isFinalLabel(label: string): boolean {
    return finalLabelPattern.test(label);
}

/** True for a whole-phase human review label of `phase`: `phase-<id>`, `phase-<id>-r2`, … */
export function isPhaseReviewLabel(label: string, phase: PhaseId): boolean {
    const prefix = `phase-${phase}`;
    if (!label.startsWith(prefix)) return false;
    const rest = label.slice(prefix.length);
    return rest === "" || isHumanRoundSuffix(rest);
}

/** The phase a `phase-<id>…` review label names, or undefined when it names none. */
export function phaseOfLabel(label: string): PhaseId | undefined {
    return labelPhasePattern.exec(label)?.[1] as PhaseId | undefined;
}
