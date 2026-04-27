import type { RunOptions } from "@ai-hero/sandcastle"
import * as sandcastle from "@ai-hero/sandcastle"
import {
  type ResolvedContainerStageConfig,
  type ResolvedStageConfig,
  spreadOptional,
} from "./config.ts"
import { type BaseRef, countCommitsAhead, formatBaseRef } from "./git.ts"
import { parseImplementerResult, parseReviewerVerdict } from "./manager/result.ts"
import type { ReviewerVerdict } from "./manager/types.ts"
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

export const runImplementer = async ({
  sandbox,
  issue,
  baseRef,
  priorAttempts = "",
  config,
}: {
  sandbox: sandcastle.Sandbox
  issue: IssueRef
  baseRef: BaseRef
  priorAttempts?: string
  config: ResolvedStageConfig
}): Promise<void> => {
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
  })

  const verdict = parseImplementerResult(result.stdout)
  if (verdict.tag === "failed") {
    throw new Error(`Implementer for #${issue.number} aborted: ${verdict.reason}`)
  }

  const totalAhead = countCommitsAhead(baseRef.sha, issue.branch)
  const baseLabel = formatBaseRef(baseRef)
  if (totalAhead === 0) {
    throw new Error(
      `Implementer for #${issue.number} left ${issue.branch} with no commits ahead of ${baseLabel}. Inspect .sandcastle/logs/ for the implementer transcript before re-running.`,
    )
  }

  console.log(
    `Implementer for #${issue.number}: ${result.commits.length} new commit(s) this session, ${totalAhead} total ahead of ${baseLabel}.`,
  )
}

export const runReviewer = async ({
  sandbox,
  issue,
  priorAttempts = "",
  config,
}: {
  sandbox: sandcastle.Sandbox
  issue: IssueRef
  priorAttempts?: string
  config: ResolvedStageConfig
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
  })

  return parseReviewerVerdict(result.stdout)
}

interface MergerParams {
  readonly issues: readonly IssueRef[]
  readonly baseRef: BaseRef
  readonly mergeBranch: string
  readonly priorAttempts?: string
  readonly config: ResolvedContainerStageConfig
}

const buildMergerRunOptions = ({
  issues,
  baseRef,
  mergeBranch,
  priorAttempts = "",
  config,
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
})

export const runMerger = async (params: MergerParams): Promise<void> => {
  await sandcastle.run(buildMergerRunOptions(params))
}

/** Test seam — internal helpers exposed for unit tests. Not a public API. */
export const __testing = { issuePromptArgs, buildMergerRunOptions }
