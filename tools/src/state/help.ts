// Builds the progressively disclosed `--help` payloads: the tool overview, one
// command, or one form of a command. Help explains purpose and shape; findings
// explain themselves when they arrive, so no finding table lives here.

import { loopActors } from "./commands/loop/shared.ts";
import { queryModes } from "./commands/Query.ts";
import { loopLaunches } from "./loop/LoopNext.ts";
import { implementerResults } from "./loop/outcomes.ts";
import { commitModes } from "./types.ts";

const launchList = loopLaunches.join("|");
const actorList = loopActors.join("|");
const queryModeList = queryModes.join("|");
const commitModeList = commitModes.join("|");
const implementerResultList = implementerResults.join("|");

/** One option a form accepts, with the constraint a caller needs to supply it. */
export interface OptionHelp {
    name: string;
    value: string | null;
    required?: boolean;
    description: string;
}

/** One invocable form: `report`, `record <step>`, or `loop --<action>`. */
export interface FormHelp {
    form: string;
    summary: string;
    options: OptionHelp[];
    example: {
        command: string;
        result: unknown;
    };
}

export interface CommandHelp {
    command: string;
    summary: string;
    detail: string;
    forms: FormHelp[];
}

const featureOption: OptionHelp = {
    name: "--feature",
    value: "<name>",
    required: true,
    description:
        "The feature workspace under ./qrspi/, named in lowercase words joined by hyphens.",
};

const projectOption: OptionHelp = {
    name: "--project",
    value: "<path>",
    description:
        "The project root holding ./qrspi/. Defaults to the current directory.",
};

const dryRunOption: OptionHelp = {
    name: "--dry-run",
    value: null,
    description:
        "Report what the write would do and return wrote:false without changing state.json.",
};

const reasonOption: OptionHelp = {
    name: "--reason",
    value: "<text>",
    description:
        "Why this step is being recorded out of order. Kept in history for the human reading it later.",
};

/** The envelope every state-changing command prints, shown once at the top level. */
const envelope = {
    ok: "true when the command succeeded (exit 0)",
    command: 'the form that ran, such as "record spec"',
    feature: "the feature this command addressed",
    result: "command-specific payload; absent when there is nothing to return",
    findings:
        "conditions worth surfacing to the human, each {code, message, file?, line?}; a finding's message names the condition and the fix",
    wrote: "true when state.json changed on disk",
};

const exitCodes = {
    "0": "success",
    "1": "refused: a precondition failed and nothing was written",
    "2": "usage error: the arguments could not be parsed (plain text on stderr, no envelope)",
    "3": "state or workspace evidence could not be read; nothing was written",
    "4": "internal error (plain text on stderr, no envelope)",
};

/**
 * The saved state every `record` form returns. `currentPhase` is derived from
 * `currentStep`; `planPhase`, `phaseBaseSha`, `commitMode`, `loop`, and
 * `completed` appear only once something has set them.
 */
function savedState(
    step: string,
    phase: string,
    entry: Record<string, unknown>,
    extra: Record<string, unknown> = {},
    decisions: string[] = [],
) {
    return {
        feature: "state-helper",
        currentPhase: phase,
        currentStep: step,
        blockers: [],
        decisions,
        history: [{ step, timestamp: "2026-05-01T12:00:00Z", ...entry }],
        ...extra,
    };
}

const savedStateNote =
    " Returns the saved state; planPhase, phaseBaseSha, commitMode, loop, and completed appear only once set.";

const reportForm: FormHelp = {
    form: "report",
    summary:
        "Read the feature's position and the recommended next action. Read-only: it never writes state.json, and it is the source of truth when resuming work. labels.step is absent until a step of the phase is complete, and diff appears once the phase has a base.",
    options: [
        {
            name: "--phase",
            value: "<id>",
            description:
                "Report against this plan phase instead of the one state.json records.",
        },
    ],
    example: {
        command: "report --feature state-helper",
        result: {
            current: {
                phase: "execution",
                step: "implement",
                planPhase: "9",
                planProgress: {
                    current: "9.3",
                    completed: ["9.1", "9.2"],
                    blocked: [],
                },
                loop: {
                    scope: "7..9",
                    phases: ["7", "8", "9"],
                    cycle: "implement",
                    phase: "9",
                    stoppedReason: null,
                    checkpoints: [
                        { phase: "8", label: "phase-8", verdict: "PASS" },
                    ],
                    conditions: [
                        {
                            phase: "8",
                            label: "phase-8",
                            note: "Rename the helper.",
                        },
                    ],
                },
            },
            next: {
                step: "loop",
                alternatives: [],
            },
            labels: {
                phase: "phase-9",
                step: "phase-9-step-2",
                final: "final",
            },
            diff: "git diff 48484d0",
            loop: { action: "implement", phase: "9" },
        },
    },
};

