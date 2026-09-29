import { describe, expect, it } from "vitest";
import {
    isFreshPhase,
    needsBase,
    resolveCommitMode,
} from "../../../src/state/loop/base.ts";
import type { State } from "../../../src/state/types.ts";
import { fakeWorkspace } from "../fixtures.ts";
import { phaseId, phaseSteps } from "./fixtures.ts";

const state = (overrides: Partial<State> = {}): State => ({
    feature: "f",
    currentStep: "plan",
    blockers: [],
    decisions: [],
    history: [],
    planPhase: phaseId("2"),
    phaseBaseSha: "abc",
    commitMode: "step",
    ...overrides,
});

describe("needsBase", () => {
    it("is true without state, without a base, or for another phase", () => {
        expect(needsBase(null, "2")).toBe(true);
        expect(needsBase(state({ phaseBaseSha: null }), "2")).toBe(true);
        expect(needsBase(state({ planPhase: phaseId("1") }), "2")).toBe(true);
    });

    it("is false when the recorded base belongs to the phase", () => {
        expect(needsBase(state(), "2")).toBe(false);
    });
});

describe("isFreshPhase", () => {
    const begun = fakeWorkspace({
        "plans/plan-phase-2.md": phaseSteps("x", " "),
    });
    const untouched = fakeWorkspace({
        "plans/plan-phase-2.md": phaseSteps(" ", " "),
    });

    it("needs a base and no begun steps", () => {
        expect(isFreshPhase(null, untouched, "2")).toBe(true);
        expect(isFreshPhase(state(), untouched, "2")).toBe(false);
        expect(isFreshPhase(null, begun, "2")).toBe(false);
    });
});

describe("resolveCommitMode", () => {
    const modes = (explicitWinsWhenKept: boolean) => ({
        fresh: resolveCommitMode({
            state: null,
            fresh: true,
            explicit: "step",
            explicitWinsWhenKept,
        }),
        freshDefault: resolveCommitMode({
            state: null,
            fresh: true,
            explicit: undefined,
            explicitWinsWhenKept,
        }),
        kept: resolveCommitMode({
            state: state({ commitMode: "phase" }),
            fresh: false,
            explicit: "step",
            explicitWinsWhenKept,
        }),
        keptDefault: resolveCommitMode({
            state: state({ commitMode: undefined }),
            fresh: false,
            explicit: undefined,
            explicitWinsWhenKept,
        }),
    });

    it("record implement: an explicit mode always wins", () => {
        expect(modes(true)).toEqual({
            fresh: "step",
            freshDefault: "phase",
            kept: "step",
            keptDefault: "phase",
        });
    });

    it("loop --begin: an explicit mode is ignored when the phase is not fresh", () => {
        expect(modes(false)).toEqual({
            fresh: "step",
            freshDefault: "phase",
            kept: "phase",
            keptDefault: "phase",
        });
    });
});
