import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import { __testing } from "../stages.ts"

const { issuePromptArgs, buildMergerRunOptions } = __testing

describe("issuePromptArgs", () => {
  it("returns the prompt-template fields with an empty PRIOR_ATTEMPTS by default", () => {
    const args = issuePromptArgs({
      number: 42,
      title: "feat: foo",
      itemId: "PVTI_xyz",
      branch: "sandcastle/issue-42",
    })
    assert.deepEqual(args, {
      ISSUE_NUMBER: "42",
      ISSUE_TITLE: "feat: foo",
      BRANCH: "sandcastle/issue-42",
      PRIOR_ATTEMPTS: "",
    })
  })

  it("renders ISSUE_NUMBER as a string even though the source is a number", () => {
    const args = issuePromptArgs({
      number: 1,
      title: "t",
      itemId: "i",
      branch: "b",
    })
    assert.equal(typeof args.ISSUE_NUMBER, "string")
    assert.equal(args.ISSUE_NUMBER, "1")
  })

  it("threads the PRIOR_ATTEMPTS block through to the prompt args verbatim", () => {
    const block = "<prior-attempts>\nattempt 2\n</prior-attempts>"
    const args = issuePromptArgs({ number: 1, title: "t", itemId: "i", branch: "b" }, block)
    assert.equal(args.PRIOR_ATTEMPTS, block)
  })
})

describe("buildMergerRunOptions", () => {
  const baseRef = {
    sha: "abcdef1234567890abcdef1234567890abcdef12",
    refName: "main",
  }
  const mergeBranch = "sandcastle/tmp-merge/42-2026-04-26T12-00-00-000Z-deadbeef0123"
  const issues = [
    { number: 1, title: "feat: alpha", itemId: "PVTI_a", branch: "sandcastle/issue-1" },
    { number: 2, title: "fix: beta", itemId: "PVTI_b", branch: "sandcastle/issue-2" },
  ]

  it("uses a named-branch strategy forked from baseRef.sha", () => {
    const opts = buildMergerRunOptions({ issues, baseRef, mergeBranch })
    assert.deepEqual(opts.branchStrategy, {
      type: "branch",
      branch: mergeBranch,
      baseBranch: baseRef.sha,
    })
  })

  it("populates BASE_LABEL from the formatted baseRef", () => {
    const opts = buildMergerRunOptions({ issues, baseRef, mergeBranch })
    assert.equal(opts.promptArgs?.BASE_LABEL, "main (abcdef1)")
  })

  it("includes BRANCH_LIST and ISSUE_LIST in promptArgs", () => {
    const opts = buildMergerRunOptions({ issues, baseRef, mergeBranch })
    assert.equal(opts.promptArgs?.BRANCH_LIST, "- sandcastle/issue-1\n- sandcastle/issue-2")
    assert.equal(opts.promptArgs?.ISSUE_LIST, "- #1: feat: alpha\n- #2: fix: beta")
  })

  it("defaults PRIOR_ATTEMPTS to empty string", () => {
    const opts = buildMergerRunOptions({ issues, baseRef, mergeBranch })
    assert.equal(opts.promptArgs?.PRIOR_ATTEMPTS, "")
  })

  it("threads priorAttempts through", () => {
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      priorAttempts: "attempt #2 failed",
    })
    assert.equal(opts.promptArgs?.PRIOR_ATTEMPTS, "attempt #2 failed")
  })

  it("handles empty issues array (produces empty BRANCH_LIST and ISSUE_LIST)", () => {
    const opts = buildMergerRunOptions({ issues: [], baseRef, mergeBranch })
    assert.equal(opts.promptArgs?.BRANCH_LIST, "")
    assert.equal(opts.promptArgs?.ISSUE_LIST, "")
  })

  it("existing issue-list and branch-list assertions still pass with single issue", () => {
    const opts = buildMergerRunOptions({
      issues: [{ number: 99, title: "chore: cleanup", itemId: "X", branch: "sandcastle/issue-99" }],
      baseRef,
      mergeBranch,
    })
    assert.equal(opts.promptArgs?.BRANCH_LIST, "- sandcastle/issue-99")
    assert.equal(opts.promptArgs?.ISSUE_LIST, "- #99: chore: cleanup")
  })
})
