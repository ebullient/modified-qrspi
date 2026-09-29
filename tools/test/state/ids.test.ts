import { describe, expect, it } from "vitest";
import {
    isFinalLabel,
    isHumanRoundSuffix,
    isKebab,
    isPhaseId,
    isPhaseReviewLabel,
    phaseOfLabel,
} from "../../src/state/ids.ts";
import type { PhaseId } from "../../src/state/types.ts";

describe("isPhaseId", () => {
    it.each([
        ["1", true],
        ["12", true],
        ["2b", true],
        ["10a", true],
        ["0", false],
        ["01", false],
        ["", false],
        ["2bb", false],
        ["2B", false],
        ["a", false],
        ["2 ", false],
        [" 2", false],
        ["2\n", false],
    ])("%j -> %s", (value, expected) => {
        expect(isPhaseId(value)).toBe(expected);
    });
});

describe("isKebab", () => {
    it.each([
        ["a", true],
        ["code-review", true],
        ["a1-b2", true],
        ["", false],
        ["-a", false],
        ["a-", false],
        ["a--b", false],
        ["A", false],
        ["a_b", false],
    ])("%j -> %s", (value, expected) => {
        expect(isKebab(value)).toBe(expected);
    });
});

describe("isHumanRoundSuffix", () => {
    it.each([
        ["-r2", true],
        ["-r9", true],
        ["-r10", true],
        ["-r25", true],
        ["-r0", false],
        ["-r1", false],
        ["-r01", false],
        ["-r", false],
        ["r2", false],
        ["-r2x", false],
    ])("%j -> %s", (value, expected) => {
        expect(isHumanRoundSuffix(value)).toBe(expected);
    });
});

describe("phaseOfLabel", () => {
    it.each([
        ["phase-2", "2"],
        ["phase-2b", "2b"],
        ["phase-12-r2", "12"],
        ["phase-2-step-3", "2"],
        ["phase-2-chk1", "2"],
        ["phase-0", undefined],
        ["phase-2x", "2x"],
        ["phase-2xy", undefined],
        ["phase-", undefined],
        ["final", undefined],
        ["xphase-2", undefined],
    ])("%j -> %s", (label, expected) => {
        expect(phaseOfLabel(label)).toBe(expected);
    });
});

describe("isFinalLabel", () => {
    it.each([
        ["final", true],
        ["final-r2", true],
        ["final-r10", true],
        ["final-r1", false],
        ["finally", false],
        ["final-chk1", false],
        ["phase-2", false],
    ])("%j -> %s", (label, expected) => {
        expect(isFinalLabel(label)).toBe(expected);
    });
});

describe("isPhaseReviewLabel", () => {
    it.each([
        ["phase-2", "2", true],
        ["phase-2-r2", "2", true],
        ["phase-2-r1", "2", false],
        ["phase-12", "1", false],
        ["phase-2b", "2", false],
        ["phase-2-step-1", "2", false],
        ["phase-2-chk1", "2", false],
        ["phase-3", "2", false],
    ])("%j for phase %s -> %s", (label, phase, expected) => {
        expect(isPhaseReviewLabel(label, phase as PhaseId)).toBe(expected);
    });
});
