import { isPhaseId } from "../state/ids.ts";
import type { Finding, PhaseId } from "../state/types.ts";
import { findTableHeader, isTableSeparator, tableCells } from "./markdown.ts";
import { markerClassSource, type StepMarker } from "./PhaseFile.ts";

export interface PlanTableRow {
    phase: PhaseId;
    name: string;
    dependsOn: PhaseId[];
    status: StepMarker;
}

export interface PlanTable {
    rows: PlanTableRow[];
    findings: Finding[];
}

const statusPattern = new RegExp(`^\\[(${markerClassSource})\\]$`);
const requiredColumns = ["Phase", "Name", "Depends On", "Status"];

export function parsePlanTable(markdown: string, file: string): PlanTable {
    const lines = markdown.split(/\r?\n/);
    const findings: Finding[] = [];

    const headerIndex = findTableHeader(lines, requiredColumns);
    if (headerIndex < 0) {
        findings.push({
            code: "format-invalid",
            message:
                "Plan table must include Phase, Name, Depends On, and Status columns",
            file,
        });
        return { rows: [], findings };
    }

    const headers = tableCells(lines[headerIndex] ?? "") ?? [];
    if (!isTableSeparator(lines[headerIndex + 1] ?? "", headers.length)) {
        findings.push({
            code: "format-invalid",
            message: "Plan table separator is malformed",
            file,
            line: headerIndex + 2,
        });
        return { rows: [], findings };
    }

    const phaseIndex = headers.indexOf("Phase");
    const nameIndex = headers.indexOf("Name");
    const dependsOnIndex = headers.indexOf("Depends On");
    const statusIndex = headers.indexOf("Status");
    const rows: PlanTableRow[] = [];
    const seenPhases = new Set<PhaseId>();

    for (let i = headerIndex + 2; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (line.trim() === "") break;

        const cells = tableCells(line);
        if (cells === null || cells.length !== headers.length) {
            findings.push({
                code: "format-invalid",
                message: "Plan table row is malformed",
                file,
                line: i + 1,
            });
            continue;
        }

        const phaseCell = cells[phaseIndex] ?? "";
        const statusCell = cells[statusIndex] ?? "";
        const dependsOnCell = cells[dependsOnIndex] ?? "";

        if (!isPhaseId(phaseCell)) {
            findings.push({
                code: "format-invalid",
                message: `Phase "${phaseCell}" is not a valid phase id`,
                file,
                line: i + 1,
            });
            continue;
        }

        const phase = phaseCell as PhaseId;
        if (seenPhases.has(phase)) {
            findings.push({
                code: "format-invalid",
                message: `Phase "${phaseCell}" is declared more than once`,
                file,
                line: i + 1,
            });
            continue;
        }
        seenPhases.add(phase);

        const status = statusPattern.exec(statusCell)?.[1] as
            | StepMarker
            | undefined;
        if (!status) {
            findings.push({
                code: "format-invalid",
                message: `Status "${statusCell}" is not a valid status marker`,
                file,
                line: i + 1,
            });
            continue;
        }

        const dependsOn = parseDependsOn(dependsOnCell);
        if (dependsOn === null) {
            findings.push({
                code: "format-invalid",
                message: `Depends On "${dependsOnCell}" contains an invalid phase id`,
                file,
                line: i + 1,
            });
            continue;
        }

        rows.push({
            phase,
            name: cells[nameIndex] ?? "",
            dependsOn,
            status,
        });
    }

    return { rows, findings };
}

export function rowIndexOf(planTable: PlanTable, phaseId: PhaseId): number {
    return planTable.rows.findIndex((row) => row.phase === phaseId);
}

function parseDependsOn(cell: string): PhaseId[] | null {
    const trimmed = cell.trim();
    if (trimmed === "" || trimmed === "none") return [];

    const ids = trimmed.split(",").map((id) => id.trim());
    if (!ids.every((id) => isPhaseId(id))) return null;
    return ids as PhaseId[];
}
