import { describe, expect, it } from "vitest";
import { ReviewLabels } from "../../src/state/ReviewLabels.ts";
import type { HistoryEntry, PhaseId } from "../../src/state/types.ts";

const p = (id: string) => id as PhaseId;

function entry(step: HistoryEntry["step"], label: string): HistoryEntry {
    return { step, timestamp: "2026-01-01T00:00:00Z", label };
}

describe("ReviewLabels", () => {
    it("starts each namespace at its first label", () => {
        const labels = new ReviewLabels([], []);
        expect(labels.phase(p("2"))).toBe("phase-2");
        expect(labels.step(p("2"), 3)).toBe("phase-2-step-3");
        expect(labels.final()).toBe("final");
        expect(labels.checkpoint(p("2"))).toBe("phase-2-chk1");
        expect(labels.stepCheckpoint(p("2"), 3)).toBe("phase-2-step-3-chk1");
    });

    it("skips human phase labels used by a file or a history entry", () => {
        const labels = new ReviewLabels(
            ["phase-2"],
            [entry("review", "phase-2-r2")],
        );
        expect(labels.phase(p("2"))).toBe("phase-2-r3");
    });

    it("skips used mid-phase labels", () => {
        const labels = new ReviewLabels(["phase-2-step-3"], []);
        expect(labels.step(p("2"), 3)).toBe("phase-2-step-3-r2");
        expect(labels.step(p("2"), 4)).toBe("phase-2-step-4");
    });

    it("skips used final labels", () => {
        const labels = new ReviewLabels([], [entry("review", "final")]);
        expect(labels.final()).toBe("final-r2");
    });

    it("skips used checkpoint labels", () => {
        const labels = new ReviewLabels(
            ["phase-2-chk1"],
            [entry("checkpoint", "phase-2-chk2")],
        );
        expect(labels.checkpoint(p("2"))).toBe("phase-2-chk3");
    });

    it("skips used mid-phase checkpoint labels", () => {
        const labels = new ReviewLabels(["phase-2-step-3-chk1"], []);
        expect(labels.stepCheckpoint(p("2"), 3)).toBe("phase-2-step-3-chk2");
    });

    it("a used checkpoint label does not reserve a human label", () => {
        const labels = new ReviewLabels(
            ["phase-2-chk1", "phase-2-step-3-chk1"],
            [entry("checkpoint", "phase-2-chk2")],
        );
        expect(labels.phase(p("2"))).toBe("phase-2");
        expect(labels.step(p("2"), 3)).toBe("phase-2-step-3");
    });

    it("a used human label does not reserve a checkpoint label", () => {
        const labels = new ReviewLabels(
            ["phase-2", "phase-2-r2", "phase-2-step-3"],
            [entry("review", "final")],
        );
        expect(labels.checkpoint(p("2"))).toBe("phase-2-chk1");
        expect(labels.stepCheckpoint(p("2"), 3)).toBe("phase-2-step-3-chk1");
    });

    it("keeps phases, including inserted phases, apart", () => {
        const labels = new ReviewLabels(["phase-7", "phase-7a-chk1"], []);
        expect(labels.phase(p("7a"))).toBe("phase-7a");
        expect(labels.checkpoint(p("7"))).toBe("phase-7-chk1");
        expect(labels.checkpoint(p("7a"))).toBe("phase-7a-chk2");
    });

    it("the first unused label fills a gap", () => {
        const labels = new ReviewLabels(["phase-2-r2"], []);
        expect(labels.phase(p("2"))).toBe("phase-2");
    });
});