const recordForms: FormHelp[] = [
    {
        form: "record init",
        summary: "Open the feature workspace and record that it exists.",
        options: [dryRunOption, reasonOption],
        example: {
            command: "record init --feature state-helper",
            result: savedState("init", "discovery", {}),
        },
    },
    {
        form: "record query",
        summary:
            "Record a Query pass. The mode says which kind of pass it was, because Query runs more than once.",
        options: [
            {
                name: "--mode",
                value: `<${queryModeList}>`,
                required: true,
                description:
                    "initial is the first pass; regeneration replaces the question set; refinement adds to it after research.",
            },
            dryRunOption,
            reasonOption,
        ],
        example: {
            command: "record query --feature state-helper --mode initial",
            result: savedState("query", "discovery", { mode: "initial" }),
        },
    },
    {
        form: "record research",
        summary:
            "Record that the open questions were answered against the codebase.",
        options: [dryRunOption, reasonOption],
        example: {
            command: "record research --feature state-helper",
            result: savedState("research", "discovery", {}),
        },
    },
    {
        form: "record shape",
        summary:
            "Record a solution-shaping pass. Optional: it applies only when approach.md exists.",
        options: [dryRunOption, reasonOption],
        example: {
            command: "record shape --feature state-helper",
            result: savedState("shape", "definition", {}),
        },
    },
    {
        form: "record spec",
        summary: "Record that the behavioral delta is specified.",
        options: [
            {
                name: "--mode",
                value: "<revision>",
                description:
                    "Marks this record as a revision of the step; requires --reason.",
            },
            dryRunOption,
            reasonOption,
        ],
        example: {
            command: "record spec --feature state-helper",
            result: savedState("spec", "definition", {}),
        },
    },
    {
        form: "record plan",
        summary:
            "Record that the spec is broken into phased steps. plan.md must exist; this is a hard stop without it.",
        options: [
            {
                name: "--mode",
                value: "<revision>",
                description:
                    "Marks this record as a revision of the step; requires --reason.",
            },
            dryRunOption,
            reasonOption,
        ],
        example: {
            command: "record plan --feature state-helper",
            result: savedState("plan", "definition", {}),
        },
    },
    {
        form: "record implement",
        summary:
            "Start or resume implementation of one plan phase, and set the base its checkpoint diff is measured from.",
        options: [
            {
                name: "--phase",
                value: "<id>",
                required: true,
                description:
                    "The plan phase to work, as plan.md numbers it, such as 7 or 7a.",
            },
            {
                name: "--commit-mode",
                value: `<${commitModeList}>`,
                description:
                    "Whether the phase commits once at the end or once per step.",
            },
            {
                name: "--base",
                value: "<commit-ish>",
                description:
                    "Measure this phase's diff from here instead of the current commit. Use it when history was rewritten under the recorded base.",
            },
            dryRunOption,
            reasonOption,
        ],
        example: {
            command:
                "record implement --feature state-helper --phase 9 --commit-mode phase",
            result: savedState(
                "implement",
                "execution",
                { phase: "9" },
                {
                    planPhase: "9",
                    phaseBaseSha: "48484d0",
                    commitMode: "phase",
                },
            ),
        },
    },
    {
        form: "record review",
        summary:
            "Record a human review and the verdict read from its artifact.",
        options: [
            {
                name: "--label",
                value: "<label>",
                required: true,
                description:
                    "Which review this is, such as final or phase-9. report's labels field names the next unused ones.",
            },
            dryRunOption,
            reasonOption,
        ],
        example: {
            command: "record review --feature state-helper --label final",
            result: savedState("review", "execution", {
                label: "final",
                verdict: "PASS",
                artifact: "reviews/final.md",
            }),
        },
    },
    {
        form: "record decision",
        summary:
            "Persist a decision the human made, so later steps can see it.",
        options: [
            {
                name: "--text",
                value: "<text>",
                required: true,
                description: "The decision, in the human's own words.",
            },
            dryRunOption,
        ],
        example: {
            command:
                'record decision --feature state-helper --text "Ship help without a finding table"',
            result: savedState("implement", "execution", { phase: "9" }, {}, [
                "Ship help without a finding table",
            ]),
        },
    },
    {
        form: "record done",
        summary:
            "Assert the feature is finished. report then shows completed: true; any other record <step> removes it, since resuming work is itself evidence the feature isn't done.",
        options: [dryRunOption],
        example: {
            command: "record done --feature state-helper",
            result: savedState(
                "implement",
                "execution",
                { phase: "9" },
                {
                    completed: true,
                },
            ),
        },
    },
];

