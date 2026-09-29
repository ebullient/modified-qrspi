import { describe, expect, it } from "vitest";
import { Findings } from "../../src/state/Findings.ts";

describe("Findings", () => {
    it("plan-not-current names the later step", () => {
        const finding = Findings.planNotCurrent("implement");
        expect(finding.code).toBe("plan-not-current");
        expect(finding.message).toContain("implement");
    });

    it("step-blocked names the step", () => {
        const finding = Findings.stepBlocked("plan-phase-2.md", "2.3");
        expect(finding.code).toBe("step-blocked");
        expect(finding.message).toContain("2.3");
    });

    it("phase-row-mismatch names the phase", () => {
        const finding = Findings.phaseRowMismatch("plan.md", "3");
        expect(finding.code).toBe("phase-row-mismatch");
        expect(finding.message).toContain("3");
    });

    it("advance-pending names the phase", () => {
        const finding = Findings.advancePending("3");
        expect(finding.code).toBe("advance-pending");
        expect(finding.message).toContain("3");
    });

    it("legacy-plan-location names the files and the fix", () => {
        const finding = Findings.legacyPlanLocation([
            "plan-phase-1.md",
            "plan-phase-2.md",
        ]);
        expect(finding.code).toBe("legacy-plan-location");
        expect(finding.message).toContain("plan-phase-1.md");
        expect(finding.message).toContain("plan-phase-2.md");
        expect(finding.message).toContain("plans/");
    });

    it("plans-not-a-directory names the condition and the fix", () => {
        const finding = Findings.plansNotADirectory();
        expect(finding.code).toBe("plans-not-a-directory");
        expect(finding.message).toContain("not a directory");
        expect(finding.message).toContain("plans.md");
        expect(finding.file).toBe("plans");
    });

    it("dirty-tree lists the paths", () => {
        const finding = Findings.dirtyTree(["a.txt", "b.txt"]);
        expect(finding.code).toBe("dirty-tree");
        expect(finding.message).toContain("a.txt");
        expect(finding.message).toContain("b.txt");
    });

    it("stale-downstream names the step", () => {
        const finding = Findings.staleDownstream("spec");
        expect(finding.code).toBe("stale-downstream");
        expect(finding.message).toContain("spec");
    });

    it("phase-complete names the phase", () => {
        const finding = Findings.phaseComplete("7a");
        expect(finding.code).toBe("phase-complete");
        expect(finding.message).toContain("7a");
    });

    it("dependency-incomplete names the phase and its dependency", () => {
        const finding = Findings.dependencyIncomplete("8", "7a");
        expect(finding.code).toBe("dependency-incomplete");
        expect(finding.message).toContain("8");
        expect(finding.message).toContain("7a");
    });

    it("a phase missing from plan.md is workspace-incomplete on plan.md", () => {
        const finding = Findings.phaseNotInPlan("9");
        expect(finding).toMatchObject({
            code: "workspace-incomplete",
            file: "plan.md",
        });
        expect(finding.message).toContain("9");
    });

    it("review-pending names the label", () => {
        const finding = Findings.reviewPending("phase-3-chk1");
        expect(finding.code).toBe("review-pending");
        expect(finding.message).toContain("phase-3-chk1");
    });

    it("loop-stopped includes the reason", () => {
        const finding = Findings.loopStopped("human requested a pause");
        expect(finding.code).toBe("loop-stopped");
        expect(finding.message).toContain("human requested a pause");
    });

    it("blockers pluralizes correctly", () => {
        expect(Findings.blockers(1).message).toContain("1 blocker ");
        expect(Findings.blockers(2).message).toContain("2 blockers ");
    });
});
