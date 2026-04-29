import { join } from "node:path"
import type { AgentStreamEvent, LoggingOption, RunOptions } from "@ai-hero/sandcastle"
import * as sandcastle from "@ai-hero/sandcastle"
import {
  type ResolvedContainerStageConfig,
  type ResolvedStageConfig,
  spreadOptional,
} from "./config.ts"
import { type BaseRef, countCommitsAhead, formatBaseRef } from "./git.ts"
import { parseImplementerResult, parseReviewerVerdict } from "./manager/result.ts"
import type { ImplementerStats, ReviewerVerdict } from "./manager/types.ts"
import type { IssueRef } from "./types.ts"

const COMPLETION_SIGNALS = {
  implement: "</result>",
  review: "</verdict>",
  merge: "</result>",
} as const

const issuePromptArgs = (issue: IssueRef, priorAttempts = "") => ({
  ISSUE_NUMBER: String(issue.number),
  ISSUE_TITLE: issue.title,
  BRANCH: issue.branch,
  PRIOR_ATTEMPTS: priorAttempts,
})

const sanitizeForFilename = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, "-")

const stageLogging = (
  logDir: string | undefined,
  runId: string,
  filename: string,
  onAgentStreamEvent?: (event: AgentStreamEvent) => void,
): LoggingOption =>
  logDir !== undefined
    ? {
        type: "file",
        path: join(logDir, runId, `${sanitizeForFilename(filename)}.log`),
        ...(onAgentStreamEvent && { onAgentStreamEvent }),
      }
    : { type: "stdout" }

export const runImplementer = async ({
  sandbox,
  issue,
  baseRef,
  priorAttempts = "",
  config,
  logDir,
  runId,
  onAgentStreamEvent,
}: {
  sandbox: sandcastle.Sandbox
  issue: IssueRef
  baseRef: BaseRef
  priorAttempts?: string
  config: ResolvedStageConfig
  logDir: string | undefined
  runId: string
  onAgentStreamEvent?: (event: AgentStreamEvent) => void
}): Promise<ImplementerStats> => {
  const result = await sandbox.run({
    name: `Implementer #${issue.number}`,
    agent: config.agent,
    promptFile: config.promptFile,
    ...spreadOptional("idleTimeoutSeconds", config.idleTimeoutSeconds),
    ...spreadOptional("maxIterations", config.maxIterations),
    promptArgs: {
      ...config.promptArgs,
      ...issuePromptArgs(issue, priorAttempts),
    },
    completionSignal: COMPLETION_SIGNALS.implement,
    logging: stageLogging(logDir, runId, `implementer-issue-${issue.number}`, onAgentStreamEvent),
  })

  const verdict = parseImplementerResult(result.stdout)
  if (verdict.tag === "failed") {
    throw new Error(`Implementer for #${issue.number} aborted: ${verdict.reason}`)
  }

  const totalAhead = countCommitsAhead(baseRef.sha, issue.branch)
  const baseLabel = formatBaseRef(baseRef)
  if (totalAhead === 0) {
    throw new Error(
      `Implementer for #${issue.number} left ${issue.branch} with no commits ahead of ${baseLabel}. Inspect the implementer transcript before re-running.`,
    )
  }

  return { newCommits: result.commits.length, totalAhead }
}

export const runReviewer = async ({
  sandbox,
  issue,
  priorAttempts = "",
  config,
  logDir,
  runId,
  onAgentStreamEvent,
}: {
  sandbox: sandcastle.Sandbox
  issue: IssueRef
  priorAttempts?: string
  config: ResolvedStageConfig
  logDir: string | undefined
  runId: string
  onAgentStreamEvent?: (event: AgentStreamEvent) => void
}): Promise<ReviewerVerdict> => {
  const result = await sandbox.run({
    name: `Reviewer #${issue.number}`,
    agent: config.agent,
    promptFile: config.promptFile,
    ...spreadOptional("idleTimeoutSeconds", config.idleTimeoutSeconds),
    ...spreadOptional("maxIterations", config.maxIterations),
    promptArgs: {
      ...config.promptArgs,
      ...issuePromptArgs(issue, priorAttempts),
    },
    completionSignal: COMPLETION_SIGNALS.review,
    logging: stageLogging(logDir, runId, `reviewer-issue-${issue.number}`, onAgentStreamEvent),
  })

  return parseReviewerVerdict(result.stdout)
}

interface MergerParams {
  readonly issues: readonly IssueRef[]
  readonly baseRef: BaseRef
  readonly mergeBranch: string
  readonly priorAttempts?: string
  readonly config: ResolvedContainerStageConfig
  readonly logDir: string | undefined
  readonly runId: string
  readonly waveIndex?: number
  readonly onAgentStreamEvent?: (event: AgentStreamEvent) => void
}

const mergerLogName = (waveIndex: number | undefined): string =>
  waveIndex !== undefined ? `merger-wave-${waveIndex}` : "merger"

const buildMergerRunOptions = ({
  issues,
  baseRef,
  mergeBranch,
  priorAttempts = "",
  config,
  logDir,
  runId,
  waveIndex,
  onAgentStreamEvent,
}: MergerParams): RunOptions => ({
  sandbox: config.sandbox,
  ...spreadOptional("hooks", config.hooks),
  name: "Merger",
  agent: config.agent,
  promptFile: config.promptFile,
  ...spreadOptional("idleTimeoutSeconds", config.idleTimeoutSeconds),
  ...spreadOptional("maxIterations", config.maxIterations),
  promptArgs: {
    ...config.promptArgs,
    BRANCH_LIST: issues.map((i) => `- ${i.branch}`).join("\n"),
    ISSUE_LIST: issues.map((i) => `- #${i.number}: ${i.title}`).join("\n"),
    BASE_LABEL: formatBaseRef(baseRef),
    PRIOR_ATTEMPTS: priorAttempts,
  },
  branchStrategy: { type: "branch", branch: mergeBranch, baseBranch: baseRef.sha },
  completionSignal: COMPLETION_SIGNALS.merge,
  logging: stageLogging(logDir, runId, mergerLogName(waveIndex), onAgentStreamEvent),
})

export const runMerger = async (params: MergerParams): Promise<void> => {
  await sandcastle.run(buildMergerRunOptions(params))
}

/** Test seam — internal helpers exposed for unit tests. Not a public API. */
export const __testing = { issuePromptArgs, buildMergerRunOptions, stageLogging }