/** The saved state a loop command returns: the record shape plus the persisted `loop` block. */
function loopState(cycle: string, phase: string, stoppedReason: string | null) {
    return savedState(
        "implement",
        "execution",
        { phase },
        {
            planPhase: phase,
            phaseBaseSha: "48484d0",
            commitMode: "phase",
            loop: {
                scope: "7..9",
                phases: ["7", "8", "9"],
                cycle,
                phase,
                conditions: [],
                stoppedReason,
            },
        },
    );
}

const loopForms: FormHelp[] = [
    {
        form: "loop --start",
        summary:
            "Open an unattended loop over a set of plan phases, after closing their dependencies. Returns {action, selector, phases, state}; action is implement, or done when nothing is left to run.",
        options: [
            {
                name: "--start",
                value: "<selector>",
                required: true,
                description:
                    "all, one phase id (7, 7a), an inclusive range (1..6), or a comma-separated combination (1..3,5,7).",
            },
            dryRunOption,
        ],
        example: {
            command: "loop --start 7..9 --feature state-helper",
            result: {
                action: "implement",
                selector: "7..9",
                phases: ["7", "8", "9"],
                state: loopState("implement", "7", null),
            },
        },
    },
    {
        form: "loop --begin",
        summary:
            "Open one launch within the loop: implementation or review. Returns {action, phase, state, commitMode?, mode?, review?, label?, diff?}; the optional fields depend on the launch (label and diff for a review, mode for a repair).",
        options: [
            {
                name: "--begin",
                value: `<${launchList}>`,
                required: true,
                description:
                    "The launch to open, as report's loop field names it.",
            },
            {
                name: "--commit-mode",
                value: `<${commitModeList}>`,
                description: "The commit granularity for this launch.",
            },
            {
                name: "--by",
                value: `<${actorList}>`,
                description:
                    "Who is running the launch, kept in history. Defaults to autoloop.",
            },
            dryRunOption,
        ],
        example: {
            command: "loop --begin implement --feature state-helper",
            result: {
                action: "implement",
                phase: "7",
                commitMode: "phase",
                state: loopState("implement", "7", null),
            },
        },
    },
    {
        form: "loop --end",
        summary:
            "Close the open launch and read its outcome, moving the loop to its next cycle. Returns {action, phase, outcome?, state, verdict?, done?}; verdict appears for a review, and done when the loop was already finished and nothing changed.",
        options: [
            {
                name: "--end",
                value: `<${launchList}>`,
                required: true,
                description: "The launch being closed.",
            },
            {
                name: "--result",
                value: `<${implementerResultList}>`,
                description: "How the launch finished.",
            },
            {
                name: "--note",
                value: "<text>",
                description: "A short note kept in history.",
            },
            {
                name: "--by",
                value: `<${actorList}>`,
                description: "Who ran the launch. Defaults to autoloop.",
            },
            dryRunOption,
        ],
        example: {
            command:
                "loop --end implement --result COMPLETE --feature state-helper",
            result: {
                action: "implement",
                phase: "7",
                outcome: "COMPLETE",
                state: loopState("review", "7", null),
            },
        },
    },
    {
        form: "loop --advance",
        summary:
            "Move the loop past a phase that passed its checkpoint review. Returns {action, phase, nextPhase?, state}; action is implement with phase the next phase in scope, or done after the last phase, with phase the finished phase and nextPhase the first ready phase outside the scope (or null).",
        options: [dryRunOption],
        example: {
            command: "loop --advance --feature state-helper",
            result: {
                action: "implement",
                phase: "8",
                state: loopState("implement", "8", null),
            },
        },
    },
    {
        form: "loop --stop",
        summary:
            "Stop the loop and record why. The loop stays in place for a human to resolve.",
        options: [
            {
                name: "--stop",
                value: "<reason>",
                required: true,
                description: "Why the loop stopped.",
            },
            dryRunOption,
        ],
        example: {
            command:
                'loop --stop "checkpoint failed twice" --feature state-helper',
            result: {
                action: "acknowledge-required",
                state: loopState("implement", "7", "checkpoint failed twice"),
            },
        },
    },
    {
        form: "loop --ok",
        summary:
            "Resolve a stopped loop whose scope a passing human review has since satisfied. Returns {action, state, label?}; label names the checkpoint to review when action is review.",
        options: [
            {
                name: "--ok",
                value: "[reason]",
                description: "Why the stop is resolved.",
            },
            dryRunOption,
        ],
        example: {
            command: "loop --ok --feature state-helper",
            result: {
                action: "implement",
                state: loopState("implement", "7", null),
            },
        },
    },
    {
        form: "loop --abandon",
        summary:
            "End the loop and return to human-run steps. The loop block is kept with cycle done; blockers stay for the human. Returns {action: done, state}.",
        options: [
            {
                name: "--abandon",
                value: "<reason>",
                required: true,
                description: "Why the loop is being abandoned.",
            },
            dryRunOption,
        ],
        example: {
            command: 'loop --abandon "plan changed" --feature state-helper',
            result: {
                action: "done",
                state: loopState("done", "7", null),
            },
        },
    },
];

