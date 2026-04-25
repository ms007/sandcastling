/**
 * Real-subprocess tests for git helpers.
 *
 * Each Node `--test` file runs in its own subprocess, so the `process.chdir`
 * we do here is contained — it does not leak into other test files.
 */
import { strict as assert } from "node:assert"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, it } from "node:test"
import { captureBaseRef, countCommitsAhead, formatBaseRef } from "../git.ts"

describe("git helpers (real subprocess)", () => {
  let repo: string
  let originalCwd: string

  before(() => {
    originalCwd = process.cwd()
    repo = mkdtempSync(join(tmpdir(), "sandcastle-git-test-"))
    process.chdir(repo)
    const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim()
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
  })
})
