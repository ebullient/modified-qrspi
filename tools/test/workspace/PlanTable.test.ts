import { describe, expect, it } from "vitest";
import type { PhaseId } from "../../src/state/types.ts";
import { parsePlanTable, rowIndexOf } from "../../src/workspace/PlanTable.ts";

describe("parsePlanTable", () => {
    it("parses none, empty, and comma-separated Depends On", () => {
        const markdown = [
            "| Phase | Name | Depends On | Description | Steps | Status |",
            "|-------|------|------------|--------------|-------|--------|",
            "| 1 | Store | none | desc | 5 | [x] |",
            "| 2 | Parsers |  | desc | 6 | [~] |",
            "| 3 | Findings | 1,2 | desc | 5 | [ ] |",
        ].join("\n");

        const result = parsePlanTable(markdown, "plan.md");
        expect(result.findings).toEqual([]);
        expect(result.rows).toEqual([
            { phase: "1", name: "Store", dependsOn: [], status: "x" },
            { phase: "2", name: "Parsers", dependsOn: [], status: "~" },
            {
                phase: "3",
                name: "Findings",
                dependsOn: ["1", "2"],
                status: " ",
            },
        ]);
    });

    it("ignores an unknown extra column", () => {
        const markdown = [
            "| Phase | Name | Depends On | Extra | Status |",
            "|-------|------|------------|-------|--------|",
            "| 1 | Store | none | ignored | [x] |",
        ].join("\n");

        expect(parsePlanTable(markdown, "plan.md").rows).toEqual([
            { phase: "1", name: "Store", dependsOn: [], status: "x" },
        ]);
    });

    it("reports format-invalid with line for a malformed Status value", () => {
        const markdown = [
            "| Phase | Name | Depends On | Status |",
            "|-------|------|------------|--------|",
            "| 1 | Store | none | [x] |",
            "| 2 | Parsers | none | [?] |",
        ].join("\n");

        const result = parsePlanTable(markdown, "plan.md");
        expect(result.rows).toEqual([
            { phase: "1", name: "Store", dependsOn: [], status: "x" },
        ]);
        expect(result.findings).toEqual([
            {
                code: "format-invalid",
                message: 'Status "[?]" is not a valid status marker',
                file: "plan.md",
                line: 4,
            },
        ]);
    });

    it("preserves row order regardless of numeric phase-id order", () => {
        const markdown = [
            "| Phase | Name | Depends On | Status |",
            "|-------|------|------------|--------|",
            "| 10 | Ten | none | [ ] |",
            "| 2 | Two | none | [ ] |",
            "| 1 | One | none | [ ] |",
        ].join("\n");

        const result = parsePlanTable(markdown, "plan.md");
        expect(result.rows.map((r) => r.phase)).toEqual(["10", "2", "1"]);
        expect(rowIndexOf(result, "2" as PhaseId)).toBe(1);
    });

    it("parses inserted-phase ids (7a, 7b) as opaque tokens in row order", () => {
        const markdown = [
            "| Phase | Name | Depends On | Status |",
            "|-------|------|------------|--------|",
            "| 7 | Seven | none | [x] |",
            "| 7a | Seven-a | 7 | [x] |",
            "| 7b | Seven-b | 7a | [ ] |",
            "| 8 | Eight | 7b | [ ] |",
        ].join("\n");

        const result = parsePlanTable(markdown, "plan.md");
        expect(result.findings).toEqual([]);
        expect(result.rows.map((r) => r.phase)).toEqual(["7", "7a", "7b", "8"]);
        expect(rowIndexOf(result, "7a" as PhaseId)).toBe(1);
        expect(rowIndexOf(result, "8" as PhaseId)).toBe(3);
        expect(result.rows[3]?.dependsOn).toEqual(["7b"]);
    });

    it("unescapes a markdown-escaped pipe inside a cell instead of mis-splitting the row", () => {
        const markdown = [
            "| Phase | Name | Depends On | Status |",
            "|-------|------|------------|--------|",
            "| 1 | A \\| B | none | [x] |",
        ].join("\n");

        const result = parsePlanTable(markdown, "plan.md");
        expect(result.findings).toEqual([]);
        expect(result.rows).toEqual([
            { phase: "1", name: "A | B", dependsOn: [], status: "x" },
        ]);
    });

    it("reports format-invalid for a doubly-suffixed phase id", () => {
        const markdown = [
            "| Phase | Name | Depends On | Status |",
            "|-------|------|------------|--------|",
            "| 7 | Seven | none | [x] |",
            "| 7aa | Bad | 7 | [ ] |",
        ].join("\n");

        const result = parsePlanTable(markdown, "plan.md");
        expect(result.rows).toEqual([
            { phase: "7", name: "Seven", dependsOn: [], status: "x" },
        ]);
        expect(result.findings).toEqual([
            {
                code: "format-invalid",
                message: 'Phase "7aa" is not a valid phase id',
                file: "plan.md",
                line: 4,
            },
        ]);
    });

    it("reports format-invalid when a phase id is declared more than once", () => {
        const markdown = [
            "| Phase | Name | Depends On | Status |",
            "|-------|------|------------|--------|",
            "| 1 | Store | none | [x] |",
            "| 1 | Duplicate Store | none | [ ] |",
        ].join("\n");

        const result = parsePlanTable(markdown, "plan.md");
        expect(result.rows).toEqual([
            { phase: "1", name: "Store", dependsOn: [], status: "x" },
        ]);
        expect(result.findings).toEqual([
            {
                code: "format-invalid",
                message: 'Phase "1" is declared more than once',
                file: "plan.md",
                line: 4,
            },
        ]);
    });
});
