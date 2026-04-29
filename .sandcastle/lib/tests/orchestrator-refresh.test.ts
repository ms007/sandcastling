import { strict as assert } from "node:assert"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, it } from "node:test"
import type { BaseRef } from "../git.ts"
import type { WorkflowResult } from "../manager/index.ts"
import { refreshHostWorktree } from "../orchestrator.ts"

describe("refreshHostWorktree (real git)", () => {
  let repo: string
  let originalCwd: string
  const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim()

  /**
   * Mirror what `casFastForward` does in production: advance `refs/heads/main`
   * to a new commit *without* touching the host's index or working tree. Uses
   * `commit-tree` + `update-ref` so the on-disk state diverges from HEAD in
   * exactly the way the orchestrator leaves it after a successful merger run.
   *
   * Returns the new tip SHA. The new commit replaces `tracked.txt` with
   * `newContent`, simulating a real merger result rather than an empty advance.
   */
  const advanceMainViaUpdateRef = (newContent: string, message: string): string => {
    const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: repo,
      encoding: "utf8",
      input: newContent,
    }).trim()
    const tree = execFileSync("git", ["mktree"], {
      cwd: repo,
      encoding: "utf8",
      input: `100644 blob ${blob}\ttracked.txt\n`,
    }).trim()
    const parent = git("rev-parse", "main")
    const newCommit = execFileSync("git", ["commit-tree", tree, "-p", parent, "-m", message], {
      cwd: repo,
      encoding: "utf8",
    }).trim()
    git("update-ref", "refs/heads/main", newCommit)
    return newCommit
  }

  before(() => {
    originalCwd = process.cwd()
    repo = mkdtempSync(join(tmpdir(), "sandcastle-refresh-test-"))
    process.chdir(repo)
    git("init", "-b", "main", "-q")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "Test")
    writeFileSync(join(repo, "tracked.txt"), "starting\n")
    git("add", "tracked.txt")
    git("commit", "-m", "initial")
  })

  after(() => {
    process.chdir(originalCwd)
    rmSync(repo, { recursive: true, force: true })
  })

  it("happy path: ref advanced via update-ref, tree aligned to new tip", () => {
    const baseSha = git("rev-parse", "main")
    const baseRef: BaseRef = { sha: baseSha, refName: "main" }

    // Real bug scenario: advance the ref low-level so the host's index still
    // reflects baseSha while HEAD (via refs/heads/main) resolves to a new tip
    // with different file contents.
    const newTip = advanceMainViaUpdateRef("advanced\n", "merger advance")
    assert.notEqual(baseSha, newTip)
    // Sanity: the working tree was NOT touched by update-ref.
    assert.equal(readFileSync(join(repo, "tracked.txt"), "utf8"), "starting\n")

    const result: WorkflowResult = { tag: "done", tickCount: 1 }
    const logs: string[] = []
    refreshHostWorktree(baseRef, result, (msg) => logs.push(msg))

    // Working tree HEAD matches the new tip and the file content was updated.
    assert.equal(git("rev-parse", "HEAD"), newTip)
    assert.equal(readFileSync(join(repo, "tracked.txt"), "utf8"), "advanced\n")
    // Log mentions the refresh fired.
    assert.ok(
      logs.some((l) => l.includes("Refreshed")),
      `Expected 'Refreshed' log, got: ${JSON.stringify(logs)}`,
    )

    // Restore baseline content for subsequent tests.
    writeFileSync(join(repo, "tracked.txt"), "starting\n")
    git("add", "tracked.txt")
    git("commit", "-m", "restore baseline")
  })

  it("no-op when ref did not move", () => {
    const baseSha = git("rev-parse", "main")
    const baseRef: BaseRef = { sha: baseSha, refName: "main" }

    const result: WorkflowResult = { tag: "done", tickCount: 1 }
    const logs: string[] = []
    refreshHostWorktree(baseRef, result, (msg) => logs.push(msg))

    assert.ok(
      logs.some((l) => l.includes("did not move")),
      `Expected 'did not move' skip reason, got: ${JSON.stringify(logs)}`,
    )
  })

  it("no-op on detached HEAD", () => {
    const baseSha = git("rev-parse", "main")
    const baseRef: BaseRef = { sha: baseSha, refName: "HEAD" }

    const result: WorkflowResult = { tag: "done", tickCount: 1 }
    const logs: string[] = []
    refreshHostWorktree(baseRef, result, (msg) => logs.push(msg))

    assert.ok(
      logs.some((l) => l.includes("detached HEAD")),
      `Expected 'detached HEAD' skip reason, got: ${JSON.stringify(logs)}`,
    )
  })

  it("no-op on blocked result", () => {
    const baseSha = git("rev-parse", "main")
    const baseRef: BaseRef = { sha: baseSha, refName: "main" }

    const result: WorkflowResult = {
      tag: "blocked",
      reason: "tickCap",
      ticks: 5,
      tickCount: 1,
    }
    const logs: string[] = []
    refreshHostWorktree(baseRef, result, (msg) => logs.push(msg))

    assert.ok(
      logs.some((l) => l.includes("not done")),
      `Expected 'not done' skip reason, got: ${JSON.stringify(logs)}`,
    )
  })

  it("no-op when host HEAD has been switched off the starting branch", () => {
    const baseSha = git("rev-parse", "main")
    const baseRef: BaseRef = { sha: baseSha, refName: "main" }

    // Advance main so ref moved.
    git("commit", "--allow-empty", "-m", "advance for switch-off test")

    // Switch to a different branch.
    git("checkout", "-q", "-b", "other-branch")

    const result: WorkflowResult = { tag: "done", tickCount: 1 }
    const logs: string[] = []
    refreshHostWorktree(baseRef, result, (msg) => logs.push(msg))

    assert.ok(
      logs.some((l) => l.includes("switched")),
      `Expected 'switched' skip reason, got: ${JSON.stringify(logs)}`,
    )

    // Go back to main for subsequent tests.
    git("checkout", "-q", "main")
    git("branch", "-D", "other-branch")
  })

  it("untracked files survive across refresh", () => {
    const baseSha = git("rev-parse", "main")
    const baseRef: BaseRef = { sha: baseSha, refName: "main" }

    // Create an untracked file.
    writeFileSync(join(repo, "untracked.txt"), "should survive")

    // Advance main.
    git("commit", "--allow-empty", "-m", "advance for untracked test")

    const result: WorkflowResult = { tag: "done", tickCount: 1 }
    const logs: string[] = []
    refreshHostWorktree(baseRef, result, (msg) => logs.push(msg))

    // Untracked file still present.
    const content = readFileSync(join(repo, "untracked.txt"), "utf8")
    assert.equal(content, "should survive")

    // Clean up untracked file.
    rmSync(join(repo, "untracked.txt"))
  })

  it("no-op when branch was deleted during workflow", () => {
    git("checkout", "-q", "-b", "ephemeral")
    git("commit", "--allow-empty", "-m", "on ephemeral")
    const ephemeralSha = git("rev-parse", "ephemeral")
    git("checkout", "-q", "main")
    git("branch", "-D", "ephemeral")

    const baseRef: BaseRef = { sha: ephemeralSha, refName: "ephemeral" }
    const result: WorkflowResult = { tag: "done", tickCount: 1 }
    const logs: string[] = []
    refreshHostWorktree(baseRef, result, (msg) => logs.push(msg))

    assert.ok(
      logs.some((l) => l.includes("did not move")),
      `Expected 'did not move' skip reason for missing ref, got: ${JSON.stringify(logs)}`,
    )
  })

  it("no-op when worktree has staged-only changes", () => {
    writeFileSync(join(repo, "staged-only.txt"), "original")
    git("add", "staged-only.txt")
    git("commit", "-m", "add staged-only file")

    const preAdvanceSha = git("rev-parse", "main")
    git("commit", "--allow-empty", "-m", "advance for staged-dirty test")

    const baseRef: BaseRef = { sha: preAdvanceSha, refName: "main" }

    writeFileSync(join(repo, "staged-only.txt"), "edited")
    git("add", "staged-only.txt")

    const result: WorkflowResult = { tag: "done", tickCount: 1 }
    const logs: string[] = []
    refreshHostWorktree(baseRef, result, (msg) => logs.push(msg))

    assert.ok(
      logs.some((l) => l.includes("dirty")),
      `Expected 'dirty' skip reason for staged changes, got: ${JSON.stringify(logs)}`,
    )

    git("reset", "--", "staged-only.txt")
    git("checkout", "--", "staged-only.txt")
  })

  it("no-op when worktree is dirty", () => {
    // Create a tracked file, commit it, then modify it to dirty the tree.
    writeFileSync(join(repo, "tracked.txt"), "original")
    git("add", "tracked.txt")
    git("commit", "-m", "add tracked file")

    const preAdvanceSha = git("rev-parse", "main")
    // Advance main.
    git("commit", "--allow-empty", "-m", "advance for dirty test")

    // Use the sha from before the advance so ref appears moved.
    const baseRef: BaseRef = { sha: preAdvanceSha, refName: "main" }

    // Dirty the worktree.
    writeFileSync(join(repo, "tracked.txt"), "modified")

    const result: WorkflowResult = { tag: "done", tickCount: 1 }
    const logs: string[] = []
    refreshHostWorktree(baseRef, result, (msg) => logs.push(msg))

    assert.ok(
      logs.some((l) => l.includes("dirty")),
      `Expected 'dirty' skip reason, got: ${JSON.stringify(logs)}`,
    )

    // Restore tracked file and clean up.
    git("checkout", "--", "tracked.txt")
    // But we need the base to be correct for future tests, re-read sha.
  })
})
