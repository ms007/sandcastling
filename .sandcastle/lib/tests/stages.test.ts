import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import { __testing } from "../stages.ts"

const { issuePromptArgs } = __testing

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
