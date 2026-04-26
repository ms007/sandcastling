import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import { computeObservationHash } from "../manager/attempts.ts"
import { decide } from "../manager/decision.ts"
import type { IssueSnapshot, Observation } from "../manager/types.ts"
import type { IssueRef } from "../types.ts"

const issue = (n: number): IssueRef => ({
  number: n,
  title: `issue-${n}`,
  itemId: `item-${n}`,
  branch: `sandcastle/issue-${n}`,
})

const snapshot = (
  n: number,
  phase: IssueSnapshot["phase"],
  aheadOfBase = 0,
  reworkReason: string | null = null,
): IssueSnapshot => ({
  issue: issue(n),
  phase,
  aheadOfBase,
  markerComments: [],
  reworkReason,
})

const defaultProtection = {
  attemptCap: 100,
  stageAttempts: new Map<string, number>(),
  prevObservationHash: null,
  prevAction: null,
} as const

const leafObs = (phase: IssueSnapshot["phase"], tickCount = 0, tickCap = 50): Observation => ({
  seed: { ...snapshot(1, phase), isPrd: true },
  children: [],
  tickCount,
  tickCap,
  ...defaultProtection,
})

const singleObs = (phase: IssueSnapshot["phase"], tickCount = 0, tickCap = 50): Observation => ({
  seed: { ...snapshot(1, phase), isPrd: false },
  children: [],
  tickCount,
  tickCap,
  ...defaultProtection,
})

describe("decide — single leaf issue", () => {
  it("todo → claimIssue", () => {
    const d = decide(singleObs("todo"))
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "claimIssue")
      if (d.action.tag === "claimIssue") assert.equal(d.action.issue.number, 1)
    }
  })

  it("claimed → runImplementer", () => {
    const d = decide(singleObs("claimed"))
    assert.equal(d.tag, "act")
    if (d.tag === "act") assert.equal(d.action.tag, "runImplementer")
  })

  it("implemented → promoteToReview", () => {
    const d = decide(singleObs("implemented"))
    assert.equal(d.tag, "act")
    if (d.tag === "act") assert.equal(d.action.tag, "promoteToReview")
  })

  it("promoted → runReviewer", () => {
    const d = decide(singleObs("promoted"))
    assert.equal(d.tag, "act")
    if (d.tag === "act") assert.equal(d.action.tag, "runReviewer")
  })

  it("reviewed → runMerger with the single issue", () => {
    const d = decide(singleObs("reviewed"))
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "runMerger")
      if (d.action.tag === "runMerger") {
        assert.equal(d.action.issues.length, 1)
        assert.equal(d.action.issues[0]?.number, 1)
      }
    }
  })

  it("merged → finalizeIssue", () => {
    const d = decide(singleObs("merged"))
    assert.equal(d.tag, "act")
    if (d.tag === "act") assert.equal(d.action.tag, "finalizeIssue")
  })

  it("done → done", () => {
    assert.equal(decide(singleObs("done")).tag, "done")
  })
})

describe("decide — reviewedRework", () => {
  it("reviewedRework → applyReworkVerdict with reason from snapshot", () => {
    const obs: Observation = {
      seed: {
        ...snapshot(1, "reviewedRework", 0, "tests are failing"),
        isPrd: false,
      },
      children: [],
      tickCount: 0,
      tickCap: 50,
      ...defaultProtection,
    }
    const d = decide(obs)
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "applyReworkVerdict")
      if (d.action.tag === "applyReworkVerdict") {
        assert.equal(d.action.issue.number, 1)
        assert.equal(d.action.reason, "tests are failing")
      }
    }
  })

  it("reviewedRework with null reason uses fallback", () => {
    const obs: Observation = {
      seed: { ...snapshot(1, "reviewedRework"), isPrd: false },
      children: [],
      tickCount: 0,
      tickCap: 50,
      ...defaultProtection,
    }
    const d = decide(obs)
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "applyReworkVerdict")
      if (d.action.tag === "applyReworkVerdict") {
        assert.equal(d.action.reason, "No reason provided")
      }
    }
  })

  it("PRD child in reviewedRework → applyReworkVerdict before merger", () => {
    const obs: Observation = {
      seed: { ...snapshot(100, "todo"), isPrd: true },
      children: [
        snapshot(1, "reviewed"),
        snapshot(2, "reviewedRework", 0, "missing edge case"),
        snapshot(3, "reviewed"),
      ],
      tickCount: 0,
      tickCap: 50,
      ...defaultProtection,
    }
    const d = decide(obs)
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "applyReworkVerdict")
      if (d.action.tag === "applyReworkVerdict") {
        assert.equal(d.action.issue.number, 2)
        assert.equal(d.action.reason, "missing edge case")
      }
    }
  })
})

