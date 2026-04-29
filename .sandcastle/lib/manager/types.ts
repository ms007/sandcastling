import type { StatusName } from "../project.ts"
import type { IssueRef } from "../types.ts"

export type IssuePhase =
  | "todo"
  | "claimed"
  | "implemented"
  | "promoted"
  | "reviewed"
  | "reviewedRework"
  | "merged"
  | "done"

export type ReviewerVerdict =
  | { readonly tag: "approved" }
  | { readonly tag: "rework"; readonly reason: string }

export interface MarkerComment {
  readonly body: string
}

export interface IssueSnapshot {
  readonly issue: IssueRef
  readonly phase: IssuePhase
  readonly aheadOfBase: number
  readonly markerComments: readonly MarkerComment[]
  readonly reworkReason: string | null
  readonly blockedBy: readonly number[]
}

export interface Observation {
  readonly seed: IssueSnapshot & { readonly isPrd: boolean }
  readonly children: readonly IssueSnapshot[]
  readonly tickCount: number
  readonly tickCap: number
  readonly attemptCap: number
  readonly stageAttempts: ReadonlyMap<string, number>
  readonly prevObservationHash: string | null
  readonly prevAction: Action | null
}

export interface WaveAnnotation {
  readonly index: number
  readonly issues: readonly number[]
}

export type Decision =
  | { readonly tag: "act"; readonly action: Action; readonly wave?: WaveAnnotation }
  | { readonly tag: "done" }
  | {
      readonly tag: "blocked"
      readonly reason: "tickCap"
      readonly ticks: number
    }
  | {
      readonly tag: "blocked"
      readonly reason: "stalled"
      readonly issue: IssueRef
      readonly stage: Action["tag"]
    }
  | {
      readonly tag: "blocked"
      readonly reason: "tooManyAttempts"
      readonly issue: IssueRef
      readonly stage: Action["tag"]
      readonly attempts: number
    }

export type Action =
  | { readonly tag: "claimIssue"; readonly issue: IssueRef }
  | { readonly tag: "runImplementer"; readonly issue: IssueRef }
  | { readonly tag: "promoteToReview"; readonly issue: IssueRef }
  | { readonly tag: "runReviewer"; readonly issue: IssueRef }
  | { readonly tag: "runMerger"; readonly issues: readonly IssueRef[] }
  | { readonly tag: "finalizeIssue"; readonly issue: IssueRef }
  | { readonly tag: "finalizePrd"; readonly issue: IssueRef }
  | {
      readonly tag: "applyReworkVerdict"
      readonly issue: IssueRef
      readonly reason: string
    }

export interface WorkflowConfig {
  readonly seed: IssueRef & { readonly isPrd: boolean }
  readonly children: readonly IssueRef[]
  readonly childBlockers?: ReadonlyMap<number, readonly number[]>
  readonly tickCap: number
  readonly attemptCap: number
}

export interface WorkflowState {
  readonly phases: ReadonlyMap<number, IssuePhase>
  readonly tickCount: number
  readonly attempts: ReadonlyMap<number, number>
  readonly reworkReasons: ReadonlyMap<number, string>
  readonly stageAttempts: ReadonlyMap<string, number>
  readonly prevObservationHash: string | null
  readonly prevAction: Action | null
}

export type BlockedDecision = Extract<Decision, { readonly tag: "blocked" }>

export type WorkflowResult =
  | { readonly tag: "done"; readonly tickCount: number }
  | (BlockedDecision & { readonly tickCount: number })

export interface ObserveDeps {
  getCommitsAhead(branch: string): number
  getMarkerComments(issueNumber: number): readonly MarkerComment[]
}

export interface ImplementerStats {
  readonly newCommits: number
  readonly totalAhead: number
}

export type StageOutcome =
  | { readonly tag: "implementer"; readonly stats: ImplementerStats }
  | { readonly tag: "reviewer"; readonly verdict: ReviewerVerdict }
  | { readonly tag: "merger"; readonly issues: readonly number[] }

export interface ExecuteResult {
  readonly state: WorkflowState
  readonly stageOutcome?: StageOutcome
}

export interface ActionDeps {
  moveStatus(itemId: string, status: StatusName): Promise<void>
  unblockDependents(issueNumber: number): Promise<readonly number[]>
  closeIssue(issueNumber: number): Promise<void>
  runImplementer(issue: IssueRef, priorAttempts: string): Promise<ImplementerStats>
  runReviewer(issue: IssueRef, priorAttempts: string): Promise<ReviewerVerdict>
  runMerger(issues: readonly IssueRef[], priorAttempts: string): Promise<void>
  postMarkerComment(issueNumber: number, body: string): Promise<void>
  getMarkerComments(issueNumber: number): Promise<readonly MarkerComment[]>
}
