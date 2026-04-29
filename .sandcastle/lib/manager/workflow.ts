import type { IssueRef } from "../types.ts"
import { execute } from "./actions.ts"
import { actionIssueAndStage, computeObservationHash, stageKey } from "./attempts.ts"
import { decide } from "./decision.ts"
import { observe } from "./observation.ts"
import type {
  Action,
  ActionDeps,
  Decision,
  ExecuteResult,
  IssueSnapshot,
  MarkerComment,
  Observation,
  ObserveDeps,
  StageOutcome,
  WaveAnnotation,
  WorkflowConfig,
  WorkflowResult,
  WorkflowState,
} from "./types.ts"

export const DEFAULT_TICK_CAP = 100
export const DEFAULT_ATTEMPT_CAP = 5

export interface WorkflowHooks {
  /** Fires after observe+decide, before execute. */
  onTick?: (event: TickEvent) => void
  onStageStart?: (event: StageStartEvent) => void
  onStageEnd?: (event: StageEndEvent) => void
}

export interface TickEvent {
  readonly tickCount: number
  readonly observation: Observation
  readonly decision: Decision
}

export interface StageStartEvent {
  readonly stage: "implement" | "review" | "merge"
  readonly issue: IssueRef
  readonly wave?: WaveAnnotation | undefined
  readonly attempt: number
}

export interface StageEndEvent {
  readonly stage: "implement" | "review" | "merge"
  readonly issue: IssueRef
  readonly wave?: WaveAnnotation | undefined
  readonly attempt: number
  readonly durationMs: number
  readonly outcome?: StageOutcome | undefined
  readonly error?: Error | undefined
}

export interface WorkflowDeps {
  readonly observe: ObserveDeps
  readonly actions: ActionDeps
  readonly hooks?: WorkflowHooks
}

export function tick(
  config: WorkflowConfig,
  state: WorkflowState,
  deps: ObserveDeps,
): { decision: Decision; observation: Observation } {
  const observation = observe(config, state, deps)
  const decision = decide(observation)
  return { decision, observation }
}

export async function runWorkflow(
  config: WorkflowConfig,
  deps: WorkflowDeps,
): Promise<WorkflowResult> {
  let state: WorkflowState = {
    phases: new Map(),
    tickCount: 0,
    attempts: new Map(),
    reworkReasons: new Map(),
    stageAttempts: new Map(),
    prevObservationHash: null,
    prevAction: null,
  }

  for (;;) {
    const { decision, observation } = tick(config, state, deps.observe)

    deps.hooks?.onTick?.({ tickCount: state.tickCount, observation, decision })

    if (decision.tag === "done") {
      return { tag: "done", tickCount: state.tickCount }
    }
    if (decision.tag === "blocked") {
      return { ...decision, tickCount: state.tickCount }
    }

    const priorAttempts = buildPriorAttemptsForAction(decision.action, observation, state)

    const stageEvent = buildStageEventBase(decision, state)
    if (stageEvent) deps.hooks?.onStageStart?.(stageEvent)

    const t0 = Date.now()
    let executeResult: ExecuteResult
    try {
      executeResult = await execute(decision.action, state, deps.actions, priorAttempts)
    } catch (err) {
      if (stageEvent) {
        deps.hooks?.onStageEnd?.({
          ...stageEvent,
          durationMs: Date.now() - t0,
          error: err instanceof Error ? err : new Error(String(err)),
        })
      }
      throw err
    }

    const { state: newState, stageOutcome } = executeResult
    if (stageEvent) {
      deps.hooks?.onStageEnd?.({
        ...stageEvent,
        durationMs: Date.now() - t0,
        outcome: stageOutcome,
      })
    }
    state = newState

    const target = actionIssueAndStage(decision.action)
    let stageAttempts = state.stageAttempts
    if (target) {
      const key = stageKey(target.issue.number, target.stage)
      const next = new Map(stageAttempts)
      next.set(key, (next.get(key) ?? 0) + 1)
      stageAttempts = next
    }

    state = {
      ...state,
      tickCount: state.tickCount + 1,
      stageAttempts,
      prevObservationHash: computeObservationHash(observation),
      prevAction: decision.action,
    }
  }
}

export function buildPriorAttemptsBlock(
  markerComments: readonly MarkerComment[],
  currentAttempt: number,
): string {
  if (currentAttempt <= 1) return ""
  if (markerComments.length === 0) return ""

  return [
    "<prior-attempts>",
    `This is attempt ${currentAttempt}. Previous attempts required rework.`,
    "Address ALL reviewer feedback below — do not repeat prior mistakes.",
    "",
    ...markerComments.map((c) => c.body),
    "</prior-attempts>",
  ].join("\n")
}

function buildPriorAttemptsForAction(
  action: Action,
  observation: Observation,
  state: WorkflowState,
): string {
  // Only stages that take agent prompts can carry prior-attempts context.
  if (action.tag !== "runImplementer" && action.tag !== "runReviewer") return ""

  const snapshot = findSnapshot(observation, action.issue.number)
  if (!snapshot) return ""

  const currentAttempt = state.attempts.get(action.issue.number) ?? 1
  return buildPriorAttemptsBlock(snapshot.markerComments, currentAttempt)
}

function findSnapshot(observation: Observation, issueNumber: number): IssueSnapshot | undefined {
  if (observation.seed.issue.number === issueNumber) return observation.seed
  return observation.children.find((c) => c.issue.number === issueNumber)
}

function buildStageEventBase(
  decision: Extract<Decision, { tag: "act" }>,
  state: WorkflowState,
): StageStartEvent | null {
  const { action, wave } = decision
  switch (action.tag) {
    case "runImplementer":
    case "runReviewer":
      return {
        stage: action.tag === "runImplementer" ? "implement" : "review",
        issue: action.issue,
        wave,
        attempt: (state.stageAttempts.get(stageKey(action.issue.number, action.tag)) ?? 0) + 1,
      }
    case "runMerger": {
      const first = action.issues[0]
      if (!first) return null
      return {
        stage: "merge",
        issue: first,
        wave,
        attempt: (state.stageAttempts.get(stageKey(first.number, action.tag)) ?? 0) + 1,
      }
    }
    default:
      return null
  }
}
