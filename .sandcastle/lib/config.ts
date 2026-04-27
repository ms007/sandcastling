import type { AgentProvider, PromptArgs, SandboxHooks, SandboxProvider } from "@ai-hero/sandcastle"
import type { TranscriptOption } from "./orchestrator.ts"

export interface StageConfig {
  readonly agent: AgentProvider
  readonly promptFile: string
  readonly idleTimeoutSeconds?: number
  readonly maxIterations?: number
  readonly promptArgs?: PromptArgs
}

export interface ContainerStageConfig extends StageConfig {
  readonly sandbox?: SandboxProvider
  readonly hooks?: SandboxHooks
}

export interface OrchestratorOptions {
  readonly seedIssue: number
  readonly sandbox: SandboxProvider
  readonly hooks?: SandboxHooks
  readonly stages: {
    readonly implement: ContainerStageConfig
    readonly review: StageConfig
    readonly merge: ContainerStageConfig
  }
  readonly tickCap?: number
  readonly attemptCap?: number
  readonly transcript?: TranscriptOption
}

export interface ResolvedStageConfig {
  readonly agent: AgentProvider
  readonly promptFile: string
  readonly idleTimeoutSeconds?: number
  readonly maxIterations?: number
  readonly promptArgs: PromptArgs
}

export interface ResolvedContainerStageConfig extends ResolvedStageConfig {
  readonly sandbox: SandboxProvider
  readonly hooks?: SandboxHooks
}

export interface ResolvedConfig {
  readonly seedIssue: number
  readonly stages: {
    readonly implement: ResolvedContainerStageConfig
    readonly review: ResolvedStageConfig
    readonly merge: ResolvedContainerStageConfig
  }
  readonly tickCap: number
  readonly attemptCap: number
  readonly transcript: TranscriptOption
}

const IMPLEMENT_WORKFLOW_TOKENS = [
  "ISSUE_NUMBER",
  "ISSUE_TITLE",
  "BRANCH",
  "PRIOR_ATTEMPTS",
] as const
const REVIEW_WORKFLOW_TOKENS = IMPLEMENT_WORKFLOW_TOKENS
const MERGE_WORKFLOW_TOKENS = ["BRANCH_LIST", "ISSUE_LIST", "BASE_LABEL", "PRIOR_ATTEMPTS"] as const

export const WORKFLOW_TOKENS = {
  implement: IMPLEMENT_WORKFLOW_TOKENS,
  review: REVIEW_WORKFLOW_TOKENS,
  merge: MERGE_WORKFLOW_TOKENS,
} as const

export const spreadOptional = <K extends string, V>(
  key: K,
  value: V | undefined,
): { [P in K]: V } | Record<string, never> =>
  value !== undefined ? ({ [key]: value } as { [P in K]: V }) : {}

function validateStage(
  name: string,
  config: StageConfig,
  workflowTokens: readonly string[],
): ResolvedStageConfig {
  if (!config.agent) {
    throw new Error(`stages.${name}.agent is required`)
  }
  if (!config.promptFile) {
    throw new Error(`stages.${name}.promptFile is required`)
  }

  const userArgs = config.promptArgs ?? {}
  for (const key of workflowTokens) {
    if (key in userArgs) {
      throw new Error(`stages.${name}.promptArgs: "${key}" collides with a workflow-owned token`)
    }
  }

  return {
    agent: config.agent,
    promptFile: config.promptFile,
    ...spreadOptional("idleTimeoutSeconds", config.idleTimeoutSeconds),
    ...spreadOptional("maxIterations", config.maxIterations),
    promptArgs: userArgs,
  }
}

function resolveContainerStage(
  name: string,
  config: ContainerStageConfig,
  globalSandbox: SandboxProvider,
  globalHooks: SandboxHooks | undefined,
  workflowTokens: readonly string[],
): ResolvedContainerStageConfig {
  const base = validateStage(name, config, workflowTokens)
  return {
    ...base,
    sandbox: config.sandbox ?? globalSandbox,
    ...spreadOptional("hooks", config.hooks ?? globalHooks),
  }
}

export function resolveConfig(
  options: OrchestratorOptions,
  defaults: {
    tickCap: number
    attemptCap: number
  },
): ResolvedConfig {
  if (!Number.isInteger(options.seedIssue) || options.seedIssue <= 0) {
    throw new Error("seedIssue must be a positive integer")
  }

  const globalSandbox = options.sandbox
  const globalHooks = options.hooks

  const implement = resolveContainerStage(
    "implement",
    options.stages.implement,
    globalSandbox,
    globalHooks,
    IMPLEMENT_WORKFLOW_TOKENS,
  )
  const review = validateStage("review", options.stages.review, REVIEW_WORKFLOW_TOKENS)
  const merge = resolveContainerStage(
    "merge",
    options.stages.merge,
    globalSandbox,
    globalHooks,
    MERGE_WORKFLOW_TOKENS,
  )

  return {
    seedIssue: options.seedIssue,
    stages: { implement, review, merge },
    tickCap: options.tickCap ?? defaults.tickCap,
    attemptCap: options.attemptCap ?? defaults.attemptCap,
    transcript: options.transcript ?? { kind: "file" },
  }
}

/** Test seam — internal helpers exposed for unit tests. Not a public API. */
export const __testing = { validateStage, resolveContainerStage }
