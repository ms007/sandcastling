import type { AgentStreamEvent } from "@ai-hero/sandcastle"
import type { StageEndEvent, StageStartEvent, TickEvent, WorkflowResult } from "./manager/index.ts"
import { actionIssueAndStage } from "./manager/index.ts"
import type { PaneHandle } from "./multiplexing-renderer.ts"
import type { OutputCapabilities } from "./palette.ts"

export interface RunHeader {
  readonly runId: string
  readonly seed: { readonly number: number; readonly isPrd: boolean }
  readonly children: readonly { readonly number: number }[]
  readonly logDir: string | undefined
  readonly tickCap: number
  readonly attemptCap: number
}

export interface PrettyStdoutSink {
  readonly onTick: (event: TickEvent) => void
  readonly onStageStart: (event: StageStartEvent) => void
  readonly onStageEnd: (event: StageEndEvent) => void
  readonly onAgentStream: (event: AgentStreamEvent) => void
  close(result: WorkflowResult | null, error?: Error): void
}

interface Glyphs {
  readonly ok: string
  readonly blocked: string
  readonly crashed: string
  readonly bullet: string
  readonly stage: string
  readonly rework: string
  readonly corner: string
}

const UNICODE_GLYPHS: Glyphs = {
  ok: "✓",
  blocked: "⏸",
  crashed: "✗",
  bullet: "·",
  stage: "●",
  rework: "↻",
  corner: "⎿",
}
const ASCII_GLYPHS: Glyphs = {
  ok: "[ok]",
  blocked: "[blocked]",
  crashed: "[error]",
  bullet: "-",
  stage: "*",
  rework: "[rework]",
  corner: "|",
}

