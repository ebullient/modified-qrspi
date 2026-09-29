import type { CommandServices } from "../../../src/state/commands/inputs.ts";
import { loopAbandon } from "../../../src/state/commands/loop/LoopAbandon.ts";
import { loopAdvance } from "../../../src/state/commands/loop/LoopAdvance.ts";
import { loopBegin } from "../../../src/state/commands/loop/LoopBegin.ts";
import { loopEnd } from "../../../src/state/commands/loop/LoopEnd.ts";
import { loopOk } from "../../../src/state/commands/loop/LoopOk.ts";
import { loopStart } from "../../../src/state/commands/loop/LoopStart.ts";
import { loopStop } from "../../../src/state/commands/loop/LoopStop.ts";
import type { StatusEntry } from "../../../src/state/ports.ts";
import { Store } from "../../../src/state/store/Store.ts";
import type { LoopBlock, PhaseId, State } from "../../../src/state/types.ts";
import {
    fakeClock,
    fakeGit,
    fakeWorkspace,
    MemoryStateFileSystem,
    now,
    statePath,
} from "../fixtures.ts";

export const phaseId = (id: string) => id as PhaseId;

export const planTable = (...rows: string[]) =>
    [
        "| Phase | Name | Depends On | Status |",
        "|---|---|---|---|",
        ...rows.map((row) => `| ${row} | [ ] |`),
    ].join("\n");

export const phaseSteps = (...markers: string[]) =>
    markers
        .map(
            (marker, index) =>
                `### Step ${index + 1}: Work\n- [${marker}] Status marker\n`,
        )
        .join("\n");

export const reviewFile = (
    verdict: "PASS" | "PASS WITH CONDITIONS" | "FAIL",
    rows: string[] = [],
) =>
    [
        `## Verdict: ${verdict}`,
        "",
        "| Severity | Blocking | Description |",
        "|---|---|---|",
        ...rows,
    ].join("\n");

/** A workspace ready for a loop over phase 2: phase 1 complete, phase 3 after it. */
export function readyFiles(phaseTwo = phaseSteps(" ")): Record<string, string> {
    return {
        "spec.md": "spec",
        "approach.md": "## Decision\n\nChosen.",
        "plan.md": planTable(
            "1 | Base | none",
            "2 | Feature | 1",
            "3 | Later | 2",
        ),
        "plan-phase-1.md": phaseSteps("x"),
        "plan-phase-2.md": phaseTwo,
        "plan-phase-3.md": phaseSteps(" "),
    };
}

export function loopBlock(
    cycle: LoopBlock["cycle"] = "implement",
    overrides: Partial<LoopBlock> = {},
): LoopBlock {
    return {
        scope: "2",
        phases: [phaseId("2")],
        cycle,
        phase: phaseId("2"),
        conditions: [],
        stoppedReason: null,
        ...overrides,
    };
}

/** State just after `record plan`, before any loop starts. */
export function plannedState(overrides: Partial<State> = {}): State {
    return {
        feature: "f",
        currentStep: "plan",
        blockers: [],
        decisions: [],
        history: [{ step: "plan", timestamp: now }],
        planPhase: phaseId("2"),
        ...overrides,
    };
}

/** State just after `record plan`, with a loop over phase 2. */
export function loopState(overrides: Partial<State> = {}): State {
    return plannedState({ loop: loopBlock(), ...overrides });
}

export interface LoopFixtureOptions {
    state?: State;
    files?: Record<string, string>;
    status?: StatusEntry[];
    head?: string;
}

/** The loop actions over in-memory state and workspace, with the pieces tests inspect. */
export function loopFixture(options: LoopFixtureOptions = {}) {
    const stateFs = new MemoryStateFileSystem();
    stateFs.files.set(statePath, JSON.stringify(options.state ?? loopState()));
    const services: CommandServices = {
        store: new Store({
            feature: "f",
            path: statePath,
            fileSystem: stateFs,
        }),
        workspace: fakeWorkspace(options.files ?? readyFiles()),
        git: fakeGit({
            head: () => options.head ?? "abcdef0",
            status: () => options.status ?? [],
        }),
        clock: fakeClock(),
    };
    const context = { feature: "f" };
    const inputs = { services, context };
    return {
        loop: {
            start: (o: Parameters<typeof loopStart>[1]) => loopStart(inputs, o),
            begin: (o: Parameters<typeof loopBegin>[1]) => loopBegin(inputs, o),
            end: (o: Parameters<typeof loopEnd>[1]) => loopEnd(inputs, o),
            advance: (o: Parameters<typeof loopAdvance>[1]) =>
                loopAdvance(inputs, o),
            stop: (o: Parameters<typeof loopStop>[1]) => loopStop(inputs, o),
            ok: (o: Parameters<typeof loopOk>[1]) => loopOk(inputs, o),
            abandon: (o: Parameters<typeof loopAbandon>[1]) =>
                loopAbandon(inputs, o),
        },
        services,
        context,
        stateFs,
    };
}
