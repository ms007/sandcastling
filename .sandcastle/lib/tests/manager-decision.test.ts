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
  blockedBy: readonly number[] = [],
): IssueSnapshot => ({
  issue: issue(n),
  phase,
  aheadOfBase,
  markerComments: [],
  reworkReason,
  blockedBy,
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

describe("decide — wave-aware PRD", () => {
  const wavePrdObs = (
    children: IssueSnapshot[],
    seedPhase: IssueSnapshot["phase"] = "todo",
  ): Observation => ({
    seed: { ...snapshot(100, seedPhase), isPrd: true },
    children,
    tickCount: 0,
    tickCap: 50,
    ...defaultProtection,
  })

  it("child blocked by unfinished sibling is not picked up", () => {
    const d = decide(wavePrdObs([snapshot(1, "todo"), snapshot(2, "todo", 0, null, [1])]))
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "claimIssue")
      if (d.action.tag === "claimIssue") assert.equal(d.action.issue.number, 1)
    }
  })

  it("child blocked only by landed sibling is picked up", () => {
    const d = decide(wavePrdObs([snapshot(1, "done"), snapshot(2, "todo", 0, null, [1])]))
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "claimIssue")
      if (d.action.tag === "claimIssue") assert.equal(d.action.issue.number, 2)
    }
  })

  it("child blocked only by issue outside the PRD is picked up (external blockers ignored)", () => {
    const d = decide(wavePrdObs([snapshot(1, "todo", 0, null, [999])]))
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "claimIssue")
      if (d.action.tag === "claimIssue") assert.equal(d.action.issue.number, 1)
    }
  })

  it("runMerger emitted with wave issue set, not full children list", () => {
    const d = decide(
      wavePrdObs([
        snapshot(1, "done"),
        snapshot(2, "reviewed", 0, null, [1]),
        snapshot(3, "reviewed", 0, null, [1]),
      ]),
    )
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "runMerger")
      if (d.action.tag === "runMerger") {
        assert.deepEqual(
          d.action.issues.map((i) => i.number),
          [2, 3],
        )
      }
    }
  })

  it("next wave is emitted after all previous wave members reach done", () => {
    const d = decide(
      wavePrdObs([
        snapshot(1, "done"),
        snapshot(2, "done", 0, null, [1]),
        snapshot(3, "todo", 0, null, [2]),
      ]),
    )
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "claimIssue")
      if (d.action.tag === "claimIssue") assert.equal(d.action.issue.number, 3)
    }
  })

  it("child blocked by multiple siblings requires all to be done", () => {
    const d = decide(
      wavePrdObs([
        snapshot(1, "done"),
        snapshot(2, "claimed"),
        snapshot(3, "todo", 0, null, [1, 2]),
      ]),
    )
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "runImplementer")
      if (d.action.tag === "runImplementer") assert.equal(d.action.issue.number, 2)
    }
  })

  it("diamond dependency — third wave waits for both parents", () => {
    // A(1) → B(2), C(3) → D(4)  (D blocked by both B and C)
    const d = decide(
      wavePrdObs([
        snapshot(1, "done"),
        snapshot(2, "done", 0, null, [1]),
        snapshot(3, "reviewed", 0, null, [1]),
        snapshot(4, "todo", 0, null, [2, 3]),
      ]),
    )
    // C(3) is reviewed and in the current wave; D(4) is blocked by C (not done)
    // wave = [3], all reviewed → runMerger([3])
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "runMerger")
      if (d.action.tag === "runMerger") {
        assert.deepEqual(
          d.action.issues.map((i) => i.number),
          [3],
        )
      }
    }
  })

  it("empty wave with non-done children returns done (circular dep degeneracy)", () => {
    // A blocks B, B blocks A — neither can enter the wave
    const d = decide(
      wavePrdObs([snapshot(1, "todo", 0, null, [2]), snapshot(2, "todo", 0, null, [1])]),
    )
    assert.equal(d.tag, "done")
  })

  it("all children done triggers finalizePrd regardless of blockers", () => {
    const d = decide(
      wavePrdObs([snapshot(1, "done", 0, null, [2]), snapshot(2, "done", 0, null, [1])]),
    )
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "finalizePrd")
    }
  })

  it("self-blocked child is excluded from the wave (treated like a cycle)", () => {
    const d = decide(wavePrdObs([snapshot(1, "todo", 0, null, [1])]))
    assert.equal(d.tag, "done")
  })

  it("merged child is finalized before wave children are advanced", () => {
    const d = decide(wavePrdObs([snapshot(1, "merged"), snapshot(2, "todo")]))
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "finalizeIssue")
      if (d.action.tag === "finalizeIssue") assert.equal(d.action.issue.number, 1)
    }
  })
})