/** Exported so tests can check every advertised option value against the CLI. */
export const commandHelp: CommandHelp[] = [
    {
        command: "report",
        summary: "Read position and the recommended next action.",
        detail: "report never writes. Run it to resume work, to see which step comes next, and to read the review labels and checkpoint diff the current phase needs.",
        forms: [reportForm],
    },
    {
        command: "record",
        summary: "Record that a workflow step happened.",
        detail: "Each step has its own form, because each carries different evidence. A record may return findings alongside a successful write; surface them to the human rather than suppressing them.",
        forms: recordForms.map((f) => ({
            ...f,
            summary: `${f.summary}${savedStateNote}`,
        })),
    },
    {
        command: "loop",
        summary: "Drive an unattended run over a set of plan phases.",
        detail: "Exactly one action flag per invocation. report's loop field names the action the loop expects next; any other action is refused.",
        forms: loopForms,
    },
];

function renderOption(option: OptionHelp): string {
    const flag =
        option.value === null ? option.name : `${option.name} ${option.value}`;
    const tag = option.required === true ? "required" : "optional";
    return `  ${flag}\n      (${tag}) ${option.description}`;
}

function renderCommonArguments(): string {
    return `Common arguments (every form accepts these):\n${[featureOption, projectOption].map(renderOption).join("\n")}`;
}

function renderEnvelopeAndExitCodes(): string {
    const envelopeLines = Object.entries(envelope)
        .map(([key, description]) => `  ${key}: ${description}`)
        .join("\n");
    const exitCodeLines = Object.entries(exitCodes)
        .map(([code, description]) => `  ${code}: ${description}`)
        .join("\n");
    return `Envelope fields (report/record/loop print one on stdout):\n${envelopeLines}\n\nExit codes:\n${exitCodeLines}`;
}

/** Plain-text rendering of the tool-level help. */
export function renderToolHelp(version: string): string {
    const usage = [
        "qrspi-x report --feature <name> [options]",
        "qrspi-x record <step> --feature <name> [options]",
        "qrspi-x loop --<action> --feature <name> [options]",
    ].join("\n  ");
    const commands = commandHelp
        .map(
            (c) =>
                `  ${c.command} - ${c.summary} (${`qrspi-x --help ${c.command}`})`,
        )
        .join("\n");
    return [
        `qrspi-x ${version}`,
        "Reads and writes ./qrspi/<feature>/state.json, the QRSPI workflow's position for one feature. It is the only writer of that file.",
        "",
        `Usage:\n  ${usage}`,
        "",
        `Commands:\n${commands}`,
        "",
        renderCommonArguments(),
        "",
        renderEnvelopeAndExitCodes(),
        "",
        "qrspi-x --help <command> describes one command; add a step or action for one form.",
    ].join("\n");
}

/** Plain-text rendering of help for one command. */
export function renderCommandHelp(
    command: string,
    version: string,
): string | undefined {
    const entry = commandHelp.find((c) => c.command === command);
    if (entry === undefined) return undefined;
    const forms = entry.forms
        .map((f) => `  ${f.form} - ${f.summary} (qrspi-x --help ${f.form})`)
        .join("\n");
    return [
        `qrspi-x ${version} - ${command}`,
        entry.summary,
        entry.detail,
        "",
        `Forms:\n${forms}`,
        "",
        renderEnvelopeAndExitCodes(),
    ].join("\n");
}

/** Plain-text rendering of help for one form. */
export function renderFormHelp(
    form: string,
    version: string,
): string | undefined {
    const entry = commandHelp
        .flatMap((c) => c.forms)
        .find((f) => f.form === form);
    if (entry === undefined) return undefined;
    const options = entry.options.map(renderOption).join("\n");
    return [
        `qrspi-x ${version} - ${entry.form}`,
        entry.summary,
        "",
        `Options:\n${options}`,
        "",
        "Also accepts --feature and --project (see `qrspi-x --help`).",
        "",
        `Example:\n  qrspi-x ${entry.example.command}\n  ${JSON.stringify(entry.example.result)}`,
        "",
        "See `qrspi-x --help` for the envelope and exit-code reference.",
    ].join("\n");
}
