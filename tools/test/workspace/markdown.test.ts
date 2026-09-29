import { describe, expect, it } from "vitest";
import {
    findTableHeader,
    isTableSeparator,
    sectionLines,
    tableCells,
} from "../../src/workspace/markdown.ts";

describe("tableCells", () => {
    it("splits a row, trims, and unescapes pipes", () => {
        expect(tableCells("| a | b \\| c |")).toEqual(["a", "b | c"]);
    });

    it("returns null for a non-row", () => {
        expect(tableCells("a | b")).toBeNull();
    });
});

describe("findTableHeader", () => {
    it("finds the row containing every column", () => {
        const lines = ["text", "| A | B | C |", "|---|---|---|"];
        expect(findTableHeader(lines, ["A", "C"])).toBe(1);
        expect(findTableHeader(lines, ["A", "D"])).toBe(-1);
    });
});

describe("isTableSeparator", () => {
    it("accepts dashes with optional colons at the right width", () => {
        expect(isTableSeparator("|---|:---:|", 2)).toBe(true);
    });

    it("rejects a wrong width, short dashes, or a non-row", () => {
        expect(isTableSeparator("|---|---|", 3)).toBe(false);
        expect(isTableSeparator("|--|---|", 2)).toBe(false);
        expect(isTableSeparator("---", 1)).toBe(false);
    });
});

describe("sectionLines", () => {
    const md = ["# T", "## One", "a", "b", "## Two", "c"].join("\n");

    it("reads from the matched heading to the next ## heading", () => {
        expect(sectionLines(md, (l) => l === "## One")).toEqual(["a", "b"]);
    });

    it("reads to the end when no heading follows", () => {
        expect(sectionLines(md, (l) => l === "## Two")).toEqual(["c"]);
    });

    it("is empty when no heading matches", () => {
        expect(sectionLines(md, (l) => l === "## Nope")).toEqual([]);
    });
});
