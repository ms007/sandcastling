import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import { parseImplementerResult, parseReviewerVerdict } from "../manager/result.ts"

describe("parseReviewerVerdict", () => {
  it("parses verdict: approved", () => {
    const v = parseReviewerVerdict("output <verdict>approved</verdict> trailing")
    assert.equal(v.tag, "approved")
  })

  it("parses verdict: rework with reason after colon", () => {
    const v = parseReviewerVerdict("<verdict>rework: the tests are failing</verdict>")
    assert.equal(v.tag, "rework")
    if (v.tag === "rework") assert.equal(v.reason, "the tests are failing")
  })

  it("parses verdict: rework with reason after space", () => {
    const v = parseReviewerVerdict("<verdict>rework needs more tests</verdict>")
    assert.equal(v.tag, "rework")
    if (v.tag === "rework") assert.equal(v.reason, "needs more tests")
  })

  it("parses verdict: rework with no reason", () => {
    const v = parseReviewerVerdict("<verdict>rework</verdict>")
    assert.equal(v.tag, "rework")
    if (v.tag === "rework") assert.equal(v.reason, "No reason provided")
  })

  it("parses verdict: rework with em dash separator", () => {
    const v = parseReviewerVerdict("<verdict>rework — missing edge case</verdict>")
    assert.equal(v.tag, "rework")
    if (v.tag === "rework") assert.equal(v.reason, "missing edge case")
  })

  it("handles multi-line verdict content", () => {
    const stdout = `<verdict>
rework: line one
line two
</verdict>`
    const v = parseReviewerVerdict(stdout)
    assert.equal(v.tag, "rework")
    if (v.tag === "rework") assert.equal(v.reason, "line one\nline two")
  })

  it("falls back to approved when tag is missing", () => {
    const v = parseReviewerVerdict("no verdict tag here")
    assert.equal(v.tag, "approved")
  })

  it("falls back to approved when tag content is malformed", () => {
    const v = parseReviewerVerdict("<verdict>maybe later</verdict>")
    assert.equal(v.tag, "approved")
  })

  it("falls back to approved for empty stdout", () => {
    const v = parseReviewerVerdict("")
    assert.equal(v.tag, "approved")
  })

  it("uses first verdict tag when multiple are present", () => {
    const v = parseReviewerVerdict(
      "<verdict>rework: first reason</verdict> <verdict>approved</verdict>",
    )
    assert.equal(v.tag, "rework")
    if (v.tag === "rework") assert.equal(v.reason, "first reason")
  })

  it("falls back to approved for whitespace-only verdict content", () => {
    const v = parseReviewerVerdict("<verdict>   \n  </verdict>")
    assert.equal(v.tag, "approved")
  })

  it("trims whitespace around approved", () => {
    const v = parseReviewerVerdict("<verdict>  approved  </verdict>")
    assert.equal(v.tag, "approved")
  })

  it("trims whitespace around rework keyword", () => {
    const v = parseReviewerVerdict("<verdict>  rework: fix the tests  </verdict>")
    assert.equal(v.tag, "rework")
    if (v.tag === "rework") assert.equal(v.reason, "fix the tests")
  })

  it("falls back to approved for empty verdict tag", () => {
    const v = parseReviewerVerdict("<verdict></verdict>")
    assert.equal(v.tag, "approved")
  })
})

describe("parseImplementerResult", () => {
  it("returns ok for successful result", () => {
    const r = parseImplementerResult("output <result>ok</result> trailing")
    assert.equal(r.tag, "ok")
  })

  it("returns ok when no result tag is present", () => {
    const r = parseImplementerResult("no result tag here")
    assert.equal(r.tag, "ok")
  })

  it("returns ok for empty stdout", () => {
    const r = parseImplementerResult("")
    assert.equal(r.tag, "ok")
  })

  it("parses failed with reason after colon", () => {
    const r = parseImplementerResult("<result>failed: missing dependency</result>")
    assert.equal(r.tag, "failed")
    if (r.tag === "failed") assert.equal(r.reason, "missing dependency")
  })

  it("parses CROSS_BRANCH_DEPENDENCY failure verdict", () => {
    const r = parseImplementerResult(
      "<result>failed: CROSS_BRANCH_DEPENDENCY: needs types from sandcastle/issue-5</result>",
    )
    assert.equal(r.tag, "failed")
    if (r.tag === "failed") {
      assert.equal(r.reason, "CROSS_BRANCH_DEPENDENCY: needs types from sandcastle/issue-5")
    }
  })

  it("parses failed with no reason", () => {
    const r = parseImplementerResult("<result>failed</result>")
    assert.equal(r.tag, "failed")
    if (r.tag === "failed") assert.equal(r.reason, "No reason provided")
  })

  it("returns ok for empty result tag", () => {
    const r = parseImplementerResult("<result></result>")
    assert.equal(r.tag, "ok")
  })

  it("returns ok for whitespace-only result content", () => {
    const r = parseImplementerResult("<result>   \n  </result>")
    assert.equal(r.tag, "ok")
  })

  it("uses first result tag when multiple are present", () => {
    const r = parseImplementerResult("<result>failed: first</result> <result>ok</result>")
    assert.equal(r.tag, "failed")
    if (r.tag === "failed") assert.equal(r.reason, "first")
  })

  it("handles multi-line failure reason", () => {
    const stdout = `<result>
failed: CROSS_BRANCH_DEPENDENCY: needs code from issue #3
which adds the shared types module
</result>`
    const r = parseImplementerResult(stdout)
    assert.equal(r.tag, "failed")
    if (r.tag === "failed") {
      assert.ok(r.reason.includes("CROSS_BRANCH_DEPENDENCY"))
      assert.ok(r.reason.includes("shared types module"))
    }
  })

  it("parses failed with em dash separator", () => {
    const r = parseImplementerResult("<result>failed — missing dep</result>")
    assert.equal(r.tag, "failed")
    if (r.tag === "failed") assert.equal(r.reason, "missing dep")
  })

  it("parses failed with en dash separator", () => {
    const r = parseImplementerResult("<result>failed – missing dep</result>")
    assert.equal(r.tag, "failed")
    if (r.tag === "failed") assert.equal(r.reason, "missing dep")
  })

  it("parses failed with hyphen separator", () => {
    const r = parseImplementerResult("<result>failed - missing dep</result>")
    assert.equal(r.tag, "failed")
    if (r.tag === "failed") assert.equal(r.reason, "missing dep")
  })

  it("returns 'No reason provided' for failed with only separator", () => {
    const r = parseImplementerResult("<result>failed:</result>")
    assert.equal(r.tag, "failed")
    if (r.tag === "failed") assert.equal(r.reason, "No reason provided")
  })

  it("trims whitespace around failed keyword", () => {
    const r = parseImplementerResult("<result>  failed: reason here  </result>")
    assert.equal(r.tag, "failed")
    if (r.tag === "failed") assert.equal(r.reason, "reason here")
  })

  it("returns ok for capitalized Failed (case-sensitive match)", () => {
    const r = parseImplementerResult("<result>Failed: something</result>")
    assert.equal(r.tag, "ok")
  })

  it("returns ok for non-failed prefix like failure", () => {
    const r = parseImplementerResult("<result>failure mode</result>")
    assert.equal(r.tag, "ok")
  })
})