describe("decide — wave annotations", () => {
  const wavePrdObs = (
    children: IssueSnapshot[],
    seedPhase: IssueSnapshot["phase"] = "todo",
  ): Observation => ({
    seed: { ...snapshot(100, seedPhase), isPrd: true },
    children,
    tickCount: 0,
    tickCap: 50,
    ...defaultProtection,
  })

  it("wave-0 action carries index 0 and its issue set", () => {
    const d = decide(wavePrdObs([snapshot(1, "todo"), snapshot(2, "todo", 0, null, [1])]))
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.deepEqual(d.wave, { index: 0, issues: [1] })
    }
  })

  it("wave-1 action carries index 1 after wave-0 is done", () => {
    const d = decide(wavePrdObs([snapshot(1, "done"), snapshot(2, "todo", 0, null, [1])]))
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.deepEqual(d.wave, { index: 1, issues: [2] })
    }
  })

  it("flat PRD (no blockers) assigns all children to wave 0", () => {
    const d = decide(
      wavePrdObs([snapshot(1, "todo"), snapshot(2, "reviewed"), snapshot(3, "claimed")]),
    )
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.wave?.index, 0)
      assert.deepEqual(d.wave?.issues, [1, 2, 3])
    }
  })

  it("three-wave chain annotates each layer correctly", () => {
    const d1 = decide(
      wavePrdObs([
        snapshot(1, "todo"),
        snapshot(2, "todo", 0, null, [1]),
        snapshot(3, "todo", 0, null, [2]),
      ]),
    )
    assert.equal(d1.tag, "act")
    if (d1.tag === "act") assert.deepEqual(d1.wave, { index: 0, issues: [1] })

    const d2 = decide(
      wavePrdObs([
        snapshot(1, "done"),
        snapshot(2, "todo", 0, null, [1]),
        snapshot(3, "todo", 0, null, [2]),
      ]),
    )
    assert.equal(d2.tag, "act")
    if (d2.tag === "act") assert.deepEqual(d2.wave, { index: 1, issues: [2] })

    const d3 = decide(
      wavePrdObs([
        snapshot(1, "done"),
        snapshot(2, "done", 0, null, [1]),
        snapshot(3, "todo", 0, null, [2]),
      ]),
    )
    assert.equal(d3.tag, "act")
    if (d3.tag === "act") assert.deepEqual(d3.wave, { index: 2, issues: [3] })
  })

  it("finalizePrd does not carry a wave annotation", () => {
    const d = decide(wavePrdObs([snapshot(1, "done")], "todo"))
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "finalizePrd")
      assert.equal(d.wave, undefined)
    }
  })

  it("leaf issue decision does not carry a wave annotation", () => {
    const d = decide(singleObs("todo"))
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.wave, undefined)
    }
  })

  it("merged child finalization carries its original wave index", () => {
    const d = decide(
      wavePrdObs([
        snapshot(1, "done"),
        snapshot(2, "merged", 0, null, [1]),
        snapshot(3, "merged", 0, null, [1]),
      ]),
    )
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "finalizeIssue")
      assert.deepEqual(d.wave, { index: 1, issues: [2, 3] })
    }
  })

  it("runMerger for wave-1 issues includes wave annotation", () => {
    const d = decide(
      wavePrdObs([
        snapshot(1, "done"),
        snapshot(2, "reviewed", 0, null, [1]),
        snapshot(3, "reviewed", 0, null, [1]),
      ]),
    )
    assert.equal(d.tag, "act")
    if (d.tag === "act") {
      assert.equal(d.action.tag, "runMerger")
      assert.deepEqual(d.wave, { index: 1, issues: [2, 3] })
    }
  })
})
