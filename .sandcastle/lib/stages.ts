import * as sandcastle from "@ai-hero/sandcastle"
import { claudeCustom } from "./agent.ts"
import { docker } from "./docker.ts"
import { type BaseRef, countCommitsAhead, formatBaseRef } from "./git.ts"

export interface PlannedIssue {
  readonly number: number
  readonly title: string
  readonly itemId: string
  readonly branch: string
}

const COMPLETION_SIGNAL = "<promise>COMPLETE</promise>"
const AGENT_MODEL = "claude-sonnet-4-6"
const INSTALL_HOOKS = {
  sandbox: {
    onSandboxReady: [{ command: "pnpm install --prefer-offline" }],
  },
} as const
const PROMPTS = {
  plan: "./.sandcastle/prompts/plan.md",
  implement: "./.sandcastle/prompts/implement.md",
  review: "./.sandcastle/prompts/review.md",
  merge: "./.sandcastle/prompts/merge.md",
} as const

const issuePromptArgs = (issue: PlannedIssue) => ({
  ISSUE_NUMBER: String(issue.number),
  ISSUE_TITLE: issue.title,
  ITEM_ID: issue.itemId,
  BRANCH: issue.branch,
})

/**
 * Returns the planned issues. An empty array means the planner signalled
 * "done" — either by emitting an empty `<plan>` or by omitting the tag.
 * On the first iteration both are fatal: the run cannot start without work.
 */
export const runPlanner = async ({
  iteration,
  issueNumber,
}: {
  iteration: number
  issueNumber: number
}): Promise<readonly PlannedIssue[]> => {
  const result = await sandcastle.run({
    sandbox: docker(),
    name: `Planner (iter ${iteration})`,
    agent: claudeCustom(AGENT_MODEL),
    promptFile: PROMPTS.plan,
    promptArgs: { ISSUE_NUMBER: String(issueNumber) },
  })

  const planJson = result.stdout.match(/<plan>([\s\S]*?)<\/plan>/)?.[1]
  if (!planJson) {
    if (iteration === 1) {
      throw new Error(`Planner did not produce a <plan> tag.\n\n${result.stdout}`)
    }
    return []
  }

  const { issues } = JSON.parse(planJson) as { issues: PlannedIssue[] }
  if (iteration === 1 && issues.length === 0) {
    throw new Error("Planner returned an empty issue list on first run.")
  }
  return issues
}

export const createIssueSandbox = (issue: PlannedIssue): Promise<sandcastle.Sandbox> =>
  sandcastle.createSandbox({
    sandbox: docker(),
    branch: issue.branch,
    hooks: INSTALL_HOOKS,
  })

export const runImplementer = async ({
  sandbox,
  issue,
  baseRef,
}: {
  sandbox: sandcastle.Sandbox
  issue: PlannedIssue
  baseRef: BaseRef
}): Promise<void> => {
  const result = await sandbox.run({
    name: `Implementer #${issue.number}`,
    agent: claudeCustom(AGENT_MODEL),
    promptFile: PROMPTS.implement,
    promptArgs: issuePromptArgs(issue),
    completionSignal: COMPLETION_SIGNAL,
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
}: {
  sandbox: sandcastle.Sandbox
  issue: PlannedIssue
}): Promise<void> => {
  await sandbox.run({
    name: `Reviewer #${issue.number}`,
    agent: claudeCustom(AGENT_MODEL),
    promptFile: PROMPTS.review,
    promptArgs: issuePromptArgs(issue),
    completionSignal: COMPLETION_SIGNAL,
  })
}

export const runMerger = async ({
  iteration,
  issues,
}: {
  iteration: number
  issues: readonly PlannedIssue[]
}): Promise<void> => {
  await sandcastle.run({
    sandbox: docker(),
    name: `Merger (iter ${iteration})`,
    agent: claudeCustom(AGENT_MODEL),
    promptFile: PROMPTS.merge,
    promptArgs: {
      BRANCH_LIST: issues.map((i) => `- ${i.branch}`).join("\n"),
      ISSUE_LIST: issues.map((i) => `- #${i.number} (itemId: ${i.itemId}): ${i.title}`).join("\n"),
    },
    completionSignal: COMPLETION_SIGNAL,
    hooks: INSTALL_HOOKS,
  })
}
