import { execFile, execFileSync } from "node:child_process"
import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import type { AgentStreamEvent } from "@ai-hero/sandcastle"
import * as sandcastle from "@ai-hero/sandcastle"
import { ulid } from "ulid"
import {
  type OrchestratorOptions,
  type ResolvedConfig,
  resolveConfig,
  spreadOptional,
} from "./config.ts"
import { type BaseRef, captureBaseRef, countCommitsAhead, ensureCleanWorktree } from "./git.ts"
import {
  casFastForward,
  listWorktreesForBranch,
  resolveRef,
  safeDeleteBranch,
  shortSha,
  tempMergerBranchName,
} from "./git.ts"
import {
  type ActionDeps,
  DEFAULT_ATTEMPT_CAP,
  DEFAULT_TICK_CAP,
  type ImplementerStats,
  type IssueRef,
  MARKER_COMMENT_PREFIX,
  type MarkerComment,
  type ObserveDeps,
  type TickEvent,
  type WorkflowConfig,
  type WorkflowDeps,
  type WorkflowResult,
  actionIssueAndStage,
  runWorkflow,
} from "./manager/index.ts"
import { createMultiplexingRenderer } from "./multiplexing-renderer.ts"
import { resolveOutputCapabilities } from "./palette.ts"
import { type RunHeader, openPrettyStdoutSink } from "./pretty-stdout-sink.ts"
import {
  type ProjectContext,
  type RelatedIssue,
  defaultBranchLookup,
  detectRepo,
  getRelatedIssues,
  moveStatus,
  resolveProject,
  unblockDependents,
} from "./project.ts"
import { runImplementer, runMerger, runReviewer } from "./stages.ts"

const execFileP = promisify(execFile)

/**
 * Internal sink for the workflow tick transcript. Public callers control
 * this via `OrchestratorOptions.logDir`; this discriminated union is an
 * implementation detail and is **not** exported from the package.
 */
type TranscriptOption = { readonly kind: "file"; readonly dir: string } | { readonly kind: "off" }

export async function runOrchestrator(options: OrchestratorOptions): Promise<WorkflowResult> {
  ensureCleanWorktree()

  const runId = ulid()

  const resolved = resolveConfig(
    options,
    { tickCap: DEFAULT_TICK_CAP, attemptCap: DEFAULT_ATTEMPT_CAP },
    runId,
  )

  const repoP = detectRepo()
  const baseRef = captureBaseRef()
  const { owner, repo } = await repoP
  const ctx = await resolveProject(owner, repo)
  const report = await getRelatedIssues(ctx, resolved.seedIssue, defaultBranchLookup(baseRef.sha))

  const config = buildWorkflowConfig(report, {
    tickCap: resolved.tickCap,
    attemptCap: resolved.attemptCap,
  })

  const transcriptOption: TranscriptOption =
    resolved.logDir !== undefined ? { kind: "file", dir: resolved.logDir } : { kind: "off" }
  const transcript = await openTranscriptSink(
    resolved.seedIssue,
    runId,
    owner,
    repo,
    transcriptOption,
  )

  const caps = resolveOutputCapabilities(
    process.stdout.isTTY ?? false,
    process.env.NO_COLOR,
    process.env.SANDCASTLE_COLOR,
  )
  const renderer = createMultiplexingRenderer(process.stdout, caps, () => process.stdout.columns)
  const prettyHeader: RunHeader = {
    runId,
    seed: { number: config.seed.number, isPrd: config.seed.isPrd },
    children: config.children.map((c) => ({ number: c.number })),
    logDir: resolved.logDir !== undefined ? join(resolved.logDir, runId) : undefined,
    tickCap: resolved.tickCap,
    attemptCap: resolved.attemptCap,
  }
  const pane = renderer.openPane(runId, `Run ${runId}`)
  const pretty = openPrettyStdoutSink(pane, caps, prettyHeader)

  const sandboxes = createSandboxCache(resolved)

  const deps: WorkflowDeps = {
    observe: buildObserveDeps(baseRef),
    actions: buildActionDeps(ctx, baseRef, resolved, sandboxes, pretty.onAgentStream),
    hooks: {
      onTick: (event) => {
        transcript.onTick(event)
        pretty.onTick(event)
      },
      onStageStart: pretty.onStageStart,
      onStageEnd: pretty.onStageEnd,
    },
  }

  let result: WorkflowResult | null = null
  let error: Error | undefined
  try {
    result = await runWorkflow(config, deps)
    refreshHostWorktree(baseRef, result, console.log)
    return result
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err))
    throw err
  } finally {
    pretty.close(result, error)
    await Promise.allSettled([sandboxes.disposeAll(), transcript.close(result, error)])
  }
}

