import { describe, expect, it } from "vitest";
import {
    implementerOutcome,
    reviewerOutcome,
} from "../../../src/state/loop/outcomes.ts";
import { fakeWorkspace } from "../fixtures.ts";
import { loopBlock, phaseSteps, readyFiles, reviewFile } from "./fixtures.ts";

describe("reviewerOutcome", () => {
    it("reads a valid verdict and non-blocking findings", () => {
        const result = reviewerOutcome(
            fakeWorkspace({
                ...readyFiles(),
                "reviews/phase-2-chk1.md": reviewFile("PASS WITH CONDITIONS", [
                    "| LOW | no | Keep this note |",
                ]),
            }),
            "phase-2-chk1",
        );
        expect(result).toMatchObject({
            kind: "complete",
            verdict: "PASS WITH CONDITIONS",
            conditions: [{ note: "LOW: Keep this note" }],
        });
    });

    it("stops for an unusable artifact", () => {
        expect(
            reviewerOutcome(
                fakeWorkspace({
                    ...readyFiles(),
                    "reviews/phase-2-chk1.md": "not a review",
                }),
                "phase-2-chk1",
            ),
        ).toEqual({
            kind: "stopped",
            stoppedReason: "invalid review artifact: reviews/phase-2-chk1.md",
        });
    });

    it.each([
        ["missing", {}],
        [
            "a PENDING stub",
            { "reviews/phase-2-chk1.md": "## Verdict: PENDING\n" },
        ],
    ])("is incomplete when the file is %s", (_kind, review) => {
        expect(
            reviewerOutcome(
                fakeWorkspace({ ...readyFiles(), ...review }),
                "phase-2-chk1",
            ),
        ).toEqual({ kind: "incomplete" });
    });
});

describe("implementerOutcome", () => {
    it("STOPPED wins over marker evidence", () => {
        expect(
            implementerOutcome({
                action: "implement",
                loop: loopBlock(),
                workspace: fakeWorkspace({
                    ...readyFiles(),
                    "plan-phase-2.md": phaseSteps("x"),
                }),
                result: "STOPPED",
            }),
        ).toBe("STOPPED");
    });

    it("a blocked marker is STOPPED without an explicit result", () => {
        expect(
            implementerOutcome({
                action: "implement",
                loop: loopBlock(),
                workspace: fakeWorkspace({
                    ...readyFiles(),
                    "plan-phase-2.md": phaseSteps("!"),
                }),
            }),
        ).toBe("STOPPED");
    });

    it("implementation is complete only when every phase step is complete", () => {
        expect(
            implementerOutcome({
                action: "implement",
                loop: loopBlock(),
                workspace: fakeWorkspace({
                    ...readyFiles(),
                    "plan-phase-2.md": phaseSteps("x", "x"),
                }),
                result: "COMPLETE",
            }),
        ).toBe("COMPLETE");
        expect(
            implementerOutcome({
                action: "implement",
                loop: loopBlock(),
                workspace: fakeWorkspace(readyFiles()),
                result: "COMPLETE",
            }),
        ).toBe("incomplete");
    });

    it("repair is complete once it ends without an explicit STOPPED result", () => {
        const input = {
            action: "repair" as const,
            loop: loopBlock("repair"),
            workspace: fakeWorkspace(readyFiles()),
        };
        expect(implementerOutcome(input)).toBe("COMPLETE");
        expect(implementerOutcome({ ...input, result: "STOPPED" })).toBe(
            "STOPPED",
        );
    });
});
