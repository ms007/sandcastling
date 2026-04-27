import type { IssueRef } from "../types.ts"
import type {
  IssueSnapshot,
  Observation,
  ObserveDeps,
  WorkflowConfig,
  WorkflowState,
} from "./types.ts"

export function observe(
  config: WorkflowConfig,
  state: WorkflowState,
  deps: ObserveDeps,
): Observation {
  return {
    seed: {
      issue: config.seed,
      phase: state.phases.get(config.seed.number) ?? "todo",
      isPrd: config.seed.isPrd,
      aheadOfBase: deps.getCommitsAhead(config.seed.branch),
      markerComments: deps.getMarkerComments(config.seed.number),
      reworkReason: state.reworkReasons.get(config.seed.number) ?? null,
      blockedBy: [],
    },
    children: config.children.map((child) =>
      buildSnapshot(child, state, deps, config.childBlockers?.get(child.number) ?? []),
    ),
    tickCount: state.tickCount,
    tickCap: config.tickCap,
    attemptCap: config.attemptCap,
    stageAttempts: state.stageAttempts,
    prevObservationHash: state.prevObservationHash,
    prevAction: state.prevAction,
  }
}

function buildSnapshot(
  issue: IssueRef,
  state: WorkflowState,
  deps: ObserveDeps,
  blockedBy: readonly number[],
): IssueSnapshot {
  return {
    issue,
    phase: state.phases.get(issue.number) ?? "todo",
    aheadOfBase: deps.getCommitsAhead(issue.branch),
    markerComments: deps.getMarkerComments(issue.number),
    reworkReason: state.reworkReasons.get(issue.number) ?? null,
    blockedBy,
  }
}
