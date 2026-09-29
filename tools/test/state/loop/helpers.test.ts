import { describe, expect, it } from "vitest";
import {
    clean,
    conditionsOf,
    historySinceStop,
    isImplementerLaunch,
    passes,
} from "../../../src/state/loop/helpers.ts";
import type { HistoryEntry } from "../../../src/state/types.ts";
import { phaseId } from "./fixtures.ts";

const entry = (overrides: Partial<HistoryEntry>): HistoryEntry => ({
    step: "implement",
    timestamp: "t",
    ...overrides,
});

describe("loop helpers", () => {
    it("names the implementer launches", () => {
        expect(isImplementerLaunch("implement")).toBe(true);
        expect(isImplementerLaunch("repair")).toBe(true);
        expect(isImplementerLaunch("review")).toBe(false);
        expect(isImplementerLaunch("re-review")).toBe(false);
    });

    it("history since the last STOPPED entry excludes it", () => {
        const a = entry({ reason: "a" });
        const stop = entry({ outcome: "STOPPED" });
        const b = entry({ reason: "b" });
        const stop2 = entry({ outcome: "STOPPED" });
        const c = entry({ reason: "c" });
        expect(historySinceStop([a, stop, b, stop2, c])).toEqual([c]);
        expect(historySinceStop([a, b])).toEqual([a, b]);
        expect(historySinceStop([a, stop])).toEqual([]);
        expect(historySinceStop([])).toEqual([]);
    });

    it("conditions carry the phase and checkpoint label", () => {
        expect(
            conditionsOf([{ note: "n1" }, { note: "n2" }], phaseId("2"), "l"),
        ).toEqual([
            { phase: "2", label: "l", note: "n1" },
            { phase: "2", label: "l", note: "n2" },
        ]);
    });

    it("passes accepts PASS and PASS WITH CONDITIONS; clean only PASS", () => {
        expect(passes("PASS")).toBe(true);
        expect(passes("PASS WITH CONDITIONS")).toBe(true);
        expect(passes("FAIL")).toBe(false);
        expect(passes(undefined)).toBe(false);
        expect(passes(null)).toBe(false);
        expect(clean("PASS")).toBe(true);
        expect(clean("PASS WITH CONDITIONS")).toBe(false);
        expect(clean("FAIL")).toBe(false);
        expect(clean(undefined)).toBe(false);
    });
});
