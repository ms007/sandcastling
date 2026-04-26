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
  const childAction = nextChildAction(obs.children)
  if (childAction) return { tag: "act", action: childAction }

  if (obs.children.length > 0 && obs.children.every((c) => c.phase === "reviewed")) {
    return {
      tag: "act",
      action: { tag: "runMerger", issues: obs.children.map((c) => c.issue) },
    }
  }

  const mergedChild = obs.children.find((c) => c.phase === "merged")
  if (mergedChild) {
    return {
      tag: "act",
      action: { tag: "finalizeIssue", issue: mergedChild.issue },
    }
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
