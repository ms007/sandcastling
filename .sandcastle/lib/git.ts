import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"

export interface BaseRef {
  readonly sha: string
  readonly refName: string
}

/** Result of resolving a ref to a SHA. */
export type ResolveRefResult =
  | { readonly kind: "resolved"; readonly sha: string }
  | { readonly kind: "missing" }

/** Result of a compare-and-set fast-forward. */
export type CasFFResult =
  | { readonly kind: "ok" }
  | { readonly kind: "moved"; readonly actualSha: string }
  | { readonly kind: "missing" }

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
    // Pipe stderr so an expected miss (e.g. a not-yet-created branch) does not
    // leak `fatal: ...` noise into the orchestrator console.
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
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

/** Conventional 7-char short SHA used in human-facing log lines. */
export const shortSha = (sha: string): string => sha.slice(0, 7)

export const formatBaseRef = (ref: BaseRef): string => `${ref.refName} (${shortSha(ref.sha)})`

export const countCommitsAhead = (baseSha: string, branch: string): number => {
  // A missing local branch (expected before the implementer first runs) makes
  // rev-list fatal; treat that as zero commits ahead.
  const out = tryGit("rev-list", "--count", `${baseSha}..refs/heads/${branch}`)
  return out === null ? 0 : Number(out)
}

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

/** Branch-name prefix for short-lived merger working branches. Single source of truth. */
export const TMP_MERGE_PREFIX = "sandcastle/tmp-merge/"

/**
 * Generate a collision-resistant temporary merger branch name.
 * Format: `<TMP_MERGE_PREFIX><seed>-<ISO-timestamp>-<random-suffix>`
 *
 * Two calls in the same second never collide thanks to the 6-byte random suffix.
 */
export const tempMergerBranchName = (seed: number): string => {
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const suffix = randomBytes(6).toString("hex")
  return `${TMP_MERGE_PREFIX}${seed}-${ts}-${suffix}`
}

/**
 * Resolve a branch name to its tip SHA.
 * Returns `{ kind: "resolved", sha }` on success, `{ kind: "missing" }` when
 * the branch does not exist.
 */
export const resolveRef = (refName: string): ResolveRefResult => {
  const sha = tryGit("rev-parse", "--verify", `refs/heads/${refName}`)
  if (sha === null) return { kind: "missing" }
  return { kind: "resolved", sha }
}

/**
 * Atomic compare-and-set fast-forward of a branch ref.
 *
 * Advances `branch` from `expectedSha` to `newSha` only when the current tip
 * equals `expectedSha`. Uses `git update-ref` with the old-value check so the
 * operation is atomic.
 *
 * Returns `{ kind: "ok" }` on success, `{ kind: "moved", actualSha }` when the
 * branch has been updated by someone else, or `{ kind: "missing" }` when the
 * branch does not exist.
 */
export const casFastForward = (
  branch: string,
  expectedSha: string,
  newSha: string,
): CasFFResult => {
  const ref = `refs/heads/${branch}`
  // Single subprocess on the happy path: update-ref's old-value guard already
  // checks that current == expectedSha atomically. Only re-read the ref to
  // distinguish missing vs. moved when the guard rejects.
  if (tryGit("update-ref", ref, newSha, expectedSha) !== null) return { kind: "ok" }
  const actual = tryGit("rev-parse", "--verify", ref)
  if (actual === null) return { kind: "missing" }
  return { kind: "moved", actualSha: actual }
}

/**
 * Delete a branch safely. By default refuses to delete an unmerged branch
 * (like `git branch -d`). Pass `force: true` to force-delete (like `git branch -D`).
 *
 * Returns `true` when the branch was deleted, `false` when it did not exist.
 * Throws when the branch is unmerged and `force` is false.
 */
export const safeDeleteBranch = (branch: string, opts: { force?: boolean } = {}): boolean => {
  // Pre-check existence so the "missing branch" path doesn't depend on a
  // locale-specific stderr string from `git branch -d`.
  if (resolveRef(branch).kind === "missing") return false
  const flag = opts.force ? "-D" : "-d"
  git("branch", flag, branch)
  return true
}

/**
 * Throws when the working tree has tracked-file changes relative to `vsCommit`
 * (defaults to HEAD). Untracked files are tolerated.
 *
 * Anchor against an explicit `vsCommit` for the post-success refresh re-check:
 * by then the orchestrator has fast-forwarded `refs/heads/<branch>` via a
 * low-level update-ref, so the index still reflects the starting commit while
 * HEAD now resolves to the advanced tip — a HEAD-based check would read the
 * entire ref-advance diff as "staged" and skip the refresh.
 */
export const ensureCleanWorktree = (vsCommit?: string): void => {
  const tail = vsCommit ? [vsCommit] : []
  const hasUnstaged = tryGit("diff", "--quiet", ...tail) === null
  const hasStaged = tryGit("diff", "--cached", "--quiet", ...tail) === null

  if (!hasUnstaged && !hasStaged) return

  const kind = hasStaged && hasUnstaged ? "staged and unstaged" : hasStaged ? "staged" : "unstaged"
  throw new Error(
    `Dirty working tree: ${kind} tracked changes detected. The orchestrator advances refs at a low level and would leave the worktree in a confusing state. Stash, commit, or discard your changes, then re-run.`,
  )
}

/**
 * List worktree checkout paths that have `branch` checked out.
 * Returns an array of absolute paths (usually 0 or 1 element).
 */
export const listWorktreesForBranch = (branch: string): string[] => {
  const out = tryGit("worktree", "list", "--porcelain")
  if (out === null) return []
  const paths: string[] = []
  let currentPath: string | null = null
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length)
    } else if (line.startsWith("branch refs/heads/")) {
      const branchName = line.slice("branch refs/heads/".length)
      if (branchName === branch && currentPath !== null) {
        paths.push(currentPath)
      }
    } else if (line === "") {
      currentPath = null
    }
  }
  return paths
}