type SandboxCache = ReturnType<typeof createSandboxCache>

const closeQuiet = async (pending: Promise<sandcastle.Sandbox>): Promise<void> => {
  const sandbox = await pending.catch(() => null)
  if (sandbox) await sandbox.close().catch(() => {})
}

function createSandboxCache(resolved: ResolvedConfig) {
  const { sandbox, hooks } = resolved.stages.implement
  const open = new Map<number, Promise<sandcastle.Sandbox>>()

  return {
    get: (issue: IssueRef): Promise<sandcastle.Sandbox> => {
      const existing = open.get(issue.number)
      if (existing) return existing
      const created = sandcastle.createSandbox({
        sandbox,
        branch: issue.branch,
        ...spreadOptional("hooks", hooks),
      })
      open.set(issue.number, created)
      return created
    },
    release: async (issueNumber: number): Promise<void> => {
      const pending = open.get(issueNumber)
      if (!pending) return
      open.delete(issueNumber)
      await closeQuiet(pending)
    },
    disposeAll: async (): Promise<void> => {
      const all = [...open.values()]
      open.clear()
      await Promise.allSettled(all.map(closeQuiet))
    },
  }
}

function buildWorkflowConfig(
  report: { seed: RelatedIssue; children: readonly RelatedIssue[] },
  caps: { tickCap: number; attemptCap: number },
): WorkflowConfig {
  const children = report.children.map(toIssueRef)
  const childBlockers = new Map(report.children.map((c) => [c.number, c.blockedBy]))
  return {
    seed: { ...toIssueRef(report.seed), isPrd: children.length > 0 },
    children,
    childBlockers,
    tickCap: caps.tickCap,
    attemptCap: caps.attemptCap,
  }
}

function toIssueRef(issue: RelatedIssue): IssueRef {
  return {
    number: issue.number,
    title: issue.title,
    itemId: issue.itemId,
    branch: issue.branch.name,
  }
}

function buildObserveDeps(baseRef: BaseRef): ObserveDeps {
  return {
    getCommitsAhead: (branch) => countCommitsAhead(baseRef.sha, branch),
    getMarkerComments: (issueNumber) => fetchMarkerCommentsSync(issueNumber),
  }
}

function fetchMarkerCommentsSync(issueNumber: number): readonly MarkerComment[] {
  const stdout = execFileSync("gh", ["issue", "view", String(issueNumber), "--json", "comments"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  })
  const parsed = JSON.parse(stdout) as { comments: { body: string }[] }
  return parsed.comments
    .filter((c) => c.body.startsWith(MARKER_COMMENT_PREFIX))
    .map((c) => ({ body: c.body }))
}

export function commitMergerResultToBaseRef(
  baseRef: BaseRef,
  mergeBranch: string,
  log: (msg: string) => void,
): void {
  if (baseRef.refName === "HEAD") {
    log(`Detached HEAD: skipping ref update. Merger result preserved on ${mergeBranch}.`)
    return
  }

  try {
    const tipResult = resolveRef(mergeBranch)
    if (tipResult.kind === "missing") {
      throw new Error(`Merger branch ${mergeBranch} not found — merger may have crashed.`)
    }
    const mergerTip = tipResult.sha

    const casResult = casFastForward(baseRef.refName, baseRef.sha, mergerTip)
    switch (casResult.kind) {
      case "ok": {
        log(`${baseRef.refName} advanced to ${shortSha(mergerTip)}.`)
        safeDeleteBranch(mergeBranch, { force: true })
        const worktrees = listWorktreesForBranch(baseRef.refName)
        if (worktrees.length > 0) {
          log(`Hint: run \`git -C ${worktrees[0]} reset --hard\` to refresh the worktree.`)
        }
        return
      }
      case "moved":
        throw new Error(
          `${baseRef.refName} moved (expected ${shortSha(baseRef.sha)}, actual ${shortSha(casResult.actualSha)}). ` +
            `Merger result preserved on ${mergeBranch} — finish the merge by hand.`,
        )
      case "missing":
        throw new Error(
          `${baseRef.refName} no longer exists. ` +
            `Merger result preserved on ${mergeBranch} — finish the merge by hand.`,
        )
    }
  } finally {
    if (resolveRef(mergeBranch).kind === "resolved") {
      try {
        safeDeleteBranch(mergeBranch)
      } catch {
        // Branch has unmerged commits — leave it in place.
      }
    }
  }
}

