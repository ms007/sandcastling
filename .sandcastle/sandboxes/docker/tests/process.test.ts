import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import { DockerCommandError, assertOk, registerForCleanup } from "../process.ts"

describe("DockerCommandError", () => {
  it("prefixes the operation and exposes the original error as cause", () => {
    const cause = new Error("ENOENT")
    const err = new DockerCommandError("run", cause)
    assert.equal(err.name, "DockerCommandError")
    assert.equal(err.message, "docker run failed: ENOENT")
    assert.equal(err.cause, cause)
  })

  it("is an instance of Error so it propagates through normal try/catch", () => {
    const err = new DockerCommandError("rm", new Error("x"))
    assert.ok(err instanceof Error)
    assert.ok(err instanceof DockerCommandError)
  })
})

describe("assertOk", () => {
  it("returns silently on exit code 0", () => {
    assertOk({ stdout: "", stderr: "", exitCode: 0 }, "exec")
  })

  it("throws with the operation name and the exit code on failure", () => {
    assert.throws(
      () => assertOk({ stdout: "", stderr: "boom", exitCode: 2 }, "rm"),
      /docker rm exited 2: boom/,
    )
  })

  it("falls back to stdout when stderr is whitespace-only", () => {
    assert.throws(
      () => assertOk({ stdout: "out-message", stderr: "  ", exitCode: 1 }, "ls"),
      /docker ls exited 1: out-message/,
    )
  })

  it("trims whitespace from the detail string", () => {
    assert.throws(
      () => assertOk({ stdout: "", stderr: "\n  trimmed  \n", exitCode: 7 }, "exec"),
      /docker exec exited 7: trimmed/,
    )
  })

  it("handles a non-zero exit with both stdout and stderr empty", () => {
    assert.throws(
      () => assertOk({ stdout: "", stderr: "", exitCode: 9 }, "rm"),
      /docker rm exited 9: ?/,
    )
  })
})

describe("registerForCleanup", () => {
  it("returns an unregister function that is idempotent", () => {
    const unregister = registerForCleanup("ctr-test-idempotent")
    unregister()
    // Calling again must not throw — the underlying Set delete is a no-op
    // for absent entries.
    unregister()
  })

  it("registers many containers without leaking signal listeners", () => {
    // Per the docblock: "any number of sandboxes share a single set of
    // exit/SIGINT/SIGTERM listeners". So 50 registrations must not multiply
    // the listener count by 50.
    const before = process.listenerCount("SIGINT")
    const unregisters = Array.from({ length: 50 }, (_, i) =>
      registerForCleanup(`ctr-test-noleak-${i}`),
    )
    const after = process.listenerCount("SIGINT")
    // Either the handler was already installed (delta = 0) or this batch
    // triggered the one-time install (delta = 1). Anything else is a leak.
    assert.ok(after - before <= 1, `expected at most +1 SIGINT listener, got +${after - before}`)
    for (const u of unregisters) u()
  })

  it("installs handlers exactly once across many register/unregister cycles", () => {
    const before = process.listenerCount("SIGTERM")
    for (let i = 0; i < 20; i += 1) {
      const u = registerForCleanup(`ctr-test-cycle-${i}`)
      u()
    }
    const after = process.listenerCount("SIGTERM")
    assert.ok(after - before <= 1)
  })
})