describe("decide — tick cap", () => {
  it("returns blocked when tickCount >= tickCap", () => {
    const d = decide(singleObs("todo", 10, 10))
    assert.equal(d.tag, "blocked")
    if (d.tag === "blocked") {
      assert.equal(d.reason, "tickCap")
      if (d.reason === "tickCap") assert.equal(d.ticks, 10)
    }
  })

  it("returns blocked when tickCap is 0", () => {
    const d = decide(singleObs("todo", 0, 0))
    assert.equal(d.tag, "blocked")
    if (d.tag === "blocked") {
      assert.equal(d.reason, "tickCap")
      if (d.reason === "tickCap") assert.equal(d.ticks, 0)
    }
  })

  it("allows action when tickCount < tickCap", () => {
    const d = decide(singleObs("todo", 9, 10))
    assert.equal(d.tag, "act")
  })

  it("returns blocked for PRD path when tickCount >= tickCap", () => {
    const obs: Observation = {
      seed: { ...snapshot(100, "todo"), isPrd: true },
      children: [snapshot(1, "todo")],
      tickCount: 5,
      tickCap: 5,
      ...defaultProtection,
    }
    const d = decide(obs)
    assert.equal(d.tag, "blocked")
    if (d.tag === "blocked") assert.equal(d.reason, "tickCap")
  })
})

describe("decide — PRD with children", () => {
  const prdObs = (
    childPhases: IssueSnapshot["phase"][],
    seedPhase: IssueSnapshot["phase"] = "todo",
    tickCount = 0,
    tickCap = 50,
  ): Observation => ({
    seed: { ...snapshot(100, seedPhase), isPrd: true },
    children: childPhases.map((phase, i) => snapshot(i + 1, phase)),
    tickCount,
    tickCap,
    ...defaultProtection,
  })

  it("picks first todo child → claimIssue", () => {
    const d = decide(prdObs(["todo", "todo", "todo"]))
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "claimIssue")
      if (d.action.tag === "claimIssue") assert.equal(d.action.issue.number, 1)
    }
  })

  it("advances first incomplete child before touching later ones", () => {
    const d = decide(prdObs(["claimed", "todo", "todo"]))
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "runImplementer")
      if (d.action.tag === "runImplementer") assert.equal(d.action.issue.number, 1)
    }
  })

  it("moves to second child once first is reviewed", () => {
    const d = decide(prdObs(["reviewed", "todo", "todo"]))
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "claimIssue")
      if (d.action.tag === "claimIssue") assert.equal(d.action.issue.number, 2)
    }
  })

  it("all reviewed → runMerger bundling all children", () => {
    const d = decide(prdObs(["reviewed", "reviewed", "reviewed"]))
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "runMerger")
      if (d.action.tag === "runMerger") {
        assert.equal(d.action.issues.length, 3)
        assert.deepEqual(
          d.action.issues.map((i) => i.number),
          [1, 2, 3],
        )
      }
    }
  })

  it("merged child → finalizeIssue (first merged)", () => {
    const d = decide(prdObs(["merged", "merged", "merged"]))
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "finalizeIssue")
      if (d.action.tag === "finalizeIssue") assert.equal(d.action.issue.number, 1)
    }
  })

  it("all children done, seed not done → finalizePrd", () => {
    const d = decide(prdObs(["done", "done", "done"], "todo"))
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "finalizePrd")
      if (d.action.tag === "finalizePrd") assert.equal(d.action.issue.number, 100)
    }
  })

  it("all children done + seed done → done", () => {
    assert.equal(decide(prdObs(["done", "done", "done"], "done")).tag, "done")
  })

  it("PRD with no children and seed not done → done (degenerate case)", () => {
    assert.equal(decide(leafObs("todo")).tag, "done")
  })
})

