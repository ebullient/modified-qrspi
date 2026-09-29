import { describe, expect, it } from "vitest";
import { StateInvalidError } from "../../src/state/errors.ts";
import { readState, validateState } from "../../src/state/store/schema.ts";

const requiredOnlyState = () => ({
    feature: "example-feature",
    currentStep: "plan",
    blockers: [],
    decisions: ["Shape skipped because the direction was settled."],
    history: [
        {
            step: "plan",
            timestamp: "2026-09-25T21:05:11Z",
            mode: "revision",
        },
    ],
});

describe("validateState", () => {
    it("accepts every loop cycle", () => {
        for (const cycle of [
            "implement",
            "review",
            "repair",
            "re-review",
            "advance",
            "done",
        ]) {
            const state = validateState({
                ...requiredOnlyState(),
                loop: {
                    scope: "2",
                    phases: ["2"],
                    cycle,
                    phase: "2",
                    conditions: [],
                    stoppedReason: null,
                },
            });
            expect(state.loop?.cycle).toBe(cycle);
        }
    });

    it("accepts the full schema", () => {
        const raw = {
            ...requiredOnlyState(),
            currentStep: "checkpoint",
            planPhase: "7a",
            phaseBaseSha: "abcdef0",
            commitMode: "step",
            loop: {
                scope: "7a..9",
                phases: ["7a", "8", "9"],
                cycle: "review",
                phase: "7a",
                conditions: [
                    {
                        phase: "7a",
                        label: "phase-7a-chk1",
                        note: "LOW: consider clearer wording",
                    },
                ],
                stoppedReason: null,
            },
        };

        expect(validateState(raw)).toEqual(raw);
    });

    it("leaves every missing optional field absent", () => {
        expect(validateState(requiredOnlyState())).toEqual(requiredOnlyState());
    });

    it.each([
        ["feature", 42],
        ["currentStep", "launch"],
        ["blockers", [3]],
        ["decisions", "none"],
        ["history", [{ step: "launch", timestamp: "2026-09-25T21:05:11Z" }]],
    ])("rejects an invalid required field: %s", (field, value) => {
        expect(() =>
            validateState({ ...requiredOnlyState(), [field]: value }),
        ).toThrow(StateInvalidError);
    });

    it.each(["building", "execution", 7, null])(
        "accepts and ignores a stored currentPhase of %j",
        (value) => {
            const raw = { ...requiredOnlyState(), currentPhase: value };
            expect(readState(raw)).toEqual({
                values: requiredOnlyState(),
                invalid: [],
            });
            expect(validateState(raw)).toEqual(requiredOnlyState());
        },
    );

    it('accepts "root" as phaseBaseSha, for a phase started before the first commit', () => {
        const state = validateState({
            ...requiredOnlyState(),
            phaseBaseSha: "root",
        });
        expect(state.phaseBaseSha).toBe("root");
    });

    it.each([
        ["planPhase", "0"],
        ["phaseBaseSha", "not-a-sha"],
        ["commitMode", "squash"],
    ])("rejects an invalid optional field when present: %s", (field, value) => {
        expect(() =>
            validateState({ ...requiredOnlyState(), [field]: value }),
        ).toThrow(StateInvalidError);
    });

    it("drops an unknown key at every validated level rather than rejecting it", () => {
        const raw = {
            ...requiredOnlyState(),
            unknownTopLevelKey: 3,
            history: [
                {
                    step: "plan",
                    timestamp: "2026-09-25T21:05:11Z",
                    unknownHistoryKey: true,
                },
            ],
            loop: {
                scope: "2",
                phases: ["2"],
                cycle: "implement",
                phase: "2",
                conditions: [],
                stoppedReason: null,
                unknownLoopKey: "dropped",
            },
        };

        const state = validateState(raw);

        expect(state).not.toHaveProperty("unknownTopLevelKey");
        expect(state.history[0]).not.toHaveProperty("unknownHistoryKey");
        expect(state.loop).not.toHaveProperty("unknownLoopKey");
        expect(state.loop?.phases).toEqual(["2"]);
    });

    it("loads a legacy loop block that still carries repairUsed/repairBaseSha, dropping both", () => {
        const state = validateState({
            ...requiredOnlyState(),
            loop: {
                scope: "2",
                phases: ["2"],
                cycle: "implement",
                phase: "2",
                repairUsed: true,
                conditions: [],
                stoppedReason: null,
                repairBaseSha: "abcdef0",
            },
        });

        expect(state.loop).not.toHaveProperty("repairUsed");
        expect(state.loop).not.toHaveProperty("repairBaseSha");
        expect(state.loop).toEqual({
            scope: "2",
            phases: ["2"],
            cycle: "implement",
            phase: "2",
            conditions: [],
            stoppedReason: null,
        });
    });

    it("rejects a partial loop block missing a required key", () => {
        expect(() =>
            validateState({
                ...requiredOnlyState(),
                loop: {
                    scope: "all",
                    cycle: "implement",
                    phase: "1",
                    conditions: [],
                },
            }),
        ).toThrow(StateInvalidError);
    });

    it("rejects an invalid nested value", () => {
        expect(() =>
            validateState({
                ...requiredOnlyState(),
                loop: {
                    scope: "all",
                    phases: ["1"],
                    cycle: "implement",
                    phase: "1",
                    conditions: [{ phase: "1", label: 3, note: "" }],
                    stoppedReason: null,
                },
            }),
        ).toThrow(StateInvalidError);
    });
});

