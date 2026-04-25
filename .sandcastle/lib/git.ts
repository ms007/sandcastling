import { execFileSync } from "node:child_process"

export interface BaseRef {
  readonly sha: string
  readonly refName: string
}

const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8" }).trim()

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
