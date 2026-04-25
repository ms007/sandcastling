import { execFileSync } from "node:child_process"

export interface BaseRef {
  readonly sha: string
  readonly refName: string
}

export interface BranchCommit {
  readonly sha: string
  readonly subject: string
}

/**
 * Snapshot of a single git branch relative to a frozen base SHA. Surfaced to
 * the planner so it can spot stale work left behind by a crashed previous run
 * (e.g. an issue parked at "In Review" with a branch ahead of base).
 */
export interface BranchInfo {
  readonly name: string
  /** `true` when `refs/heads/<name>` resolves locally. */
  readonly exists: boolean
  /** Commits on the branch that are not in the base. `0` for non-existent or up-to-date branches. */
  readonly aheadOfBase: number
  /** Tip SHA of the branch, or `null` when the branch does not exist. */
  readonly headSha: string | null
  /** Up to `commitLimit` commits in `base..branch`, newest first. Empty when `aheadOfBase === 0`. */
  readonly commits: readonly BranchCommit[]
}

const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8" }).trim()

const tryGit = (...args: string[]): string | null => {
  try {
    return git(...args)
  } catch {
    return null
  }
}

/**
 * Snapshot of the host's HEAD at orchestrator start. Used by the implementer
 * progress check so resumed runs can recognise commits left behind by an
 * earlier (crashed) iteration as "already implemented".
 */
export const captureBaseRef = (): BaseRef => ({
  sha: git("rev-parse", "HEAD"),
  refName: git("rev-parse", "--abbrev-ref", "HEAD"),
})

export const formatBaseRef = (ref: BaseRef): string => `${ref.refName} (${ref.sha.slice(0, 7)})`

export const countCommitsAhead = (baseSha: string, branch: string): number =>
  Number(git("rev-list", "--count", `${baseSha}..refs/heads/${branch}`))

/** Conventional sandcastle branch name for a given issue. Single source of truth. */
export const issueBranchName = (issueNumber: number): string => `sandcastle/issue-${issueNumber}`

/**
 * Inspect a local branch relative to a base SHA. Returns `exists: false` when
 * the branch is not present locally. `commitLimit` caps how many commits show
 * up in `commits`; the diff count itself (`aheadOfBase`) is unbounded.
 */
export const readBranchInfo = (baseSha: string, branch: string, commitLimit = 20): BranchInfo => {
  const ref = `refs/heads/${branch}`
  const headSha = tryGit("rev-parse", "--verify", ref)
  if (!headSha) {
    return {
      name: branch,
      exists: false,
      aheadOfBase: 0,
      headSha: null,
      commits: [],
    }
  }
  const aheadOfBase = countCommitsAhead(baseSha, branch)
  if (aheadOfBase === 0) {
    return { name: branch, exists: true, aheadOfBase: 0, headSha, commits: [] }
  }
  const log = git("log", `-${commitLimit}`, "--format=%H%x09%s", `${baseSha}..${ref}`)
  const commits = log
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const tab = line.indexOf("\t")
      return tab < 0
        ? { sha: line, subject: "" }
        : { sha: line.slice(0, tab), subject: line.slice(tab + 1) }
    })
  return { name: branch, exists: true, aheadOfBase, headSha, commits }
}
