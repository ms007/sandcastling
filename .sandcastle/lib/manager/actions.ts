import type { StatusName } from "../project.ts"
import type { IssueRef } from "../types.ts"
import type { Action, ActionDeps, ExecuteResult, IssuePhase, WorkflowState } from "./types.ts"

export const MARKER_COMMENT_PREFIX = "<!-- sandcastle:rework"

const markerHeader = (attempt: number): string => `<!-- sandcastle:rework:attempt-${attempt} -->`

export function formatMarkerComment(reason: string, attempt: number): string {
  return [markerHeader(attempt), `**Rework requested after attempt ${attempt}**`, "", reason].join(
    "\n",
  )
}

export async function execute(
  action: Action,
  state: WorkflowState,
  deps: ActionDeps,
  priorAttempts = "",
): Promise<ExecuteResult> {
  switch (action.tag) {
    case "claimIssue": {
      await moveStatusIfTracked(deps, action.issue, "In Progress")
      return { state: updatePhase(state, action.issue.number, "claimed") }
    }
    case "runImplementer": {
      const stats = await deps.runImplementer(action.issue, priorAttempts)
      return {
        state: updatePhase(state, action.issue.number, "implemented"),
        stageOutcome: { tag: "implementer", stats },
      }
    }
    case "promoteToReview": {
      await moveStatusIfTracked(deps, action.issue, "In Review")
      return { state: updatePhase(state, action.issue.number, "promoted") }
    }
    case "runReviewer": {
      const verdict = await deps.runReviewer(action.issue, priorAttempts)
      if (verdict.tag === "approved") {
        return {
          state: updatePhase(state, action.issue.number, "reviewed"),
          stageOutcome: { tag: "reviewer", verdict },
        }
      }
      const reworkReasons = new Map(state.reworkReasons)
      reworkReasons.set(action.issue.number, verdict.reason)
      return {
        state: {
          ...updatePhase(state, action.issue.number, "reviewedRework"),
          reworkReasons,
        },
        stageOutcome: { tag: "reviewer", verdict },
      }
    }
    case "runMerger": {
      await deps.runMerger(action.issues, priorAttempts)
      const phases = new Map(state.phases)
      for (const issue of action.issues) phases.set(issue.number, "merged")
      return {
        state: { ...state, phases },
        stageOutcome: { tag: "merger", issues: action.issues.map((i) => i.number) },
      }
    }
    case "applyReworkVerdict": {
      const currentAttempt = state.attempts.get(action.issue.number) ?? 1
      const existing = await deps.getMarkerComments(action.issue.number)
      const header = markerHeader(currentAttempt)
      if (!existing.some((c) => c.body.startsWith(header))) {
        await deps.postMarkerComment(
          action.issue.number,
          formatMarkerComment(action.reason, currentAttempt),
        )
      }
      await moveStatusIfTracked(deps, action.issue, "In Progress")
      const attempts = new Map(state.attempts)
      attempts.set(action.issue.number, currentAttempt + 1)
      const reworkReasons = new Map(state.reworkReasons)
      reworkReasons.delete(action.issue.number)
      return {
        state: {
          ...updatePhase(state, action.issue.number, "claimed"),
          attempts,
          reworkReasons,
        },
      }
    }
    case "finalizeIssue": {
      await moveStatusIfTracked(deps, action.issue, "Done")
      await deps.unblockDependents(action.issue.number)
      return { state: updatePhase(state, action.issue.number, "done") }
    }
    case "finalizePrd": {
      await moveStatusIfTracked(deps, action.issue, "Done")
      await deps.closeIssue(action.issue.number)
      await deps.unblockDependents(action.issue.number)
      return { state: updatePhase(state, action.issue.number, "done") }
    }
  }
}

async function moveStatusIfTracked(
  deps: ActionDeps,
  issue: IssueRef,
  status: StatusName,
): Promise<void> {
  if (issue.itemId) await deps.moveStatus(issue.itemId, status)
}

function updatePhase(state: WorkflowState, issueNumber: number, phase: IssuePhase): WorkflowState {
  if (state.phases.get(issueNumber) === phase) return state
  const phases = new Map(state.phases)
  phases.set(issueNumber, phase)
  return { ...state, phases }
}
