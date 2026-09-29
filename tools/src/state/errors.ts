import type { Finding } from "./types.ts";

export class UsageError extends Error {
    readonly exitCode = 2 as const;

    constructor(message: string) {
        super(message);
        this.name = "UsageError";
    }
}

export class StateInvalidError extends Error {
    readonly exitCode = 3 as const;

    constructor(readonly finding: Finding) {
        super(finding.message);
        this.name = "StateInvalidError";
    }
}

/** Workspace evidence (such as git) could not be read; nothing is written. */
export class EvidenceInaccessibleError extends Error {
    readonly exitCode = 3 as const;

    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "EvidenceInaccessibleError";
    }
}

export class InternalError extends Error {
    readonly exitCode = 4 as const;

    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "InternalError";
    }
}
