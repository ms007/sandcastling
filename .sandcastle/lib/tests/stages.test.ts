import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import { __testing, parsePlannerOutput } from "../stages.ts"

const { issuePromptArgs } = __testing

describe("parsePlannerOutput", () => {
  it("returns the issue list from a valid <plan> tag", () => {
    const stdout = `prose before
<plan>
{
  "issues": [
    { "number": 7, "title": "x", "itemId": "PVTI_a", "branch": "sandcastle/issue-7" }
  ]
}
</plan>
prose after`
    const issues = parsePlannerOutput(stdout, 1)
    assert.equal(issues.length, 1)
    const first = issues[0]
    assert.ok(first)
    assert.equal(first.number, 7)
    assert.equal(first.title, "x")
    assert.equal(first.itemId, "PVTI_a")
    assert.equal(first.branch, "sandcastle/issue-7")
  })

  it("throws on iteration 1 when no <plan> tag is present", () => {
    assert.throws(
      () => parsePlannerOutput("no plan here", 1),
      /Planner did not produce a <plan> tag/,
    )
  })

  it("returns an empty array on iteration > 1 when no <plan> tag is present (planner is done)", () => {
    assert.deepEqual(parsePlannerOutput("no plan here", 2), [])
    assert.deepEqual(parsePlannerOutput("no plan here", 99), [])
  })

  it("throws on iteration 1 when the issue list is empty", () => {
    assert.throws(
      () => parsePlannerOutput(`<plan>{"issues": []}</plan>`, 1),
      /Planner returned an empty issue list on first run/,
    )
  })

  it("returns empty array on iteration > 1 when the issue list is empty", () => {
    assert.deepEqual(parsePlannerOutput(`<plan>{"issues": []}</plan>`, 5), [])
  })

  it("includes the original stdout in the missing-tag error to aid debugging", () => {
    const stdout = "the agent rambled here without producing a plan tag"
    assert.throws(() => parsePlannerOutput(stdout, 1), new RegExp(stdout))
  })

  it("matches the first <plan> tag if (in error) multiple are produced", () => {
    const stdout =
      `<plan>{"issues":[{"number":1,"title":"a","itemId":"i","branch":"b"}]}</plan>` +
      `<plan>{"issues":[{"number":2,"title":"a","itemId":"i","branch":"b"}]}</plan>`
    const issues = parsePlannerOutput(stdout, 1)
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.number, 1)
  })

  it("handles multi-line JSON inside the plan tag", () => {
    const stdout = `<plan>
{
  "issues": [
    { "number": 1, "title": "t", "itemId": "i", "branch": "b" },
    { "number": 2, "title": "u", "itemId": "j", "branch": "c" }
  ]
}
</plan>`
    const issues = parsePlannerOutput(stdout, 1)
    assert.equal(issues.length, 2)
    assert.equal(issues[1]?.number, 2)
  })

  it("rethrows JSON parse errors when the plan tag contents are malformed", () => {
    assert.throws(
      () => parsePlannerOutput("<plan>{not json}</plan>", 1),
      (err) => err instanceof SyntaxError,
    )
  })
})

describe("issuePromptArgs", () => {
  it("returns the four prompt-template fields", () => {
    const args = issuePromptArgs({
      number: 42,
      title: "feat: foo",
      itemId: "PVTI_xyz",
      branch: "sandcastle/issue-42",
    })
    assert.deepEqual(args, {
      ISSUE_NUMBER: "42",
      ISSUE_TITLE: "feat: foo",
      ITEM_ID: "PVTI_xyz",
      BRANCH: "sandcastle/issue-42",
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
})
