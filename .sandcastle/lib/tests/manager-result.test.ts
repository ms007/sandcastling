import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import { parseReviewerVerdict } from "../manager/result.ts"

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