describe("readState", () => {
    it("keeps an invalid loop block's valid members apart from its values", () => {
        const read = readState({
            ...requiredOnlyState(),
            loop: {
                scope: "1..2",
                phases: ["1", "2"],
                cycle: "bogus",
                phase: "2",
                conditions: [
                    { phase: "1", label: "phase-1-chk1", note: "LOW: x" },
                    { phase: "1", label: "not-a-checkpoint", note: "y" },
                ],
                stoppedReason: null,
            },
        });
        expect(read.values).not.toHaveProperty("loop");
        expect(read.invalid).toEqual(["loop.cycle"]);
        expect(read.loopMembers).toEqual({
            scope: "1..2",
            phases: ["1", "2"],
            phase: "2",
            conditions: [{ phase: "1", label: "phase-1-chk1", note: "LOW: x" }],
            stoppedReason: null,
        });
    });

    it("reads a valid state with no invalid fields", () => {
        expect(readState(requiredOnlyState())).toEqual({
            values: requiredOnlyState(),
            invalid: [],
        });
    });

    it.each([
        ["feature", 42],
        ["currentStep", "launch"],
        ["blockers", "none"],
        ["decisions", "none"],
        ["history", "none"],
        ["planPhase", "0"],
        ["phaseBaseSha", "not-a-sha"],
        ["commitMode", "squash"],
        ["loop", { scope: "all" }],
    ])(
        "an invalid %s is reported alone, keeping every other value",
        (field, value) => {
            const raw = { ...requiredOnlyState(), [field]: value };
            const { values, invalid } = readState(raw);

            expect(invalid).toHaveLength(1);
            expect(invalid[0]?.startsWith(field)).toBe(true);
            const { [field]: _, ...rest } = requiredOnlyState() as Record<
                string,
                unknown
            >;
            expect(values).toEqual(rest);
        },
    );

    it("reports a missing required field", () => {
        const { currentStep: _, ...raw } = requiredOnlyState();
        expect(readState(raw).invalid).toEqual(["currentStep"]);
    });

    it("drops an invalid array entry alone", () => {
        const good = { step: "plan", timestamp: "2026-09-25T21:05:11Z" };
        const { values, invalid } = readState({
            ...requiredOnlyState(),
            decisions: ["kept", 3, "also kept"],
            history: [
                good,
                { step: "launch", timestamp: good.timestamp },
                good,
            ],
        });

        expect(invalid).toEqual(["decisions[1]", "history[1].step"]);
        expect(values.decisions).toEqual(["kept", "also kept"]);
        expect(values.history).toEqual([good, good]);
    });

    it("drops an invalid optional member of a history entry, keeping the entry", () => {
        const { values, invalid } = readState({
            ...requiredOnlyState(),
            history: [
                {
                    step: "review",
                    timestamp: "2026-09-25T21:05:11Z",
                    label: "Not A Label",
                    verdict: "PASS",
                },
            ],
        });

        expect(invalid).toEqual(["history[0].label"]);
        expect(values.history).toEqual([
            {
                step: "review",
                timestamp: "2026-09-25T21:05:11Z",
                verdict: "PASS",
            },
        ]);
    });

    it("drops a missing or malformed timestamp, keeping the entry", () => {
        const { values, invalid } = readState({
            ...requiredOnlyState(),
            history: [
                { step: "query", timestamp: "yesterday" },
                { step: "research" },
            ],
        });

        expect(invalid).toEqual(["history[0].timestamp"]);
        expect(values.history).toEqual([
            { step: "query" },
            { step: "research" },
        ]);
    });

    it("drops a verdict outside PASS, PASS WITH CONDITIONS, and FAIL", () => {
        const { values, invalid } = readState({
            ...requiredOnlyState(),
            history: [
                {
                    step: "review",
                    timestamp: "2026-09-25T21:05:11Z",
                    label: "phase-1",
                    verdict: "MAYBE",
                },
            ],
        });

        expect(invalid).toEqual(["history[0].verdict"]);
        expect(values.history?.[0]).not.toHaveProperty("verdict");
    });

    it("drops a history label that is not a review label", () => {
        const { values, invalid } = readState({
            ...requiredOnlyState(),
            history: [
                {
                    step: "review",
                    timestamp: "2026-09-25T21:05:11Z",
                    label: "banana",
                    verdict: "PASS",
                },
            ],
        });

        expect(invalid).toEqual(["history[0].label"]);
        expect(values.history?.[0]).not.toHaveProperty("label");
    });

    it("accepts any non-empty by", () => {
        const entry = {
            step: "implement",
            timestamp: "2026-09-25T21:05:11Z",
            by: "someone-else",
        };
        const { values, invalid } = readState({
            ...requiredOnlyState(),
            history: [entry],
        });

        expect(invalid).toEqual([]);
        expect(values.history).toEqual([entry]);
    });

    it("leaves an absent optional field absent", () => {
        const { values } = readState(requiredOnlyState());

        expect(values).not.toHaveProperty("planPhase");
        expect(values).not.toHaveProperty("phaseBaseSha");
        expect(values).not.toHaveProperty("commitMode");
        expect(values).not.toHaveProperty("loop");
    });

    it("a non-object state has no values", () => {
        expect(readState([])).toEqual({ values: {}, invalid: ["state"] });
    });
});