export function commitWaveMergerResult(
  baseRef: BaseRef,
  mergeBranch: string,
  waveIndex: number,
  log: (msg: string) => void,
): BaseRef {
  try {
    commitMergerResultToBaseRef(baseRef, mergeBranch, log)
  } catch (err) {
    throw new Error(
      `Wave ${waveIndex + 1} merger failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }

  if (baseRef.refName === "HEAD") {
    const tip = resolveRef(mergeBranch)
    if (tip.kind === "resolved") {
      return { sha: tip.sha, refName: "HEAD" }
    }
    return baseRef
  }

  const tip = resolveRef(baseRef.refName)
  if (tip.kind === "resolved") {
    return { sha: tip.sha, refName: baseRef.refName }
  }
  return baseRef
}

function buildActionDeps(
  ctx: ProjectContext,
  baseRef: BaseRef,
  resolved: ResolvedConfig,
  sandboxes: SandboxCache,
  agentStreamCallback?: (event: AgentStreamEvent) => void,
): ActionDeps {
  const { implement, review, merge } = resolved.stages
  const { logDir, runId } = resolved
  let mergerBaseRef = baseRef
  let waveIndex = 0

  return {
    moveStatus: (itemId, status) => moveStatus(ctx, itemId, status),
    unblockDependents: async (n) => unblockDependents(ctx, n),
    closeIssue: async (n) => {
      await execFileP("gh", ["issue", "close", String(n)])
    },
    runImplementer: async (issue, priorAttempts): Promise<ImplementerStats> => {
      const sandbox = await sandboxes.get(issue)
      return await runImplementer({
        sandbox,
        issue,
        baseRef,
        priorAttempts,
        config: implement,
        logDir,
        runId,
        ...(agentStreamCallback && { onAgentStreamEvent: agentStreamCallback }),
      })
    },
    runReviewer: async (issue, priorAttempts) => {
      const sandbox = await sandboxes.get(issue)
      const verdict = await runReviewer({
        sandbox,
        issue,
        priorAttempts,
        config: review,
        logDir,
        runId,
        ...(agentStreamCallback && { onAgentStreamEvent: agentStreamCallback }),
      })
      if (verdict.tag === "approved") await sandboxes.release(issue.number)
      return verdict
    },
    runMerger: async (issues, priorAttempts) => {
      const currentWave = waveIndex
      const currentBaseRef = mergerBaseRef
      const mergeBranch = tempMergerBranchName(resolved.seedIssue)
      await runMerger({
        issues,
        baseRef: currentBaseRef,
        mergeBranch,
        priorAttempts,
        config: merge,
        logDir,
        runId,
        waveIndex: currentWave,
        ...(agentStreamCallback && { onAgentStreamEvent: agentStreamCallback }),
      })
      mergerBaseRef = commitWaveMergerResult(currentBaseRef, mergeBranch, currentWave, console.log)
      waveIndex++
      await Promise.all(issues.map((i) => sandboxes.release(i.number)))
    },
    postMarkerComment: async (n, body) => {
      await execFileP("gh", ["issue", "comment", String(n), "--body", body])
    },
    getMarkerComments: async (n) => fetchMarkerCommentsSync(n),
  }
}

interface TranscriptSink {
  readonly onTick: (event: TickEvent) => void
  readonly path?: string
  close(result: WorkflowResult | null, error?: Error): Promise<void>
}

async function openTranscriptSink(
  seedNumber: number,
  runId: string,
  owner: string,
  repo: string,
  option: TranscriptOption,
): Promise<TranscriptSink> {
  if (option.kind === "off") {
    return { onTick: () => {}, close: async () => {} }
  }
  const { dir } = option
  const runDir = join(dir, runId)
  await mkdir(runDir, { recursive: true })
  const path = join(runDir, "workflow.log")
  await appendFile(path, `[start] seed=${seedNumber} runId=${runId} owner=${owner} repo=${repo}\n`)

  let writeChain: Promise<void> = Promise.resolve()
  const append = (line: string) => {
    writeChain = writeChain.then(() => appendFile(path, line)).catch(() => {})
  }

  let lastTarget: ReturnType<typeof actionIssueAndStage> = null

  return {
    path,
    onTick: (event) => {
      if (event.decision.tag === "act") {
        lastTarget = actionIssueAndStage(event.decision.action)
      }
      append(`[tick ${event.tickCount}] ${JSON.stringify(summarizeTickEvent(event))}\n`)
    },
    close: async (result, error) => {
      if (error) {
        const issue = lastTarget?.issue.number ?? null
        const stage = lastTarget?.stage ?? null
        const stack = error.stack ?? error.message
        append(
          `\n[crashed] runId=${runId} issue=${issue} stage=${stage}\n${error.message}\n${stack}\n`,
        )
      } else if (result) {
        append(`\n[result] runId=${runId} ${JSON.stringify(result)}\n`)
      } else {
        append("\n[aborted]\n")
      }
      await writeChain
    },
  }
}

function summarizeTickEvent(event: TickEvent): unknown {
  const { tickCount, observation, decision } = event
  return {
    tickCount,
    seed: {
      number: observation.seed.issue.number,
      phase: observation.seed.phase,
      ahead: observation.seed.aheadOfBase,
    },
    children: observation.children.map((c) => ({
      number: c.issue.number,
      phase: c.phase,
      ahead: c.aheadOfBase,
    })),
    decision: summarizeDecision(decision),
  }
}

function summarizeDecision(decision: TickEvent["decision"]): unknown {
  if (decision.tag !== "act") return decision
  const { action, wave } = decision
  const waveInfo = wave ? { wave: { index: wave.index, issues: [...wave.issues] } } : {}
  switch (action.tag) {
    case "runMerger":
      return {
        tag: "act",
        action: action.tag,
        issues: action.issues.map((i) => i.number),
        ...waveInfo,
      }
    case "applyReworkVerdict":
      return {
        tag: "act",
        action: action.tag,
        issue: action.issue.number,
        reason: action.reason,
        ...waveInfo,
      }
    default:
      return { tag: "act", action: action.tag, issue: action.issue.number, ...waveInfo }
  }
}

export function refreshHostWorktree(
  baseRef: BaseRef,
  result: WorkflowResult,
  log: (msg: string) => void,
): void {
  if (result.tag !== "done") {
    log("Worktree refresh skipped: workflow not done (result was blocked).")
    return
  }
  if (baseRef.refName === "HEAD") {
    log("Worktree refresh skipped: detached HEAD at run start.")
    return
  }
  const tip = resolveRef(baseRef.refName)
  if (tip.kind === "missing" || tip.sha === baseRef.sha) {
    log(`Worktree refresh skipped: ${baseRef.refName} did not move.`)
    return
  }
  const currentBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    encoding: "utf8",
  }).trim()
  if (currentBranch !== baseRef.refName) {
    log(`Worktree refresh skipped: host HEAD switched from ${baseRef.refName} to ${currentBranch}.`)
    return
  }
  try {
    ensureCleanWorktree(baseRef.sha)
  } catch {
    log("Worktree refresh skipped: worktree is dirty.")
    return
  }
  execFileSync("git", ["reset", "--hard", `refs/heads/${baseRef.refName}`])
  log(`Refreshed host worktree to ${baseRef.refName} (${shortSha(tip.sha)}).`)
}

/** Test seam — internal helpers exposed for unit tests. Not a public API. */
export const __testing = { openTranscriptSink }
