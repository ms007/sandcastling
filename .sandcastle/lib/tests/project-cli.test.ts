/**
 * CLI dispatcher tests for project-cli.ts.
 *
 * These tests cover the argv-validation paths that exit early without ever
 * reaching `gh` — so they run hermetically in CI without GitHub auth or a
 * configured project. The `gh`-touching paths (`related <n>` with valid n,
 * `move-status <itemId> <Status>`, `unblock-dependents <n>`) are exercised
 * in production runs and are not unit-tested here.
 */
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { describe, it } from "node:test"

const CLI_PATH = ".sandcastle/lib/project-cli.ts"

const cli = (...args: string[]) =>
  spawnSync("node", ["--import", "tsx", CLI_PATH, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  })

describe("project-cli argv validation", () => {
  it("prints usage and exits 2 when called with no subcommand", () => {
    const r = cli()
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Unknown subcommand/)
    assert.match(r.stderr, /Available: related, move-status, unblock-dependents/)
  })

  it("prints usage and exits 2 for an unknown subcommand", () => {
    const r = cli("nope")
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Unknown subcommand: nope/)
  })

  it("rejects 'related' without an argument", () => {
    const r = cli("related")
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Usage: bun \.sandcastle\/lib\/project-cli\.ts related <issue-number>/)
  })

  it("rejects 'related' with a non-numeric argument", () => {
    const r = cli("related", "not-a-number")
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Usage:/)
  })

  it("rejects 'related' with a non-positive integer (zero)", () => {
    const r = cli("related", "0")
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Usage:/)
  })

  it("rejects 'related' with a negative integer", () => {
    const r = cli("related", "-3")
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Usage:/)
  })

  it("rejects 'related' with a non-integer numeric argument (decimal)", () => {
    const r = cli("related", "1.5")
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Usage:/)
  })

  it("rejects 'move-status' without an itemId", () => {
    const r = cli("move-status")
    assert.equal(r.status, 2)
    assert.match(
      r.stderr,
      /Usage: bun \.sandcastle\/lib\/project-cli\.ts move-status <itemId> "<Todo \| In Progress \| In Review \| Done>"/,
    )
  })

  it("rejects 'move-status' without a status name", () => {
    const r = cli("move-status", "PVTI_x")
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Usage:/)
  })

  it("rejects 'move-status' with a non-canonical status name", () => {
    const r = cli("move-status", "PVTI_x", "Hot Mess")
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Usage:/)
  })

  it("rejects 'move-status' with a status name in the wrong case (status names are case-sensitive)", () => {
    const r = cli("move-status", "PVTI_x", "todo")
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Usage:/)
  })

  it("rejects 'unblock-dependents' without an argument", () => {
    const r = cli("unblock-dependents")
    assert.equal(r.status, 2)
    assert.match(
      r.stderr,
      /Usage: bun \.sandcastle\/lib\/project-cli\.ts unblock-dependents <issue-number>/,
    )
  })

  it("rejects 'unblock-dependents' with a non-numeric argument", () => {
    const r = cli("unblock-dependents", "not-a-number")
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Usage:/)
  })

  it("rejects 'unblock-dependents' with a non-positive integer (zero)", () => {
    const r = cli("unblock-dependents", "0")
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Usage:/)
  })

  it("rejects 'unblock-dependents' with a negative integer", () => {
    const r = cli("unblock-dependents", "-3")
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Usage:/)
  })

  it("rejects 'unblock-dependents' with a decimal", () => {
    const r = cli("unblock-dependents", "1.5")
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Usage:/)
  })
})
