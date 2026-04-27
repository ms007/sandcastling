import { actionIssueAndStage, computeObservationHash, isStalled, stageKey } from "./attempts.ts"
import type { Action, Decision, IssueSnapshot, Observation } from "./types.ts"

export function decide(obs: Observation): Decision {
  if (obs.tickCount >= obs.tickCap) {
    return { tag: "blocked", reason: "tickCap", ticks: obs.tickCount }
  }

  const core = obs.seed.isPrd ? decidePrd(obs) : decideLeaf(obs)
  if (core.tag !== "act") return core

  const target = actionIssueAndStage(core.action)
  if (!target) return core

  const currHash = computeObservationHash(obs)
  if (isStalled(obs.prevObservationHash, obs.prevAction, currHash, core.action)) {
    return { tag: "blocked", reason: "stalled", issue: target.issue, stage: target.stage }
  }

  const attempts = obs.stageAttempts.get(stageKey(target.issue.number, target.stage)) ?? 0
  if (attempts >= obs.attemptCap) {
    return {
      tag: "blocked",
      reason: "tooManyAttempts",
      issue: target.issue,
      stage: target.stage,
      attempts,
    }
  }

  return core
}

function decideLeaf(obs: Observation): Decision {
  const next = nextIssueAction(obs.seed)
  if (next) return { tag: "act", action: next }

  if (obs.seed.phase === "reviewed") {
    return {
      tag: "act",
      action: { tag: "runMerger", issues: [obs.seed.issue] },
    }
  }

  if (obs.seed.phase === "merged") {
    return {
      tag: "act",
      action: { tag: "finalizeIssue", issue: obs.seed.issue },
    }
  }

  return { tag: "done" }
}

function decidePrd(obs: Observation): Decision {
  const waveAssignments = assignWaves(obs.children)

  const mergedChild = obs.children.find((c) => c.phase === "merged")
  if (mergedChild) {
    return actWithWave(
      { tag: "finalizeIssue", issue: mergedChild.issue },
      mergedChild.issue.number,
      waveAssignments,
    )
  }

  const wave = computeWave(obs.children)

  const childAction = nextChildAction(wave)
  if (childAction) {
    const target =
      childAction.tag === "runMerger" ? childAction.issues[0]?.number : childAction.issue.number
    return actWithWave(childAction, target, waveAssignments)
  }

  if (wave.length > 0 && wave.every((c) => c.phase === "reviewed")) {
    return actWithWave(
      { tag: "runMerger", issues: wave.map((c) => c.issue) },
      wave[0]?.issue.number,
      waveAssignments,
    )
  }

  if (
    obs.children.length > 0 &&
    obs.children.every((c) => c.phase === "done") &&
    obs.seed.phase !== "done"
  ) {
    return {
      tag: "act",
      action: { tag: "finalizePrd", issue: obs.seed.issue },
    }
  }

  return { tag: "done" }
}

function computeWave(children: readonly IssueSnapshot[]): readonly IssueSnapshot[] {
  const childNumbers = new Set(children.map((c) => c.issue.number))
  const doneNumbers = new Set(children.filter((c) => c.phase === "done").map((c) => c.issue.number))
  return children.filter((child) => {
    if (child.phase === "done") return false
    const internalBlockers = child.blockedBy.filter((b) => childNumbers.has(b))
    return internalBlockers.every((b) => doneNumbers.has(b))
  })
}

function nextChildAction(children: readonly IssueSnapshot[]): Action | null {
  for (const child of children) {
    const action = nextIssueAction(child)
    if (action) return action
  }
  return null
}

function nextIssueAction(snapshot: IssueSnapshot): Action | null {
  switch (snapshot.phase) {
    case "todo":
      return { tag: "claimIssue", issue: snapshot.issue }
    case "claimed":
      return { tag: "runImplementer", issue: snapshot.issue }
    case "implemented":
      return { tag: "promoteToReview", issue: snapshot.issue }
    case "promoted":
      return { tag: "runReviewer", issue: snapshot.issue }
    case "reviewedRework":
      return {
        tag: "applyReworkVerdict",
        issue: snapshot.issue,
        reason: snapshot.reworkReason ?? "No reason provided",
      }
    default:
      return null
  }
}

function assignWaves(children: readonly IssueSnapshot[]): ReadonlyMap<number, number> {
  const childNumbers = new Set(children.map((c) => c.issue.number))
  const result = new Map<number, number>()
  let index = 0
  for (;;) {
    const layer = children.filter((child) => {
      if (result.has(child.issue.number)) return false
      const internalBlockers = child.blockedBy.filter((b) => childNumbers.has(b))
      return internalBlockers.every((b) => result.has(b))
    })
    if (layer.length === 0) break
    for (const child of layer) {
      result.set(child.issue.number, index)
    }
    index++
  }
  return result
}

function actWithWave(
  action: Action,
  targetNumber: number | undefined,
  assignments: ReadonlyMap<number, number>,
): Decision {
  if (targetNumber === undefined) return { tag: "act", action }
  const index = assignments.get(targetNumber)
  if (index === undefined) return { tag: "act", action }
  const issues = [...assignments.entries()]
    .filter(([, i]) => i === index)
    .map(([n]) => n)
    .sort((a, b) => a - b)
  return { tag: "act", action, wave: { index, issues } }
}
