import { strict as assert } from "node:assert"
import { readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import type { TickEvent } from "../manager/workflow.ts"
import { __testing } from "../orchestrator.ts"

const { openTranscriptSink } = __testing

const makeDir = () =>
  join(tmpdir(), `transcript-sink-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)

function fakeTickEvent(actionTag: string, issueNumber: number): TickEvent {
  return {
    tickCount: 0,
    observation: {
      seed: {
        issue: { number: 1, title: "seed", itemId: null, branch: "b" },
        phase: "todo",
        aheadOfBase: 0,
        markerComments: [],
        reworkReason: null,
        blockedBy: [],
        isPrd: false,
      },
      children: [],
      tickCount: 0,
      tickCap: 100,
      attemptCap: 100,
      stageAttempts: new Map(),
      prevObservationHash: null,
      prevAction: null,
    },
    decision: {
      tag: "act" as const,
      action: {
        tag: actionTag as "runImplementer",
        issue: {
          number: issueNumber,
          title: `issue-${issueNumber}`,
          itemId: null,
          branch: `sandcastle/issue-${issueNumber}`,
        },
      },
    },
  }
}

function waitTickEvent(): TickEvent {
  return {
    tickCount: 0,
    observation: {
      seed: {
        issue: { number: 1, title: "seed", itemId: null, branch: "b" },
        phase: "todo",
        aheadOfBase: 0,
        markerComments: [],
        reworkReason: null,
        blockedBy: [],
        isPrd: false,
      },
      children: [],
      tickCount: 0,
      tickCap: 100,
      attemptCap: 100,
      stageAttempts: new Map(),
      prevObservationHash: null,
      prevAction: null,
    },
    decision: { tag: "done" as const },
  }
}

describe("transcript-sink", () => {
  it("header line includes runId alongside seed, owner, and repo", async () => {
    const dir = makeDir()
    try {
      const sink = await openTranscriptSink(42, "01JTEST_RUNID", "myorg", "myrepo", {
        kind: "file",
        dir,
      })
      await sink.close(null)
      assert.ok(sink.path)
      assert.equal(sink.path, join(dir, "01JTEST_RUNID", "workflow.log"))
      const content = await readFile(sink.path, "utf8")
      assert.match(content, /\[start\] seed=42 runId=01JTEST_RUNID owner=myorg repo=myrepo/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("graceful close writes result footer with runId", async () => {
    const dir = makeDir()
    try {
      const sink = await openTranscriptSink(42, "01JGRACEFUL", "org", "repo", {
        kind: "file",
        dir,
      })
      await sink.close({ tag: "done", tickCount: 5 })
      assert.ok(sink.path)
      assert.equal(sink.path, join(dir, "01JGRACEFUL", "workflow.log"))
      const content = await readFile(sink.path, "utf8")
      assert.match(content, /\[result\] runId=01JGRACEFUL/)
      assert.match(content, /"tag":"done"/)
      assert.ok(!content.includes("[crashed]"))
      assert.ok(!content.includes("[aborted]"))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("aborted footer written when no result and no error", async () => {
    const dir = makeDir()
    try {
      const sink = await openTranscriptSink(1, "01JABORT_RUNID", "o", "r", {
        kind: "file",
        dir,
      })
      await sink.close(null)
      assert.ok(sink.path)
      assert.equal(sink.path, join(dir, "01JABORT_RUNID", "workflow.log"))
      const content = await readFile(sink.path, "utf8")
      assert.match(content, /\[aborted\]/)
      assert.ok(!content.includes("[result]"))
      assert.ok(!content.includes("[crashed]"))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("close-with-error after ticks writes crashed footer with runId, message, stack, and last issue/stage", async () => {
    const dir = makeDir()
    try {
      const sink = await openTranscriptSink(42, "01JCRASHED", "org", "repo", {
        kind: "file",
        dir,
      })
      sink.onTick(fakeTickEvent("runImplementer", 7))
      const error = new Error("sandbox blew up")
      await sink.close(null, error)
      assert.ok(sink.path)
      const content = await readFile(sink.path, "utf8")
      assert.match(content, /\[crashed\] runId=01JCRASHED/)
      assert.match(content, /issue=7/)
      assert.match(content, /stage=runImplementer/)
      assert.ok(content.includes("sandbox blew up"))
      assert.ok(error.stack && content.includes(error.stack))
      assert.ok(!content.includes("[result]"))
      assert.ok(!content.includes("[aborted]"))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("close-with-error before any tick writes crashed footer with null fields", async () => {
    const dir = makeDir()
    try {
      const sink = await openTranscriptSink(42, "01JEARLYCRASH", "org", "repo", {
        kind: "file",
        dir,
      })
      const error = new Error("early crash")
      await sink.close(null, error)
      assert.ok(sink.path)
      const content = await readFile(sink.path, "utf8")
      assert.match(content, /\[crashed\] runId=01JEARLYCRASH/)
      assert.match(content, /issue=null/)
      assert.match(content, /stage=null/)
      assert.ok(content.includes("early crash"))
      assert.ok(!content.includes("[result]"))
      assert.ok(!content.includes("[aborted]"))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("lastTarget tracks the most recent act tick", async () => {
    const dir = makeDir()
    try {
      const sink = await openTranscriptSink(42, "01JMULTI", "org", "repo", {
        kind: "file",
        dir,
      })
      sink.onTick(fakeTickEvent("runImplementer", 3))
      sink.onTick(fakeTickEvent("runReviewer", 5))
      const error = new Error("late crash")
      await sink.close(null, error)
      assert.ok(sink.path)
      const content = await readFile(sink.path, "utf8")
      assert.match(content, /issue=5/)
      assert.match(content, /stage=runReviewer/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("non-act decisions do not update lastTarget", async () => {
    const dir = makeDir()
    try {
      const sink = await openTranscriptSink(42, "01JNONACT", "org", "repo", {
        kind: "file",
        dir,
      })
      sink.onTick(fakeTickEvent("runImplementer", 9))
      sink.onTick(waitTickEvent())
      const error = new Error("crash after wait")
      await sink.close(null, error)
      assert.ok(sink.path)
      const content = await readFile(sink.path, "utf8")
      assert.match(content, /issue=9/)
      assert.match(content, /stage=runImplementer/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("two runs with different runIds produce distinct directories", async () => {
    const dir = makeDir()
    try {
      const sink1 = await openTranscriptSink(1, "01JRUN_AAA", "o", "r", { kind: "file", dir })
      const sink2 = await openTranscriptSink(1, "01JRUN_BBB", "o", "r", { kind: "file", dir })
      await sink1.close(null)
      await sink2.close(null)
      assert.ok(sink1.path)
      assert.ok(sink2.path)
      assert.notEqual(sink1.path, sink2.path)
      assert.equal(sink1.path, join(dir, "01JRUN_AAA", "workflow.log"))
      assert.equal(sink2.path, join(dir, "01JRUN_BBB", "workflow.log"))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("off mode is a no-op for all paths", async () => {
    const sink = await openTranscriptSink(42, "01JOFF", "org", "repo", { kind: "off" })
    assert.equal(sink.path, undefined)
    sink.onTick(fakeTickEvent("runImplementer", 1))
    await sink.close(null, new Error("crash in off mode"))
  })
})