const ANSI_RESET = "\x1b[0m"
const ANSI_BOLD = "\x1b[1m"
const ANSI_DIM = "\x1b[2m"
const ANSI_GREEN = "\x1b[32m"
const ANSI_YELLOW = "\x1b[33m"
const ANSI_RED = "\x1b[31m"

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`
}

export function openPrettyStdoutSink(
  pane: PaneHandle,
  caps: OutputCapabilities,
  header: RunHeader,
): PrettyStdoutSink {
  const g = caps.unicode ? UNICODE_GLYPHS : ASCII_GLYPHS
  const bold = caps.color ? (s: string) => `${ANSI_BOLD}${s}${ANSI_RESET}` : (s: string) => s
  const dim = caps.color ? (s: string) => `${ANSI_DIM}${s}${ANSI_RESET}` : (s: string) => s
  const green = caps.color ? (s: string) => `${ANSI_GREEN}${s}${ANSI_RESET}` : (s: string) => s
  const yellow = caps.color ? (s: string) => `${ANSI_YELLOW}${s}${ANSI_RESET}` : (s: string) => s
  const red = caps.color ? (s: string) => `${ANSI_RED}${s}${ANSI_RESET}` : (s: string) => s

  const startTime = Date.now()

  const childList =
    header.children.length > 0 ? header.children.map((c) => `#${c.number}`).join(", ") : "none"

  const seedLabel = `#${header.seed.number}${header.seed.isPrd ? " (PRD)" : ""}`

  pane.appendLine(
    `${bold(`Run ${header.runId}`)} ${g.bullet} seed ${seedLabel} ${g.bullet} ${header.children.length} child issue(s): ${childList}`,
  )
  if (header.logDir) {
    pane.appendLine(dim(`Logs: ${header.logDir}`))
  }
  pane.appendLine(dim(`Caps: tickCap=${header.tickCap}, attemptCap=${header.attemptCap}`))
  pane.appendLine("")

  let lastTarget: ReturnType<typeof actionIssueAndStage> = null
  let isFirstStreamEvent = true

  const CORNER_PREFIX = `  ${g.corner} `
  const CONTINUATION_PREFIX = "    "

  return {
    onTick: (event) => {
      if (event.decision.tag === "act") {
        lastTarget = actionIssueAndStage(event.decision.action)
        const { action } = event.decision
        if (action.tag === "finalizeIssue" || action.tag === "finalizePrd") {
          pane.appendSticky(green(`${g.ok} #${action.issue.number} done`))
        }
      }
    },
    onStageStart: (event) => {
      isFirstStreamEvent = true
      const wavePart = event.wave ? ` ${g.bullet} wave ${event.wave.index + 1}` : ""
      const label =
        event.stage === "merge"
          ? `${g.stage} merge${wavePart}`
          : `${g.stage} #${event.issue.number} ${event.stage}${wavePart} ${g.bullet} attempt ${event.attempt}`
      pane.appendSticky(bold(label))
    },
    onStageEnd: (event) => {
      if (event.error) {
        pane.appendSticky(`  ${red(`${g.crashed} failed: ${event.error.message}`)}`)
        return
      }

      const dur = formatDuration(event.durationMs)
      const outcome = event.outcome
      if (!outcome) return

      switch (outcome.tag) {
        case "implementer": {
          const commitWord = outcome.stats.newCommits === 1 ? "commit" : "commits"
          pane.appendSticky(
            `  ${green(`${g.ok} done`)} ${g.bullet} ${dur} ${g.bullet} ${outcome.stats.newCommits} ${commitWord} ${g.bullet} ${outcome.stats.totalAhead} ahead of base`,
          )
          break
        }
        case "reviewer": {
          if (outcome.verdict.tag === "approved") {
            pane.appendSticky(`  ${green(`${g.ok} approved`)} ${g.bullet} ${dur}`)
          } else {
            pane.appendSticky(
              `  ${yellow(`${g.rework} rework: "${outcome.verdict.reason}"`)} ${g.bullet} ${dur}`,
            )
          }
          break
        }
        case "merger": {
          const issueList = outcome.issues.map((n) => `#${n}`).join(", ")
          pane.appendSticky(`  ${green(`${g.ok} merged ${issueList}`)} ${g.bullet} ${dur}`)
          break
        }
      }
    },
    onAgentStream: (event) => {
      const content =
        event.type === "text" ? event.message : `${event.name}(${event.formattedArgs})`
      for (const line of content.split("\n")) {
        const prefix = isFirstStreamEvent ? CORNER_PREFIX : CONTINUATION_PREFIX
        isFirstStreamEvent = false
        pane.appendLine(dim(`${prefix}${line}`))
      }
    },
    close: (result, error) => {
      const elapsed = formatDuration(Date.now() - startTime)

      if (error) {
        const issue = lastTarget?.issue.number ?? null
        const stage = lastTarget?.stage ?? null
        const where = issue !== null ? ` at ${stage} #${issue}` : ""
        const logHint = header.logDir ? ` ${g.bullet} see logs: ${header.logDir}` : ""
        pane.appendLine("")
        pane.appendLine(`${red(`${g.crashed} Run crashed${where}`)}${logHint}`)
        pane.close(`crashed${where}`)
        return
      }

      if (!result) {
        pane.appendLine("")
        pane.appendLine(yellow(`${g.blocked} Run aborted`))
        pane.close("aborted")
        return
      }

      if (result.tag === "done") {
        pane.appendLine("")
        pane.appendLine(
          `${green(`${g.ok} Run done`)} ${g.bullet} ${result.tickCount} ticks ${g.bullet} ${elapsed}`,
        )
        pane.close("done")
        return
      }

      const reason = formatBlockedReason(result)
      pane.appendLine("")
      pane.appendLine(`${yellow(`${g.blocked} Run blocked`)} ${g.bullet} ${reason}`)
      pane.close(`blocked: ${reason}`)
    },
  }
}

function formatBlockedReason(result: Extract<WorkflowResult, { tag: "blocked" }>): string {
  switch (result.reason) {
    case "tickCap":
      return `tick cap reached (${result.ticks} ticks)`
    case "stalled":
      return `stalled on #${result.issue.number} at ${result.stage}`
    case "tooManyAttempts":
      return `too many attempts on #${result.issue.number} at ${result.stage} (${result.attempts} attempts)`
  }
}
