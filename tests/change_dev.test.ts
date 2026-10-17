import {
  buildBranchName,
  checkBranch,
  isCloudDefaultBranch,
  parseConventionalTitle,
  slugify,
  specFromArgs,
  validateBranchName,
} from "../src/cli/change_dev_branch";
import { evaluatePlanFirst, isImplementationFile, parseGitLog } from "../src/cli/plan_check";

const noFetch = (): string => {
  throw new Error("must not fetch the Issue title");
};

describe("change_dev_branch", () => {
  it("builds <type>/<issue>-<slug> from a title", () => {
    expect(buildBranchName({ type: "docs", issue: 82, title: "Adopt the change-dev workflow" })).toBe(
      "docs/82-adopt-change-dev-workflow",
    );
    expect(buildBranchName({ type: "fix", issue: null, title: "Typo in README" })).toBe("fix/typo-in-readme");
  });

  it("cuts the slug at a word boundary and rejects titles without ASCII words", () => {
    const slug = slugify("one two three four five six seven eight nine ten eleven");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
    expect(() => buildBranchName({ type: "feat", issue: 1, title: "日本語のタイトル" })).toThrow(/--slug/);
    expect(buildBranchName({ type: "feat", issue: 1, title: "日本語", slug: "reddit-source" })).toBe(
      "feat/1-reddit-source",
    );
  });

  it("rejects an unknown type", () => {
    expect(() => buildBranchName({ type: "feature", issue: 1, title: "x y z" })).toThrow(/unknown type/);
  });

  it("parses Conventional Commits and Work-Unit titles", () => {
    expect(parseConventionalTitle("feat(llm): add retries")).toEqual({ type: "feat", text: "add retries" });
    expect(parseConventionalTitle("[P1-2] Add retries")).toEqual({ type: null, text: "Add retries" });
  });

  it("validates names", () => {
    expect(validateBranchName("feat/42-reddit-source").status).toBe("ok");
    expect(validateBranchName("main").status).toBe("exempt");
    expect(validateBranchName("dependabot/npm_and_yarn/jest-30").status).toBe("exempt");
    expect(validateBranchName("claude/project-thread-8r6ziw").status).toBe("cloud-default");
    expect(isCloudDefaultBranch("claude/quirky-cray-71fqmx")).toBe(true);
    expect(validateBranchName("feature/foo").status).toBe("invalid");
    expect(validateBranchName("feat/42-12").reasons).toContain("slug must describe the change in words");
    expect(validateBranchName(`feat/1-${"a".repeat(41)}`).status).toBe("invalid");
  });

  it("warns on a cloud-assigned name only with --warn-cloud", () => {
    expect(checkBranch("claude/project-thread-8r6ziw", true).code).toBe(0);
    expect(checkBranch("claude/project-thread-8r6ziw", false).code).toBe(1);
    expect(checkBranch("feature/foo", true).code).toBe(1);
    expect(checkBranch("docs/82-adopt-change-dev-workflow", false).code).toBe(0);
  });

  it("reads positional arguments and options", () => {
    expect(specFromArgs(["docs", "82", "Adopt", "workflow"], noFetch)).toEqual({
      type: "docs",
      issue: 82,
      slug: undefined,
      title: "Adopt workflow",
    });
    const fromIssue = specFromArgs(["--issue", "7"], () => "fix(rss): handle empty feeds");
    expect(buildBranchName(fromIssue)).toBe("fix/7-handle-empty-feeds");
    expect(() => specFromArgs(["--issue", "7"], () => "[P1] no type here")).toThrow(/change type/);
    expect(() => specFromArgs(["feat", "abc", "x"], noFetch)).toThrow(/invalid issue number/);
  });
});

describe("plan_check", () => {
  const plan = ".devs/changes/2026-10-17_X/implementation_plan.md";

  it("treats Markdown, docs/ and .devs/ as non-implementation", () => {
    expect(isImplementationFile("README.md")).toBe(false);
    expect(isImplementationFile("docs/a.png")).toBe(false);
    expect(isImplementationFile(plan)).toBe(false);
    expect(isImplementationFile("src/main.ts")).toBe(true);
  });

  it("passes when the plan is committed before the implementation", () => {
    const r = evaluatePlanFirst([
      { sha: "aaaaaaa1", files: [{ status: "A", path: plan }] },
      { sha: "bbbbbbb2", files: [{ status: "M", path: "src/main.ts" }] },
    ]);
    expect(r).toMatchObject({ ok: true, exempt: false });
  });

  it("exempts documentation-only branches", () => {
    expect(evaluatePlanFirst([{ sha: "a", files: [{ status: "M", path: "AGENTS.md" }] }])).toMatchObject({
      ok: true,
      exempt: true,
    });
  });

  it("fails without a plan, with the plan in the same commit, or after", () => {
    expect(evaluatePlanFirst([{ sha: "a", files: [{ status: "M", path: "src/x.ts" }] }]).ok).toBe(false);
    const same = evaluatePlanFirst([
      {
        sha: "a",
        files: [
          { status: "A", path: plan },
          { status: "A", path: "src/x.ts" },
        ],
      },
    ]);
    expect(same.message).toMatch(/same commit/);
    const after = evaluatePlanFirst([
      { sha: "a", files: [{ status: "A", path: "src/x.ts" }] },
      { sha: "b", files: [{ status: "A", path: plan }] },
    ]);
    expect(after.message).toMatch(/after/);
  });

  it("parses git log --name-status output", () => {
    const log = ["COMMIT abc", "", `A\t${plan}`, "COMMIT def", "", "M\tsrc/main.ts", "R100\told.ts\tnew.ts"].join("\n");
    expect(parseGitLog(log)).toEqual([
      { sha: "abc", files: [{ status: "A", path: plan }] },
      {
        sha: "def",
        files: [
          { status: "M", path: "src/main.ts" },
          { status: "R", path: "new.ts" },
        ],
      },
    ]);
  });
});
