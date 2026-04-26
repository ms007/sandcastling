/**
 * Integration-flavored tests for commitMergerResultToBaseRef.
 *
 * Runs against a real ephemeral git repo to exercise the CAS fast-forward,
 * temp-branch cleanup, detached-HEAD bypass, and worktree-hint codepaths.
 * Log assertions use an injected log dependency, not stdout capture.
 */
import { strict as assert } from "node:assert"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, it } from "node:test"
import type { BaseRef } from "../git.ts"
import { resolveRef } from "../git.ts"
import { commitMergerResultToBaseRef } from "../orchestrator.ts"

describe("commitMergerResultToBaseRef (real git)", () => {
  let repo: string
  let originalCwd: string
  const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim()

  before(() => {
    originalCwd = process.cwd()
    repo = mkdtempSync(join(tmpdir(), "sandcastle-merger-test-"))
    process.chdir(repo)
    git("init", "-b", "main", "-q")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "Test")
    git("commit", "--allow-empty", "-m", "initial")
  })

  after(() => {
    process.chdir(originalCwd)
    rmSync(repo, { recursive: true, force: true })
  })

  it("happy path: base advances, temp branch deleted", () => {
    const baseSha = git("rev-parse", "main")
    const mergeBranch = "sandcastle/tmp-merge/happy"
    git("branch", mergeBranch, "main")
    git("checkout", "-q", mergeBranch)
    git("commit", "--allow-empty", "-m", "merger commit")
    const mergerTip = git("rev-parse", "HEAD")
    git("checkout", "-q", "main")

    const baseRef: BaseRef = { sha: baseSha, refName: "main" }
    const logs: string[] = []
    commitMergerResultToBaseRef(baseRef, mergeBranch, (msg) => logs.push(msg))

    // Base branch advanced to merger tip.
    assert.equal(git("rev-parse", "main"), mergerTip)
    // Temp branch deleted.
    assert.equal(resolveRef(mergeBranch).kind, "missing")
    // Log mentions the branch and short SHA.
    assert.ok(logs.some((l) => l.includes("main") && l.includes(mergerTip.slice(0, 7))))
  })

  it("stale-expected: helper throws, base unchanged, temp survives", () => {
    // Reset main to a known state.
    const baseSha = git("rev-parse", "main")
    const mergeBranch = "sandcastle/tmp-merge/stale"
    git("branch", mergeBranch, "main")
    git("checkout", "-q", mergeBranch)
    git("commit", "--allow-empty", "-m", "merger stale commit")
    git("checkout", "-q", "main")

    // Advance main concurrently so the CAS will fail.
    git("commit", "--allow-empty", "-m", "concurrent advance")
    const concurrentSha = git("rev-parse", "main")

    const baseRef: BaseRef = { sha: baseSha, refName: "main" }
    const logs: string[] = []
    assert.throws(
      () => commitMergerResultToBaseRef(baseRef, mergeBranch, (msg) => logs.push(msg)),
      (err: Error) => err.message.includes("moved") && err.message.includes(mergeBranch),
    )

    // Base branch is still at the concurrent SHA, NOT at baseSha.
    assert.equal(git("rev-parse", "main"), concurrentSha)
    // Temp branch survives (has unmerged commits).
    assert.equal(resolveRef(mergeBranch).kind, "resolved")
    // Clean up for subsequent tests.
    git("branch", "-D", mergeBranch)
  })

  it("detached-HEAD: helper no-ops cleanly", () => {
    const mergeBranch = "sandcastle/tmp-merge/detached"
    git("branch", mergeBranch, "main")

    const baseRef: BaseRef = { sha: git("rev-parse", "HEAD"), refName: "HEAD" }
    const logs: string[] = []
    commitMergerResultToBaseRef(baseRef, mergeBranch, (msg) => logs.push(msg))

    // Log says detached HEAD, names the temp branch.
    assert.ok(logs.some((l) => l.includes("Detached HEAD") && l.includes(mergeBranch)))
    // Early return before the try/finally — temp branch preserved as documented.

    // Clean up.
    git("branch", "-D", mergeBranch)
  })

  it("worktree-warn: hint message emitted when base branch is checked out", () => {
    const baseSha = git("rev-parse", "main")
    const mergeBranch = "sandcastle/tmp-merge/wt-hint"
    git("branch", mergeBranch, "main")
    git("checkout", "-q", mergeBranch)
    git("commit", "--allow-empty", "-m", "merger wt commit")
    git("checkout", "-q", "main")

    // main is checked out in the primary worktree — the hint should fire.
    const baseRef: BaseRef = { sha: baseSha, refName: "main" }
    const logs: string[] = []
    commitMergerResultToBaseRef(baseRef, mergeBranch, (msg) => logs.push(msg))

    assert.ok(
      logs.some((l) => l.includes("Hint") && l.includes("reset --hard")),
      `Expected a worktree hint, got: ${JSON.stringify(logs)}`,
    )
  })

  it("throws when merger branch does not exist (merger crashed)", () => {
    const baseRef: BaseRef = { sha: git("rev-parse", "main"), refName: "main" }
    const logs: string[] = []
    assert.throws(
      () =>
        commitMergerResultToBaseRef(baseRef, "sandcastle/tmp-merge/does-not-exist", (msg) =>
          logs.push(msg),
        ),
      (err: Error) => err.message.includes("not found") && err.message.includes("may have crashed"),
    )
  })

  it("throws when base branch was deleted concurrently", () => {
    const baseSha = git("rev-parse", "main")
    const mergeBranch = "sandcastle/tmp-merge/base-deleted"
    git("branch", mergeBranch, "main")
    git("checkout", "-q", mergeBranch)
    git("commit", "--allow-empty", "-m", "merger commit for deleted-base test")
    git("checkout", "-q", "main")

    // Use a non-existent branch as baseRef.refName to simulate deletion.
    const baseRef: BaseRef = { sha: baseSha, refName: "ghost-branch" }
    const logs: string[] = []
    assert.throws(
      () => commitMergerResultToBaseRef(baseRef, mergeBranch, (msg) => logs.push(msg)),
      (err: Error) => err.message.includes("no longer exists") && err.message.includes(mergeBranch),
    )
    // Temp branch survives (has unmerged commits).
    assert.equal(resolveRef(mergeBranch).kind, "resolved")
    git("branch", "-D", mergeBranch)
  })

  it("empty orphan temp branch is cleaned up in finally block", () => {
    const baseSha = git("rev-parse", "main")
    const mergeBranch = "sandcastle/tmp-merge/orphan-empty"
    // Create a temp branch at the same commit as main (no extra commits).
    git("branch", mergeBranch, "main")

    // Advance main so the CAS fails with "moved".
    git("commit", "--allow-empty", "-m", "advance for orphan test")
    const newMainSha = git("rev-parse", "main")

    const baseRef: BaseRef = { sha: baseSha, refName: "main" }
    assert.throws(
      () => commitMergerResultToBaseRef(baseRef, mergeBranch, () => {}),
      (err: Error) => err.message.includes("moved"),
    )

    // Main wasn't touched by the helper.
    assert.equal(git("rev-parse", "main"), newMainSha)
    // The empty orphan branch was cleaned up by the finally non-force delete,
    // because it has no unmerged commits (it's at the same point as an ancestor of main).
    assert.equal(resolveRef(mergeBranch).kind, "missing")
  })

  it("temp branch with commits survives the finally cleanup", () => {
    const baseSha = git("rev-parse", "main")
    const mergeBranch = "sandcastle/tmp-merge/orphan-commits"
    git("branch", mergeBranch, "main")
    git("checkout", "-q", mergeBranch)
    git("commit", "--allow-empty", "-m", "extra commit on temp")
    git("checkout", "-q", "main")

    // Advance main so CAS fails.
    git("commit", "--allow-empty", "-m", "advance for commit-orphan test")

    const baseRef: BaseRef = { sha: baseSha, refName: "main" }
    assert.throws(() => commitMergerResultToBaseRef(baseRef, mergeBranch, () => {}))

    // Temp branch with unmerged commits survives.
    assert.equal(resolveRef(mergeBranch).kind, "resolved")
    // Clean up.
    git("branch", "-D", mergeBranch)
  })
})