describe("decide — stalled detection", () => {
  it("returns blocked stalled when same observation hash and same action repeat", () => {
    const action = { tag: "runImplementer" as const, issue: issue(1) }
    const obs: Observation = {
      seed: { ...snapshot(1, "claimed"), isPrd: false },
      children: [],
      tickCount: 2,
      tickCap: 50,
      attemptCap: 100,
      stageAttempts: new Map(),
      prevObservationHash: null,
      prevAction: null,
    }
    const hash = computeObservationHash(obs)

    const stalledObs: Observation = {
      ...obs,
      prevObservationHash: hash,
      prevAction: action,
    }
    const d = decide(stalledObs)
    assert.equal(d.tag, "blocked")
    if (d.tag === "blocked") {
      assert.equal(d.reason, "stalled")
      if (d.reason === "stalled") {
        assert.equal(d.issue.number, 1)
        assert.equal(d.stage, "runImplementer")
      }
    }
  })

  it("does not stall when observation hash differs", () => {
    const action = { tag: "runImplementer" as const, issue: issue(1) }
    const obs: Observation = {
      seed: { ...snapshot(1, "claimed"), isPrd: false },
      children: [],
      tickCount: 2,
      tickCap: 50,
      attemptCap: 100,
      stageAttempts: new Map(),
      prevObservationHash: "different-hash",
      prevAction: action,
    }
    const d = decide(obs)
    assert.equal(d.tag, "act")
  })

  it("does not stall on the first tick (no previous hash/action)", () => {
    const obs: Observation = {
      seed: { ...snapshot(1, "claimed"), isPrd: false },
      children: [],
      tickCount: 0,
      tickCap: 50,
      attemptCap: 100,
      stageAttempts: new Map(),
      prevObservationHash: null,
      prevAction: null,
    }
    const d = decide(obs)
    assert.equal(d.tag, "act")
  })

  it("detects stalled on PRD child action", () => {
    const childAction = { tag: "claimIssue" as const, issue: issue(1) }
    const obs: Observation = {
      seed: { ...snapshot(100, "todo"), isPrd: true },
      children: [snapshot(1, "todo")],
      tickCount: 2,
      tickCap: 50,
      attemptCap: 100,
      stageAttempts: new Map(),
      prevObservationHash: null,
      prevAction: null,
    }
    const hash = computeObservationHash(obs)
    const stalledObs: Observation = {
      ...obs,
      prevObservationHash: hash,
      prevAction: childAction,
    }
    const d = decide(stalledObs)
    assert.equal(d.tag, "blocked")
    if (d.tag === "blocked") {
      assert.equal(d.reason, "stalled")
      if (d.reason === "stalled") {
        assert.equal(d.issue.number, 1)
        assert.equal(d.stage, "claimIssue")
      }
    }
  })
})

describe("decide — tooManyAttempts", () => {
  it("returns blocked tooManyAttempts when stage attempt cap is reached", () => {
    const obs: Observation = {
      seed: { ...snapshot(1, "claimed"), isPrd: false },
      children: [],
      tickCount: 5,
      tickCap: 50,
      attemptCap: 3,
      stageAttempts: new Map([["1:runImplementer", 3]]),
      prevObservationHash: null,
      prevAction: null,
    }
    const d = decide(obs)
    assert.equal(d.tag, "blocked")
    if (d.tag === "blocked") {
      assert.equal(d.reason, "tooManyAttempts")
      if (d.reason === "tooManyAttempts") {
        assert.equal(d.issue.number, 1)
        assert.equal(d.stage, "runImplementer")
        assert.equal(d.attempts, 3)
      }
    }
  })

  it("allows action when attempts are below the cap", () => {
    const obs: Observation = {
      seed: { ...snapshot(1, "claimed"), isPrd: false },
      children: [],
      tickCount: 5,
      tickCap: 50,
      attemptCap: 3,
      stageAttempts: new Map([["1:runImplementer", 2]]),
      prevObservationHash: null,
      prevAction: null,
    }
    const d = decide(obs)
    assert.equal(d.tag, "act")
  })

  it("blocks immediately with attemptCap 0", () => {
    const obs: Observation = {
      seed: { ...snapshot(1, "todo"), isPrd: false },
      children: [],
      tickCount: 0,
      tickCap: 50,
      attemptCap: 0,
      stageAttempts: new Map(),
      prevObservationHash: null,
      prevAction: null,
    }
    const d = decide(obs)
    assert.equal(d.tag, "blocked")
    if (d.tag === "blocked") {
      assert.equal(d.reason, "tooManyAttempts")
      if (d.reason === "tooManyAttempts") {
        assert.equal(d.attempts, 0)
      }
    }
  })

  it("tickCap takes priority over tooManyAttempts", () => {
    const obs: Observation = {
      seed: { ...snapshot(1, "claimed"), isPrd: false },
      children: [],
      tickCount: 50,
      tickCap: 50,
      attemptCap: 3,
      stageAttempts: new Map([["1:runImplementer", 5]]),
      prevObservationHash: null,
      prevAction: null,
    }
    const d = decide(obs)
    assert.equal(d.tag, "blocked")
    if (d.tag === "blocked") {
      assert.equal(d.reason, "tickCap")
    }
  })
})
