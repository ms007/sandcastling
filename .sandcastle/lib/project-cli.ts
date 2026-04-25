/**
 * Thin CLI wrapper around `lib/project.ts`, invoked by agents inside the
 * sandbox via `bun .sandcastle/lib/project-cli.ts <subcommand>`. Bun runs
 * the source directly — no build step, no bundle artifact, source = binary.
 *
 * Two subcommands:
 *   - `related <issueNumber>`     — prints a `RelatedIssuesReport` as JSON.
 *   - `move-status <itemId> <Todo | "In Progress" | "In Review" | Done>`
 *
 * Both auto-discover repo + project on each invocation. That's two extra `gh`
 * calls per use, but it keeps the CLI stateless (no env-var plumbing) and the
 * cost is negligible against the agent runtime.
 */
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { captureBaseRef } from "./git.ts"
import {
  REQUIRED_STATUSES,
  type StatusName,
  defaultBranchLookup,
  getRelatedIssues,
  moveStatus,
  resolveProject,
} from "./project.ts"

const execFileP = promisify(execFile)

const STATUS_NAMES = new Set<StatusName>(REQUIRED_STATUSES)

async function detectRepo(): Promise<{ owner: string; repo: string }> {
  const { stdout } = await execFileP("gh", ["repo", "view", "--json", "owner,name"])
  const parsed = JSON.parse(stdout) as {
    owner: { login: string }
    name: string
  }
  return { owner: parsed.owner.login, repo: parsed.name }
}

function isStatusName(value: string): value is StatusName {
  return (STATUS_NAMES as Set<string>).has(value)
}

async function main(): Promise<void> {
  const [, , subcommand, ...rest] = process.argv

  if (subcommand === "related") {
    const arg = rest[0]
    const num = arg ? Number(arg) : Number.NaN
    if (!Number.isInteger(num) || num <= 0) {
      console.error("Usage: bun .sandcastle/lib/project-cli.ts related <issue-number>")
      process.exit(2)
    }
    const { owner, repo } = await detectRepo()
    const project = await resolveProject(owner, repo)
    const lookup = defaultBranchLookup(captureBaseRef().sha)
    const report = await getRelatedIssues(project, num, lookup)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }

  if (subcommand === "move-status") {
    const itemId = rest[0]
    const status = rest[1]
    if (!itemId || !status || !isStatusName(status)) {
      console.error(
        'Usage: bun .sandcastle/lib/project-cli.ts move-status <itemId> "<Todo | In Progress | In Review | Done>"',
      )
      process.exit(2)
    }
    const { owner, repo } = await detectRepo()
    const project = await resolveProject(owner, repo)
    await moveStatus(project, itemId, status)
    return
  }

  console.error(`Unknown subcommand: ${subcommand ?? "(none)"}`)
  console.error("Available: related, move-status")
  process.exit(2)
}

await main()
