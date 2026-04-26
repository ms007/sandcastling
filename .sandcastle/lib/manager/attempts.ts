import type { IssueRef } from "../types.ts"
import type { Action, IssueSnapshot, Observation } from "./types.ts"

export function stageKey(issueNumber: number, stage: Action["tag"]): string {
  return `${issueNumber}:${stage}`
}

const hashCache = new WeakMap<Observation, string>()

export function computeObservationHash(obs: Observation): string {
  const cached = hashCache.get(obs)
  if (cached !== undefined) return cached
  const hash = JSON.stringify({
    seed: snapshotHash(obs.seed),
    children: obs.children.map(snapshotHash),
  })
  hashCache.set(obs, hash)
  return hash
}

function snapshotHash(s: IssueSnapshot): {
  issue: number
  phase: string
  aheadOfBase: number
  reworkReason: string | null
} {
  return {
    issue: s.issue.number,
    phase: s.phase,
    aheadOfBase: s.aheadOfBase,
    reworkReason: s.reworkReason,
  }
}

export function isStalled(
  prevHash: string | null,
  prevAction: Action | null,
  currHash: string,
  currAction: Action,
): boolean {
  if (prevHash === null || prevAction === null) return false
  return prevHash === currHash && actionsEqual(prevAction, currAction)
}

export function actionIssueAndStage(
  action: Action,
): { issue: IssueRef; stage: Action["tag"] } | null {
  if (action.tag === "runMerger") {
    const first = action.issues[0]
    return first ? { issue: first, stage: action.tag } : null
  }
  return { issue: action.issue, stage: action.tag }
}

function actionsEqual(a: Action, b: Action): boolean {
  if (a.tag !== b.tag) return false
  if (a.tag === "runMerger" && b.tag === "runMerger") {
    if (a.issues.length !== b.issues.length) return false
    return a.issues.every((issue, i) => issue.number === b.issues[i]?.number)
  }
  // All other variants carry a single `issue`; the discriminator + issue number
  // determine equality (rework `reason` text is intentionally ignored).
  return "issue" in a && "issue" in b && a.issue.number === b.issue.number
}
