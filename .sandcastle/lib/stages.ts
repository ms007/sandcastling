import type { RunOptions } from "@ai-hero/sandcastle"
import * as sandcastle from "@ai-hero/sandcastle"
import { claudeCustom } from "./agent.ts"
import { docker } from "./docker.ts"
import { type BaseRef, countCommitsAhead, formatBaseRef } from "./git.ts"
import { parseReviewerVerdict } from "./manager/result.ts"
import type { ReviewerVerdict } from "./manager/types.ts"
import type { IssueRef } from "./types.ts"

export const DEFAULT_AGENT_MODEL = "claude-opus-4-6"
const INSTALL_HOOKS = {
  sandbox: {
    onSandboxReady: [{ command: "pnpm install --prefer-offline" }],
  },
} as const
const PROMPTS = {
  implement: "./.sandcastle/prompts/implement.md",
  review: "./.sandcastle/prompts/review.md",
  merge: "./.sandcastle/prompts/merge.md",
} as const

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

export const createIssueSandbox = (issue: IssueRef): Promise<sandcastle.Sandbox> =>
  sandcastle.createSandbox({
    sandbox: docker(),
    branch: issue.branch,
    hooks: INSTALL_HOOKS,
  })

export const runImplementer = async ({
  sandbox,
  issue,
  baseRef,
  priorAttempts = "",
  model = DEFAULT_AGENT_MODEL,
}: {
  sandbox: sandcastle.Sandbox
  issue: IssueRef
  baseRef: BaseRef
  priorAttempts?: string
  model?: string
}): Promise<void> => {
  const result = await sandbox.run({
    name: `Implementer #${issue.number}`,
    agent: claudeCustom(model),
    promptFile: PROMPTS.implement,
    promptArgs: issuePromptArgs(issue, priorAttempts),
    completionSignal: COMPLETION_SIGNALS.implement,
  })

  // Compare branch against the frozen base, not the per-session commit list —
  // otherwise a resumed run with already-committed work fails here.
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
  model = DEFAULT_AGENT_MODEL,
}: {
  sandbox: sandcastle.Sandbox
  issue: IssueRef
  priorAttempts?: string
  model?: string
}): Promise<ReviewerVerdict> => {
  const result = await sandbox.run({
    name: `Reviewer #${issue.number}`,
    agent: claudeCustom(model),
    promptFile: PROMPTS.review,
    promptArgs: issuePromptArgs(issue, priorAttempts),
    completionSignal: COMPLETION_SIGNALS.review,
  })

  return parseReviewerVerdict(result.stdout)
}

interface MergerParams {
  readonly issues: readonly IssueRef[]
  readonly baseRef: BaseRef
  readonly mergeBranch: string
  readonly priorAttempts?: string
  readonly model?: string
}

const buildMergerRunOptions = ({
  issues,
  baseRef,
  mergeBranch,
  priorAttempts = "",
  model = DEFAULT_AGENT_MODEL,
}: MergerParams): RunOptions => ({
  sandbox: docker(),
  name: "Merger",
  agent: claudeCustom(model),
  promptFile: PROMPTS.merge,
  promptArgs: {
    BRANCH_LIST: issues.map((i) => `- ${i.branch}`).join("\n"),
    ISSUE_LIST: issues.map((i) => `- #${i.number}: ${i.title}`).join("\n"),
    BASE_LABEL: formatBaseRef(baseRef),
    PRIOR_ATTEMPTS: priorAttempts,
  },
  branchStrategy: { type: "branch", branch: mergeBranch, baseBranch: baseRef.sha },
  completionSignal: COMPLETION_SIGNALS.merge,
  hooks: INSTALL_HOOKS,
})

export const runMerger = async (params: MergerParams): Promise<void> => {
  await sandcastle.run(buildMergerRunOptions(params))
}

/** Test seam — internal helpers exposed for unit tests. Not a public API. */
export const __testing = { issuePromptArgs, buildMergerRunOptions }
