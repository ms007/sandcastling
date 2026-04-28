/**
 * Real-subprocess tests for git helpers.
 *
 * Each Node `--test` file runs in its own subprocess, so the `process.chdir`
 * we do here is contained — it does not leak into other test files.
 */
import { strict as assert } from "node:assert"
import { execFileSync } from "node:child_process"
import { mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, it } from "node:test"
import {
  captureBaseRef,
  casFastForward,
  countCommitsAhead,
  ensureCleanWorktree,
  formatBaseRef,
  issueBranchName,
  listWorktreesForBranch,
  readBranchInfo,
  resolveRef,
  safeDeleteBranch,
  tempMergerBranchName,
} from "../git.ts"

describe("git helpers (real subprocess)", () => {
  let repo: string
  let originalCwd: string
  /** Convenience wrapper — runs `git` in the test repo and returns trimmed stdout. */
  const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim()

  before(() => {
    originalCwd = process.cwd()
    // Canonicalize so worktree-list (which returns realpaths) matches on macOS,
    // where /var is symlinked to /private/var.
    repo = realpathSync(mkdtempSync(join(tmpdir(), "sandcastle-git-test-")))
    process.chdir(repo)
    git("init", "-b", "main", "-q")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "Test")
    git("commit", "--allow-empty", "-m", "first")
    git("commit", "--allow-empty", "-m", "second")
    git("commit", "--allow-empty", "-m", "third")
    // Branch "feature" with two extra commits ahead of main.
    git("checkout", "-q", "-b", "feature")
    git("commit", "--allow-empty", "-m", "feat-1")
    git("commit", "--allow-empty", "-m", "feat-2")
    git("checkout", "-q", "main")
  })

  after(() => {
    process.chdir(originalCwd)
    rmSync(repo, { recursive: true, force: true })
  })

  describe("captureBaseRef", () => {
    it("returns a 40-char SHA and the branch shorthand for HEAD", () => {
      const ref = captureBaseRef()
      assert.match(ref.sha, /^[0-9a-f]{40}$/)
      assert.equal(ref.refName, "main")
    })

    it("changes refName when HEAD moves to a different branch", () => {
      execFileSync("git", ["checkout", "-q", "feature"], { cwd: repo })
      try {
        const ref = captureBaseRef()
        assert.equal(ref.refName, "feature")
      } finally {
        execFileSync("git", ["checkout", "-q", "main"], { cwd: repo })
      }
    })
  })

  describe("formatBaseRef", () => {
    it("renders 'branch (short-sha)'", () => {
      const ref = {
        sha: "abcdef1234567890abcdef1234567890abcdef12",
        refName: "main",
      }
      assert.equal(formatBaseRef(ref), "main (abcdef1)")
    })

    it("uses exactly the first 7 chars of the SHA", () => {
      const ref = {
        sha: "0123456789abcdef0123456789abcdef01234567",
        refName: "x",
      }
      assert.equal(formatBaseRef(ref), "x (0123456)")
    })
  })

  describe("countCommitsAhead", () => {
    it("reports how many commits a branch has ahead of a base SHA", () => {
      const baseSha = execFileSync("git", ["rev-parse", "main"], {
        cwd: repo,
        encoding: "utf8",
      }).trim()
      assert.equal(countCommitsAhead(baseSha, "feature"), 2)
    })

    it("returns 0 when the branch tip equals the base SHA", () => {
      const baseSha = execFileSync("git", ["rev-parse", "main"], {
        cwd: repo,
        encoding: "utf8",
      }).trim()
      assert.equal(countCommitsAhead(baseSha, "main"), 0)
    })

    it("returns the right count for a branch one commit ahead", () => {
      execFileSync("git", ["checkout", "-q", "-b", "tiny"], { cwd: repo })
      try {
        execFileSync("git", ["commit", "--allow-empty", "-m", "x"], {
          cwd: repo,
        })
        execFileSync("git", ["checkout", "-q", "main"], { cwd: repo })
        const baseSha = execFileSync("git", ["rev-parse", "main"], {
          cwd: repo,
          encoding: "utf8",
        }).trim()
        assert.equal(countCommitsAhead(baseSha, "tiny"), 1)
      } finally {
        execFileSync("git", ["branch", "-q", "-D", "tiny"], { cwd: repo })
      }
    })

    it("returns 0 when the base SHA is the branch tip itself", () => {
      const headSha = execFileSync("git", ["rev-parse", "feature"], {
        cwd: repo,
        encoding: "utf8",
      }).trim()
      assert.equal(countCommitsAhead(headSha, "feature"), 0)
    })

    it("returns 0 when the branch does not exist locally", () => {
      const baseSha = execFileSync("git", ["rev-parse", "main"], {
        cwd: repo,
        encoding: "utf8",
      }).trim()
      assert.equal(countCommitsAhead(baseSha, "sandcastle/issue-does-not-exist"), 0)
    })
  })

  describe("issueBranchName", () => {
    it("renders the conventional sandcastle branch path", () => {
      assert.equal(issueBranchName(7), "sandcastle/issue-7")
      assert.equal(issueBranchName(123), "sandcastle/issue-123")
    })
  })

  describe("readBranchInfo", () => {
    const baseSha = (): string =>
      execFileSync("git", ["rev-parse", "main"], {
        cwd: repo,
        encoding: "utf8",
      }).trim()

    it("returns exists:false with empty defaults when the branch is missing", () => {
      const info = readBranchInfo(baseSha(), "does-not-exist")
      assert.equal(info.exists, false)
      assert.equal(info.aheadOfBase, 0)
      assert.equal(info.headSha, null)
      assert.deepEqual(info.commits, [])
      assert.equal(info.name, "does-not-exist")
    })

    it("returns exists:true with aheadOfBase:0 when the branch tip equals base", () => {
      const info = readBranchInfo(baseSha(), "main")
      assert.equal(info.exists, true)
      assert.equal(info.aheadOfBase, 0)
      assert.match(info.headSha ?? "", /^[0-9a-f]{40}$/)
      assert.deepEqual(info.commits, [])
    })

    it("lists commits in base..branch (newest first), capped by commitLimit", () => {
      const info = readBranchInfo(baseSha(), "feature", 1)
      assert.equal(info.exists, true)
      assert.equal(info.aheadOfBase, 2)
      assert.equal(info.commits.length, 1)
      assert.match(info.commits[0]?.sha ?? "", /^[0-9a-f]{40}$/)
      // The newest commit on `feature` is "feat-2" — see the `before` setup.
      assert.equal(info.commits[0]?.subject, "feat-2")
    })

    it("returns all commits when fewer than commitLimit are ahead", () => {
      const info = readBranchInfo(baseSha(), "feature")
      assert.equal(info.commits.length, 2)
      assert.deepEqual(
        info.commits.map((c) => c.subject),
        ["feat-2", "feat-1"],
      )
    })
  })

  describe("tempMergerBranchName", () => {
    it("returns a name under the sandcastle/tmp-merge/ prefix with seed, timestamp, and random suffix", () => {
      const name = tempMergerBranchName(42)
      assert.match(
        name,
        /^sandcastle\/tmp-merge\/42-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{12}$/,
      )
    })

    it("two calls in the same second never collide", () => {
      const a = tempMergerBranchName(1)
      const b = tempMergerBranchName(1)
      assert.notEqual(a, b)
    })

    it("includes the seed number in the name", () => {
      const name = tempMergerBranchName(999)
      assert.ok(name.includes("/999-"))
    })

    it("handles seed 0 without ambiguity", () => {
      const name = tempMergerBranchName(0)
      assert.match(name, /^sandcastle\/tmp-merge\/0-/)
    })

    it("handles a negative seed", () => {
      const name = tempMergerBranchName(-5)
      assert.ok(name.startsWith("sandcastle/tmp-merge/-5-"))
    })
  })

  describe("resolveRef", () => {
    it("returns kind:resolved with the tip SHA for an existing branch", () => {
      const result = resolveRef("main")
      assert.equal(result.kind, "resolved")
      if (result.kind === "resolved") {
        assert.match(result.sha, /^[0-9a-f]{40}$/)
      }
    })

    it("returns kind:missing for a non-existent ref", () => {
      const result = resolveRef("does-not-exist-at-all")
      assert.equal(result.kind, "missing")
    })
  })

  describe("casFastForward", () => {
    it("advances a branch when expected SHA matches current tip", () => {
      // Create a test branch from main.
      git("branch", "cas-test", "main")
      try {
        const oldSha = git("rev-parse", "cas-test")
        // Create a new commit to fast-forward to.
        const newSha = git("rev-parse", "feature")

        const result = casFastForward("cas-test", oldSha, newSha)
        assert.equal(result.kind, "ok")

        // Verify the branch now points to the new SHA.
        const actual = git("rev-parse", "cas-test")
        assert.equal(actual, newSha)
      } finally {
        execFileSync("git", ["branch", "-D", "cas-test"], { cwd: repo })
      }
    })

    it("refuses when the branch has moved (wrong expected SHA)", () => {
      git("branch", "cas-moved", "main")
      try {
        const wrongSha = "0000000000000000000000000000000000000000"
        const newSha = git("rev-parse", "feature")

        const result = casFastForward("cas-moved", wrongSha, newSha)
        assert.equal(result.kind, "moved")
        if (result.kind === "moved") {
          assert.match(result.actualSha, /^[0-9a-f]{40}$/)
        }

        // Verify the branch was NOT mutated.
        const actual = git("rev-parse", "cas-moved")
        assert.equal(actual, git("rev-parse", "main"))
      } finally {
        execFileSync("git", ["branch", "-D", "cas-moved"], { cwd: repo })
      }
    })

    it("returns kind:missing when the branch does not exist", () => {
      const result = casFastForward("no-such-branch-ever", "abc", "def")
      assert.equal(result.kind, "missing")
    })

    it("succeeds as a no-op when expectedSha equals newSha", () => {
      git("branch", "cas-noop", "main")
      try {
        const sha = git("rev-parse", "cas-noop")
        const result = casFastForward("cas-noop", sha, sha)
        assert.equal(result.kind, "ok")
        // Branch tip unchanged.
        assert.equal(git("rev-parse", "cas-noop"), sha)
      } finally {
        execFileSync("git", ["branch", "-D", "cas-noop"], { cwd: repo })
      }
    })
  })

  describe("safeDeleteBranch", () => {
    it("deletes a merged branch", () => {
      // Create a branch at the same commit as main (already merged).
      git("branch", "del-merged", "main")
      const ok = safeDeleteBranch("del-merged")
      assert.equal(ok, true)
      // Branch should be gone.
      const result = resolveRef("del-merged")
      assert.equal(result.kind, "missing")
    })

    it("refuses to delete an unmerged branch without force", () => {
      git("branch", "del-unmerged", "feature")
      try {
        assert.throws(() => safeDeleteBranch("del-unmerged"))
        // Branch should still exist.
        const result = resolveRef("del-unmerged")
        assert.equal(result.kind, "resolved")
      } finally {
        execFileSync("git", ["branch", "-D", "del-unmerged"], { cwd: repo })
      }
    })

    it("force-deletes an unmerged branch", () => {
      git("branch", "del-force", "feature")
      const ok = safeDeleteBranch("del-force", { force: true })
      assert.equal(ok, true)
      const result = resolveRef("del-force")
      assert.equal(result.kind, "missing")
    })

    it("returns false for a non-existent branch", () => {
      const ok = safeDeleteBranch("branch-that-never-existed")
      assert.equal(ok, false)
    })

    it("throws when trying to delete the currently checked-out branch", () => {
      git("checkout", "-q", "-b", "del-current")
      try {
        assert.throws(() => safeDeleteBranch("del-current"))
      } finally {
        git("checkout", "-q", "main")
        execFileSync("git", ["branch", "-D", "del-current"], { cwd: repo })
      }
    })
  })

  describe("listWorktreesForBranch", () => {
    it("returns the worktree path when the branch is checked out", () => {
      // `main` is checked out in our test repo's primary worktree.
      const paths = listWorktreesForBranch("main")
      assert.equal(paths.length, 1)
      assert.equal(paths[0], repo)
    })

    it("returns empty when the branch is not checked out anywhere", () => {
      const paths = listWorktreesForBranch("feature")
      assert.deepEqual(paths, [])
    })

    it("returns empty for a non-existent branch", () => {
      const paths = listWorktreesForBranch("no-such-branch-xyz")
      assert.deepEqual(paths, [])
    })
  })

  describe("captureBaseRef on detached HEAD", () => {
    it("returns refName: 'HEAD' when the host is on detached HEAD", () => {
      git("checkout", "--detach", "HEAD")
      try {
        const ref = captureBaseRef()
        assert.equal(ref.refName, "HEAD")
        assert.match(ref.sha, /^[0-9a-f]{40}$/)
      } finally {
        git("checkout", "-q", "main")
      }
    })
  })
})

