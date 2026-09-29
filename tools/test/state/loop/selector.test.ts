import { describe, expect, it } from "vitest";
import { parseSelector as parseTagged } from "../../../src/state/loop/selector.ts";
import { parsePlanTable } from "../../../src/workspace/PlanTable.ts";

function table(...phases: string[]) {
    return parsePlanTable(
        [
            "| Phase | Name | Depends On | Status |",
            "|-------|------|------------|--------|",
            ...phases.map(
                (phase) => `| ${phase} | Name ${phase} | none | [ ] |`,
            ),
        ].join("\n"),
        "plan.md",
    );
}

function parseSelector(raw: string, planTable: ReturnType<typeof table>) {
    const result = parseTagged(raw, planTable);
    return result.kind === "phases" ? result.phases : result;
}

const plan = table("1", "2", "3", "4", "5", "6", "7", "7a", "8", "9", "10");

describe("parseSelector", () => {
    it("tags selected phases with their kind", () => {
        expect(parseTagged("5", plan)).toEqual({
            kind: "phases",
            phases: ["5"],
        });
    });

    it("all selects every row in order", () => {
        expect(parseSelector("all", table("1", "2", "2a", "3"))).toEqual([
            "1",
            "2",
            "2a",
            "3",
        ]);
    });

    it("selects a single phase id", () => {
        expect(parseSelector("5", plan)).toEqual(["5"]);
        expect(parseSelector("7a", plan)).toEqual(["7a"]);
    });

    it("selects an inclusive range", () => {
        expect(parseSelector("2..4", plan)).toEqual(["2", "3", "4"]);
    });

    it("selects a comma-separated list of ids and ranges", () => {
        expect(parseSelector("1..3,5,7", plan)).toEqual([
            "1",
            "2",
            "3",
            "5",
            "7",
        ]);
    });

    it("selects a mix with an inserted-phase endpoint", () => {
        expect(parseSelector("7a..9", plan)).toEqual(["7a", "8", "9"]);
        expect(parseSelector("7a,8..10", plan)).toEqual(["7a", "8", "9", "10"]);
    });

    it("merges overlapping tokens and returns plan row order", () => {
        expect(parseSelector("5,1..3,2", plan)).toEqual(["1", "2", "3", "5"]);
    });

    it.each([
        ["", "empty"],
        [" 1", "leading whitespace"],
        ["1, 2", "inner whitespace"],
        ["1,,2", "empty token"],
        ["1,", "trailing comma"],
        ["1...3", "malformed range"],
        ["1..2..3", "three-part range"],
        ["..3", "open range"],
        ["7.1", "step id"],
        ["07", "leading zero"],
        ["7A", "uppercase suffix"],
        ["7ab", "double suffix"],
        ["5,5", "duplicate token"],
        ["all,3", "all combined"],
    ])("%j is a syntax error (%s)", (raw) => {
        expect(parseSelector(raw, plan)).toMatchObject({ kind: "syntax" });
    });

    it("a phase not in plan.md is a missing-phase error", () => {
        expect(parseSelector("11", plan)).toMatchObject({ kind: "missing" });
        expect(parseSelector("1,7b", plan)).toMatchObject({ kind: "missing" });
    });

    it("a reversed range is a plan error", () => {
        expect(parseSelector("4..2", plan)).toMatchObject({ kind: "plan" });
    });

    it("reversal follows row order, not numeric order", () => {
        const outOfOrder = table("1", "3", "2");
        expect(parseSelector("3..2", outOfOrder)).toEqual(["3", "2"]);
        expect(parseSelector("2..3", outOfOrder)).toMatchObject({
            kind: "plan",
        });
    });
});

describe("parseSelector range resolution", () => {
    it("a range includes inserted phases between its endpoints", () => {
        const inserted = table("6", "7", "7a", "7b", "8", "9", "10");
        expect(parseSelector("7..9", inserted)).toEqual([
            "7",
            "7a",
            "7b",
            "8",
            "9",
        ]);
    });

    it("the same range without insertions covers only the original rows", () => {
        const original = table("6", "7", "8", "9", "10");
        expect(parseSelector("7..9", original)).toEqual(["7", "8", "9"]);
    });

    it("a range with an endpoint missing from plan.md is not a partial match", () => {
        const original = table("6", "7", "8", "9");
        expect(parseSelector("7..10", original)).toMatchObject({
            kind: "missing",
        });
        expect(parseSelector("5..8", original)).toMatchObject({
            kind: "missing",
        });
    });
});
