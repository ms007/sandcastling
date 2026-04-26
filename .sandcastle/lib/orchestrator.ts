/**
 * `main.ts` is intentionally thin and only exposes the user-facing knobs
 * (caps, model, transcript). Everything else — adapter wiring against gh,
 * git, the Docker sandbox, the project board, and the transcript sink —
 * lives here.
 */
import { execFile, execFileSync } from "node:child_process"
import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import type * as sandcastle from "@ai-hero/sandcastle"
import {
  type BaseRef,
  DEFAULT_AGENT_MODEL,
  captureBaseRef,
  countCommitsAhead,
  createIssueSandbox,
  runImplementer,
  runMerger,
  runReviewer,
} from "./index.ts"
import {
  type ActionDeps,
  DEFAULT_ATTEMPT_CAP,
  DEFAULT_TICK_CAP,
  type IssueRef,
  MARKER_COMMENT_PREFIX,
  type MarkerComment,
  type ObserveDeps,
  type TickEvent,
  type WorkflowConfig,
  type WorkflowDeps,
  type WorkflowResult,
  runWorkflow,
} from "./manager/index.ts"
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

const execFileP = promisify(execFile)

export type TranscriptOption =
  | { readonly kind: "file"; readonly dir?: string }
  | { readonly kind: "hook"; readonly onTick: (event: TickEvent) => void }
  | { readonly kind: "off" }

export interface OrchestratorOptions {
  readonly tickCap?: number
  readonly attemptCap?: number
  readonly model?: string
  readonly transcript?: TranscriptOption
}

export async function runOrchestrator(
  seedNumber: number,
  options: OrchestratorOptions = {},
): Promise<WorkflowResult> {
  const tickCap = options.tickCap ?? DEFAULT_TICK_CAP
  const attemptCap = options.attemptCap ?? DEFAULT_ATTEMPT_CAP
  const model = options.model ?? DEFAULT_AGENT_MODEL
  const transcript: TranscriptOption = options.transcript ?? { kind: "file" }

  const repoP = detectRepo()
  const baseRef = captureBaseRef()
  const { owner, repo } = await repoP
  const ctx = await resolveProject(owner, repo)
  const report = await getRelatedIssues(ctx, seedNumber, defaultBranchLookup(baseRef.sha))

  const config = buildConfig(report, { tickCap, attemptCap })
  console.log(
    `Seed #${config.seed.number} ${config.seed.isPrd ? "(PRD)" : ""} with ${config.children.length} child issue(s).`,
  )

  const sink = await openTranscriptSink(seedNumber, owner, repo, transcript)
  if (sink.path) console.log(`Transcript: ${sink.path}`)

  const sandboxes = createSandboxCache()

  const deps: WorkflowDeps = {
    observe: buildObserveDeps(baseRef),
    actions: buildActionDeps(ctx, baseRef, model, sandboxes),
    hooks: { onTick: sink.onTick },
  }

  let result: WorkflowResult | null = null
  try {
    result = await runWorkflow(config, deps)
    console.log(`\nWorkflow result: ${JSON.stringify(result)}`)
    return result
  } finally {
    await Promise.allSettled([sandboxes.disposeAll(), sink.close(result)])
  }
}

type SandboxCache = ReturnType<typeof createSandboxCache>

const closeQuiet = async (pending: Promise<sandcastle.Sandbox>): Promise<void> => {
  const sandbox = await pending.catch(() => null)
  if (sandbox) await sandbox.close().catch(() => {})
}

/**
 * Per-issue sandbox cache. The same container is reused across the
 * implementer, reviewer, and any rework cycles for a given issue. Containers
 * are released eagerly on terminal phases (approved review, merge) so the
 * concurrent-container count stays at 1 even on long workflows; any survivors
 * are torn down by `disposeAll` in the orchestrator's `finally` block.
 */
function createSandboxCache() {
  const open = new Map<number, Promise<sandcastle.Sandbox>>()

  return {
    get: (issue: IssueRef): Promise<sandcastle.Sandbox> => {
      const existing = open.get(issue.number)
      if (existing) return existing
      const created = createIssueSandbox(issue)
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

function buildConfig(
  report: { seed: RelatedIssue; children: readonly RelatedIssue[] },
  caps: { tickCap: number; attemptCap: number },
): WorkflowConfig {
  const children = report.children.map(toIssueRef)
  return {
    seed: { ...toIssueRef(report.seed), isPrd: children.length > 0 },
    children,
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

function buildActionDeps(
  ctx: ProjectContext,
  baseRef: BaseRef,
  model: string,
  sandboxes: SandboxCache,
): ActionDeps {
  return {
    moveStatus: (itemId, status) => moveStatus(ctx, itemId, status),
    unblockDependents: async (n) => unblockDependents(ctx, n),
    closeIssue: async (n) => {
      await execFileP("gh", ["issue", "close", String(n)])
    },
    runImplementer: async (issue, priorAttempts) => {
      const sandbox = await sandboxes.get(issue)
      await runImplementer({
        sandbox,
        issue,
        baseRef,
        priorAttempts,
        model,
      })
    },
    runReviewer: async (issue, priorAttempts) => {
      const sandbox = await sandboxes.get(issue)
      const verdict = await runReviewer({
        sandbox,
        issue,
        priorAttempts,
        model,
      })
      // Approved: no further stages will need this sandbox. Free it now to
      // keep the concurrent-container count bounded; rework keeps it open.
      if (verdict.tag === "approved") await sandboxes.release(issue.number)
      return verdict
    },
    runMerger: async (issues, priorAttempts) => {
      await runMerger({
        issues,
        priorAttempts,
        model,
      })
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
  /** Set when writing to a file — caller logs it once at startup. */
  readonly path?: string
  close(result: WorkflowResult | null): Promise<void>
}

async function openTranscriptSink(
  seedNumber: number,
  owner: string,
  repo: string,
  option: TranscriptOption,
): Promise<TranscriptSink> {
  if (option.kind === "off") {
    return { onTick: () => {}, close: async () => {} }
  }
  if (option.kind === "hook") {
    return { onTick: option.onTick, close: async () => {} }
  }
  const dir = option.dir ?? join(".sandcastle", "logs")
  await mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const path = join(dir, `workflow-seed-${seedNumber}-${stamp}.log`)
  await appendFile(path, `[start] seed=${seedNumber} owner=${owner} repo=${repo}\n`)

  // Serialize appends so tick lines never interleave. The `.catch` keeps a
  // single failed write from poisoning every subsequent append as an
  // unhandled rejection.
  let writeChain: Promise<void> = Promise.resolve()
  const append = (line: string) => {
    writeChain = writeChain.then(() => appendFile(path, line)).catch(() => {})
  }
  return {
    path,
    onTick: (event) => {
      append(`[tick ${event.tickCount}] ${JSON.stringify(summarizeTickEvent(event))}\n`)
    },
    close: async (result) => {
      append(result ? `\n[result] ${JSON.stringify(result)}\n` : "\n[aborted]\n")
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
  const { action } = decision
  switch (action.tag) {
    case "runMerger":
      return {
        tag: "act",
        action: action.tag,
        issues: action.issues.map((i) => i.number),
      }
    case "applyReworkVerdict":
      return {
        tag: "act",
        action: action.tag,
        issue: action.issue.number,
        reason: action.reason,
      }
    default:
      return { tag: "act", action: action.tag, issue: action.issue.number }
  }
}