describe("ensureCleanWorktree", () => {
  let repo: string
  let originalCwd: string
  const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim()
  const writeFile = (name: string, content: string) => writeFileSync(join(repo, name), content)

  before(() => {
    originalCwd = process.cwd()
    repo = realpathSync(mkdtempSync(join(tmpdir(), "sandcastle-dirty-test-")))
    process.chdir(repo)
    git("init", "-b", "main", "-q")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "Test")
    writeFile("tracked.txt", "initial\n")
    git("add", "tracked.txt")
    git("commit", "-m", "initial")
  })

  after(() => {
    process.chdir(originalCwd)
    rmSync(repo, { recursive: true, force: true })
  })

  it("returns silently on a clean repo", () => {
    assert.doesNotThrow(() => ensureCleanWorktree())
  })

  it("does not throw when only untracked files exist", () => {
    writeFile("scratch.txt", "untracked\n")
    try {
      assert.doesNotThrow(() => ensureCleanWorktree())
    } finally {
      unlinkSync(join(repo, "scratch.txt"))
    }
  })

  it("throws on modified-tracked-but-unstaged changes", () => {
    writeFile("tracked.txt", "modified\n")
    try {
      assert.throws(
        () => ensureCleanWorktree(),
        (err: Error) => {
          assert.match(err.message, /unstaged/)
          assert.doesNotMatch(err.message, /staged and unstaged/)
          return true
        },
      )
    } finally {
      git("checkout", "--", "tracked.txt")
    }
  })

  it("throws on staged changes", () => {
    writeFile("tracked.txt", "staged-edit\n")
    git("add", "tracked.txt")
    try {
      assert.throws(
        () => ensureCleanWorktree(),
        (err: Error) => {
          assert.match(err.message, /staged/)
          assert.doesNotMatch(err.message, /unstaged/)
          return true
        },
      )
    } finally {
      git("reset", "--", "tracked.txt")
      git("checkout", "--", "tracked.txt")
    }
  })

  it("throws naming both when staged and unstaged changes coexist", () => {
    writeFile("tracked.txt", "staged-edit\n")
    git("add", "tracked.txt")
    writeFile("tracked.txt", "then-more-unstaged\n")
    try {
      assert.throws(
        () => ensureCleanWorktree(),
        (err: Error) => {
          assert.match(err.message, /staged and unstaged/)
          return true
        },
      )
    } finally {
      git("reset", "--", "tracked.txt")
      git("checkout", "--", "tracked.txt")
    }
  })

  it("works on detached HEAD with a clean tree", () => {
    git("checkout", "--detach", "HEAD")
    try {
      assert.doesNotThrow(() => ensureCleanWorktree())
    } finally {
      git("checkout", "-q", "main")
    }
  })
})
