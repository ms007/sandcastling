import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import {
  actionIssueAndStage,
  computeObservationHash,
  isStalled,
  stageKey,
} from "../manager/attempts.ts"
import type { Action, Observation } from "../manager/types.ts"
import type { IssueRef } from "../types.ts"

const issue = (n: number): IssueRef => ({
  number: n,
  title: `issue-${n}`,
  itemId: `item-${n}`,
  branch: `sandcastle/issue-${n}`,
})

const baseObs = (overrides?: Partial<Observation>): Observation => ({
  seed: {
    issue: issue(1),
    phase: "claimed",
    isPrd: false,
    aheadOfBase: 0,
    markerComments: [],
    reworkReason: null,
    blockedBy: [],
  },
  children: [],
  tickCount: 0,
  tickCap: 50,
  attemptCap: 100,
  stageAttempts: new Map(),
  prevObservationHash: null,
  prevAction: null,
  ...overrides,
})

describe("stageKey", () => {
  it("formats issue number and stage as colon-separated key", () => {
    assert.equal(stageKey(42, "runImplementer"), "42:runImplementer")
  })

  it("handles different issue numbers and stages", () => {
    assert.equal(stageKey(1, "claimIssue"), "1:claimIssue")
    assert.equal(stageKey(100, "runMerger"), "100:runMerger")
  })
})

describe("computeObservationHash", () => {
  it("produces a deterministic hash for the same observation", () => {
    const obs = baseObs()
    assert.equal(computeObservationHash(obs), computeObservationHash(obs))
  })

  it("differs when seed phase changes", () => {
    const obs1 = baseObs()
    const obs2 = baseObs({
      seed: { ...obs1.seed, phase: "implemented" },
    })
    assert.notEqual(computeObservationHash(obs1), computeObservationHash(obs2))
  })

  it("differs when aheadOfBase changes", () => {
    const obs1 = baseObs()
    const obs2 = baseObs({
      seed: { ...obs1.seed, aheadOfBase: 5 },
    })
    assert.notEqual(computeObservationHash(obs1), computeObservationHash(obs2))
  })

  it("differs when reworkReason changes", () => {
    const obs1 = baseObs()
    const obs2 = baseObs({
      seed: { ...obs1.seed, reworkReason: "needs tests" },
    })
    assert.notEqual(computeObservationHash(obs1), computeObservationHash(obs2))
  })

  it("includes children in the hash", () => {
    const obs1 = baseObs()
    const obs2 = baseObs({
      children: [
        {
          issue: issue(2),
          phase: "todo",
          aheadOfBase: 0,
          markerComments: [],
          reworkReason: null,
          blockedBy: [],
        },
      ],
    })
    assert.notEqual(computeObservationHash(obs1), computeObservationHash(obs2))
  })

  it("does not include tickCount or stageAttempts in hash", () => {
    const obs1 = baseObs()
    const obs2 = baseObs({
      tickCount: 99,
      stageAttempts: new Map([["1:foo", 5]]),
    })
    assert.equal(computeObservationHash(obs1), computeObservationHash(obs2))
  })
})

describe("isStalled", () => {
  it("returns false when prevHash is null (first tick)", () => {
    assert.equal(isStalled(null, null, "hash", { tag: "claimIssue", issue: issue(1) }), false)
  })

  it("returns false when prevAction is null", () => {
    assert.equal(isStalled("hash", null, "hash", { tag: "claimIssue", issue: issue(1) }), false)
  })

  it("returns true when hash and action match", () => {
    const action: Action = { tag: "runImplementer", issue: issue(1) }
    assert.equal(isStalled("h1", action, "h1", action), true)
  })

  it("returns false when hashes differ", () => {
    const action: Action = { tag: "runImplementer", issue: issue(1) }
    assert.equal(isStalled("h1", action, "h2", action), false)
  })

  it("returns false when actions differ", () => {
    const a1: Action = { tag: "runImplementer", issue: issue(1) }
    const a2: Action = { tag: "runImplementer", issue: issue(2) }
    assert.equal(isStalled("h1", a1, "h1", a2), false)
  })

  it("returns false when both hash and action differ", () => {
    const a1: Action = { tag: "claimIssue", issue: issue(1) }
    const a2: Action = { tag: "runImplementer", issue: issue(1) }
    assert.equal(isStalled("h1", a1, "h2", a2), false)
  })
})

describe("actionIssueAndStage", () => {
  it("returns issue and tag for claimIssue", () => {
    const result = actionIssueAndStage({ tag: "claimIssue", issue: issue(1) })
    assert.deepEqual(result, { issue: issue(1), stage: "claimIssue" })
  })

  it("returns issue and tag for runImplementer", () => {
    const result = actionIssueAndStage({
      tag: "runImplementer",
      issue: issue(3),
    })
    assert.deepEqual(result, { issue: issue(3), stage: "runImplementer" })
  })

  it("returns first issue for runMerger with issues", () => {
    const result = actionIssueAndStage({
      tag: "runMerger",
      issues: [issue(1), issue(2)],
    })
    assert.deepEqual(result, { issue: issue(1), stage: "runMerger" })
  })

  it("returns null for runMerger with empty issues", () => {
    const result = actionIssueAndStage({ tag: "runMerger", issues: [] })
    assert.equal(result, null)
  })

  it("returns issue and tag for promoteToReview", () => {
    const result = actionIssueAndStage({
      tag: "promoteToReview",
      issue: issue(5),
    })
    assert.deepEqual(result, { issue: issue(5), stage: "promoteToReview" })
  })

  it("returns issue and tag for applyReworkVerdict", () => {
    const result = actionIssueAndStage({
      tag: "applyReworkVerdict",
      issue: issue(1),
      reason: "fix it",
    })
    assert.deepEqual(result, { issue: issue(1), stage: "applyReworkVerdict" })
  })

  it("returns issue and tag for runReviewer", () => {
    const result = actionIssueAndStage({ tag: "runReviewer", issue: issue(4) })
    assert.deepEqual(result, { issue: issue(4), stage: "runReviewer" })
  })

  it("returns issue and tag for finalizeIssue", () => {
    const result = actionIssueAndStage({
      tag: "finalizeIssue",
      issue: issue(7),
    })
    assert.deepEqual(result, { issue: issue(7), stage: "finalizeIssue" })
  })

  it("returns issue and tag for finalizePrd", () => {
    const result = actionIssueAndStage({
      tag: "finalizePrd",
      issue: issue(10),
    })
    assert.deepEqual(result, { issue: issue(10), stage: "finalizePrd" })
  })
})
