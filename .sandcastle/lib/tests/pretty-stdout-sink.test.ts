import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import type { AgentStreamEvent } from "@ai-hero/sandcastle"
import type { StageStartEvent, TickEvent, WorkflowResult } from "../manager/index.ts"
import type { PaneHandle } from "../multiplexing-renderer.ts"
import type { OutputCapabilities } from "../palette.ts"
import { type RunHeader, openPrettyStdoutSink } from "../pretty-stdout-sink.ts"

const NO_COLOR: OutputCapabilities = { color: false, unicode: false, liveRedraw: false }
const UNICODE_NO_COLOR: OutputCapabilities = { color: false, unicode: true, liveRedraw: false }
const COLOR_ASCII: OutputCapabilities = { color: true, unicode: false, liveRedraw: false }

type PaneOp =
  | { type: "appendLine"; line: string }
  | { type: "appendSticky"; line: string }
  | { type: "setTitle"; title: string }
  | { type: "close"; summary: string }

function fakePaneHandle(): { pane: PaneHandle; ops: PaneOp[]; output: () => string } {
  const ops: PaneOp[] = []
  const pane: PaneHandle = {
    appendLine(line: string) {
      ops.push({ type: "appendLine", line })
    },
    appendSticky(line: string) {
      ops.push({ type: "appendSticky", line })
    },
    setTitle(title: string) {
      ops.push({ type: "setTitle", title })
    },
    close(summary: string) {
      ops.push({ type: "close", summary })
    },
  }
  const output = () =>
    ops
      .filter((o) => o.type === "appendLine" || o.type === "appendSticky")
      .map((o) => (o as { type: string; line: string }).line)
      .join("\n")
  return { pane, ops, output }
}

function makeHeader(overrides?: Partial<RunHeader>): RunHeader {
  return {
    runId: "01JTEST_RUN",
    seed: { number: 42, isPrd: true },
    children: [{ number: 10 }, { number: 11 }, { number: 12 }],
    logDir: "/tmp/logs/01JTEST_RUN",
    tickCap: 100,
    attemptCap: 5,
    ...overrides,
  }
}

function fakeTickEvent(actionTag: string, issueNumber: number): TickEvent {
  return {
    tickCount: 1,
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
      tickCount: 1,
      tickCap: 100,
      attemptCap: 5,
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

describe("pretty-stdout-sink", () => {
  describe("opening header", () => {
    it("renders run id, seed, children, log dir, and caps (ASCII)", () => {
      const { pane, output } = fakePaneHandle()
      openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      const text = output()
      assert.match(text, /Run 01JTEST_RUN/)
      assert.match(text, /seed #42 \(PRD\)/)
      assert.match(text, /3 child issue\(s\): #10, #11, #12/)
      assert.match(text, /Logs: \/tmp\/logs\/01JTEST_RUN/)
      assert.match(text, /tickCap=100/)
      assert.match(text, /attemptCap=5/)
    })

    it("renders unicode bullet when unicode enabled", () => {
      const { pane, output } = fakePaneHandle()
      openPrettyStdoutSink(pane, UNICODE_NO_COLOR, makeHeader())
      const text = output()
      assert.ok(text.includes("·"))
    })

    it("renders ASCII dash when unicode disabled", () => {
      const { pane, output } = fakePaneHandle()
      openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      const text = output()
      assert.ok(text.includes(" - seed"))
    })

    it("omits PRD label for non-PRD seed", () => {
      const { pane, output } = fakePaneHandle()
      openPrettyStdoutSink(pane, NO_COLOR, makeHeader({ seed: { number: 7, isPrd: false } }))
      const text = output()
      assert.match(text, /seed #7/)
      assert.ok(!text.includes("(PRD)"))
    })

    it("shows 'none' when no children", () => {
      const { pane, output } = fakePaneHandle()
      openPrettyStdoutSink(pane, NO_COLOR, makeHeader({ children: [] }))
      const text = output()
      assert.match(text, /0 child issue\(s\): none/)
    })

    it("omits log dir line when logDir is undefined", () => {
      const { pane, output } = fakePaneHandle()
      openPrettyStdoutSink(pane, NO_COLOR, makeHeader({ logDir: undefined }))
      const text = output()
      assert.ok(!text.includes("Logs:"))
    })

    it("emits ANSI bold and dim when color enabled", () => {
      const { pane, output } = fakePaneHandle()
      openPrettyStdoutSink(pane, COLOR_ASCII, makeHeader())
      const text = output()
      assert.ok(text.includes("\x1b[1m"), "expected ANSI bold")
      assert.ok(text.includes("\x1b[2m"), "expected ANSI dim")
      assert.ok(text.includes("\x1b[0m"), "expected ANSI reset")
    })
  })

  describe("run closer — done", () => {
    it("renders done with tick count and duration (ASCII)", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      const result: WorkflowResult = { tag: "done", tickCount: 17 }
      sink.close(result)
      const text = output()
      assert.match(text, /\[ok\] Run done/)
      assert.match(text, /17 ticks/)
    })

    it("renders done with unicode glyph", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, UNICODE_NO_COLOR, makeHeader())
      sink.close({ tag: "done", tickCount: 5 })
      const text = output()
      assert.match(text, /✓ Run done/)
    })

    it("emits ANSI green when color enabled", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, COLOR_ASCII, makeHeader())
      sink.close({ tag: "done", tickCount: 1 })
      const text = output()
      assert.ok(text.includes("\x1b[32m"), "expected ANSI green")
    })

    it("calls pane.close with summary", () => {
      const { pane, ops } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.close({ tag: "done", tickCount: 1 })
      const closeOps = ops.filter((o) => o.type === "close")
      assert.equal(closeOps.length, 1)
      assert.equal((closeOps[0] as { type: "close"; summary: string }).summary, "done")
    })
  })

  describe("run closer — blocked", () => {
    it("renders tickCap blocked (ASCII)", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      const result: WorkflowResult = {
        tag: "blocked",
        reason: "tickCap",
        ticks: 100,
        tickCount: 100,
      }
      sink.close(result)
      const text = output()
      assert.match(text, /\[blocked\] Run blocked/)
      assert.match(text, /tick cap reached \(100 ticks\)/)
    })

    it("renders stalled blocked", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      const issue = { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" }
      const result: WorkflowResult = {
        tag: "blocked",
        reason: "stalled",
        issue,
        stage: "runImplementer",
        tickCount: 8,
      }
      sink.close(result)
      const text = output()
      assert.match(text, /\[blocked\] Run blocked/)
      assert.match(text, /stalled on #31 at runImplementer/)
    })

    it("renders tooManyAttempts blocked", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      const issue = { number: 5, title: "issue-5", itemId: null, branch: "sandcastle/issue-5" }
      const result: WorkflowResult = {
        tag: "blocked",
        reason: "tooManyAttempts",
        issue,
        stage: "runReviewer",
        attempts: 3,
        tickCount: 12,
      }
      sink.close(result)
      const text = output()
      assert.match(text, /\[blocked\] Run blocked/)
      assert.match(text, /too many attempts on #5 at runReviewer \(3 attempts\)/)
    })

    it("emits ANSI yellow when color enabled", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, COLOR_ASCII, makeHeader())
      sink.close({ tag: "blocked", reason: "tickCap", ticks: 50, tickCount: 50 })
      const text = output()
      assert.ok(text.includes("\x1b[33m"), "expected ANSI yellow")
    })

    it("calls pane.close with blocked summary", () => {
      const { pane, ops } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.close({ tag: "blocked", reason: "tickCap", ticks: 50, tickCount: 50 })
      const closeOps = ops.filter((o) => o.type === "close")
      assert.equal(closeOps.length, 1)
      assert.match((closeOps[0] as { type: "close"; summary: string }).summary, /blocked.*tick cap/)
    })
  })

  describe("run closer — crashed", () => {
    it("renders crash with last target and log dir (ASCII)", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onTick(fakeTickEvent("runImplementer", 7))
      sink.close(null, new Error("sandbox blew up"))
      const text = output()
      assert.match(text, /\[error\] Run crashed at runImplementer #7/)
      assert.match(text, /see logs: \/tmp\/logs\/01JTEST_RUN/)
    })

    it("renders crash without target when no tick received", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.close(null, new Error("early crash"))
      const text = output()
      assert.match(text, /\[error\] Run crashed/)
      assert.ok(!text.includes(" at "))
    })

    it("renders crash with unicode glyph", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, UNICODE_NO_COLOR, makeHeader())
      sink.onTick(fakeTickEvent("runReviewer", 3))
      sink.close(null, new Error("oops"))
      const text = output()
      assert.match(text, /✗ Run crashed at runReviewer #3/)
    })

    it("omits log hint when logDir is undefined", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader({ logDir: undefined }))
      sink.close(null, new Error("crash"))
      const text = output()
      assert.match(text, /\[error\] Run crashed/)
      assert.ok(!text.includes("see logs"))
    })

    it("emits ANSI red when color enabled", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, COLOR_ASCII, makeHeader())
      sink.close(null, new Error("boom"))
      const text = output()
      assert.ok(text.includes("\x1b[31m"), "expected ANSI red")
    })

    it("calls pane.close with crashed summary", () => {
      const { pane, ops } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onTick(fakeTickEvent("runImplementer", 7))
      sink.close(null, new Error("sandbox blew up"))
      const closeOps = ops.filter((o) => o.type === "close")
      assert.equal(closeOps.length, 1)
      assert.match(
        (closeOps[0] as { type: "close"; summary: string }).summary,
        /crashed at runImplementer #7/,
      )
    })
  })

  describe("run closer — aborted", () => {
    it("renders aborted when no result and no error", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.close(null)
      const text = output()
      assert.match(text, /\[blocked\] Run aborted/)
    })

    it("calls pane.close with aborted summary", () => {
      const { pane, ops } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.close(null)
      const closeOps = ops.filter((o) => o.type === "close")
      assert.equal(closeOps.length, 1)
      assert.equal((closeOps[0] as { type: "close"; summary: string }).summary, "aborted")
    })
  })

  describe("tick tracking", () => {
    it("tracks the last act target across multiple ticks", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onTick(fakeTickEvent("runImplementer", 3))
      sink.onTick(fakeTickEvent("runReviewer", 5))
      sink.close(null, new Error("crash"))
      const text = output()
      assert.match(text, /at runReviewer #5/)
    })

    it("ignores non-act ticks for target tracking", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      const doneEvent: TickEvent = {
        ...fakeTickEvent("runImplementer", 99),
        decision: { tag: "done" as const },
      }
      sink.onTick(doneEvent)
      sink.close(null, new Error("crash"))
      const text = output()
      assert.match(text, /\[error\] Run crashed/)
      assert.ok(!text.includes(" at "))
    })

    it("preserves last act target when non-act tick follows", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onTick(fakeTickEvent("runImplementer", 3))
      const doneEvent: TickEvent = {
        ...fakeTickEvent("runReviewer", 99),
        decision: { tag: "done" as const },
      }
      sink.onTick(doneEvent)
      sink.close(null, new Error("crash"))
      const text = output()
      assert.match(text, /at runImplementer #3/)
    })
  })

  describe("stage header", () => {
    it("renders implement stage header (ASCII)", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      const event: StageStartEvent = {
        stage: "implement",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        wave: { index: 0, issues: [31] },
        attempt: 1,
      }
      sink.onStageStart(event)
      const text = output()
      assert.match(text, /\* #31 implement/)
      assert.match(text, /wave 1/)
      assert.match(text, /attempt 1/)
    })

    it("renders review stage header (unicode)", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, UNICODE_NO_COLOR, makeHeader())
      sink.onStageStart({
        stage: "review",
        issue: { number: 5, title: "issue-5", itemId: null, branch: "sandcastle/issue-5" },
        wave: { index: 1, issues: [5, 6] },
        attempt: 2,
      })
      const text = output()
      assert.match(text, /● #5 review/)
      assert.match(text, /wave 2/)
      assert.match(text, /attempt 2/)
    })

    it("renders merge stage header without issue number (ASCII)", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onStageStart({
        stage: "merge",
        issue: { number: 1, title: "issue-1", itemId: null, branch: "sandcastle/issue-1" },
        wave: { index: 0, issues: [1, 2] },
        attempt: 1,
      })
      const text = output()
      assert.match(text, /\* merge/)
      assert.match(text, /wave 1/)
      assert.ok(!text.includes("#1 merge"))
    })

    it("omits wave when wave is undefined", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onStageStart({
        stage: "implement",
        issue: { number: 7, title: "issue-7", itemId: null, branch: "sandcastle/issue-7" },
        attempt: 1,
      })
      const text = output()
      assert.ok(!text.includes("wave"))
      assert.match(text, /\* #7 implement/)
    })

    it("emits ANSI bold for stage header", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, COLOR_ASCII, makeHeader())
      sink.onStageStart({
        stage: "implement",
        issue: { number: 1, title: "issue-1", itemId: null, branch: "sandcastle/issue-1" },
        attempt: 1,
      })
      const text = output()
      assert.ok(text.includes("\x1b[1m"), "expected ANSI bold in stage header")
    })
  })

  describe("stage closer — implementer", () => {
    it("renders done with commit stats (ASCII)", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onStageEnd({
        stage: "implement",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        attempt: 1,
        durationMs: 194_000,
        outcome: { tag: "implementer", stats: { newCommits: 1, totalAhead: 3 } },
      })
      const text = output()
      assert.match(text, /\[ok\] done/)
      assert.match(text, /3m 14s/)
      assert.match(text, /1 commit/)
      assert.match(text, /3 ahead of base/)
    })

    it("renders 0s for sub-second duration", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onStageEnd({
        stage: "implement",
        issue: { number: 1, title: "issue-1", itemId: null, branch: "b" },
        attempt: 1,
        durationMs: 0,
        outcome: { tag: "implementer", stats: { newCommits: 1, totalAhead: 1 } },
      })
      const text = output()
      assert.match(text, /0s/)
    })

    it("renders padded seconds at exact minute boundary", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onStageEnd({
        stage: "implement",
        issue: { number: 1, title: "issue-1", itemId: null, branch: "b" },
        attempt: 1,
        durationMs: 60_000,
        outcome: { tag: "implementer", stats: { newCommits: 1, totalAhead: 1 } },
      })
      const text = output()
      assert.match(text, /1m 00s/)
    })

    it("renders 0 commits with plural form", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onStageEnd({
        stage: "implement",
        issue: { number: 1, title: "issue-1", itemId: null, branch: "b" },
        attempt: 1,
        durationMs: 1000,
        outcome: { tag: "implementer", stats: { newCommits: 0, totalAhead: 5 } },
      })
      const text = output()
      assert.match(text, /0 commits/)
    })

    it("pluralizes commits correctly", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onStageEnd({
        stage: "implement",
        issue: { number: 1, title: "issue-1", itemId: null, branch: "b" },
        attempt: 1,
        durationMs: 5000,
        outcome: { tag: "implementer", stats: { newCommits: 4, totalAhead: 10 } },
      })
      const text = output()
      assert.match(text, /4 commits/)
    })

    it("emits ANSI green for success", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, COLOR_ASCII, makeHeader())
      sink.onStageEnd({
        stage: "implement",
        issue: { number: 1, title: "issue-1", itemId: null, branch: "b" },
        attempt: 1,
        durationMs: 1000,
        outcome: { tag: "implementer", stats: { newCommits: 1, totalAhead: 1 } },
      })
      const text = output()
      assert.ok(text.includes("\x1b[32m"), "expected ANSI green")
    })
  })

  describe("stage closer — reviewer", () => {
    it("renders approved verdict (unicode)", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, UNICODE_NO_COLOR, makeHeader())
      sink.onStageEnd({
        stage: "review",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        attempt: 1,
        durationMs: 102_000,
        outcome: { tag: "reviewer", verdict: { tag: "approved" } },
      })
      const text = output()
      assert.match(text, /✓ approved/)
      assert.match(text, /1m 42s/)
    })

    it("renders rework verdict with reason (ASCII)", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onStageEnd({
        stage: "review",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        attempt: 1,
        durationMs: 102_000,
        outcome: {
          tag: "reviewer",
          verdict: { tag: "rework", reason: "missing tests for ensureCleanWorktree" },
        },
      })
      const text = output()
      assert.match(text, /\[rework\] rework: "missing tests for ensureCleanWorktree"/)
      assert.match(text, /1m 42s/)
    })

    it("emits ANSI yellow for rework", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, COLOR_ASCII, makeHeader())
      sink.onStageEnd({
        stage: "review",
        issue: { number: 1, title: "issue-1", itemId: null, branch: "b" },
        attempt: 1,
        durationMs: 1000,
        outcome: { tag: "reviewer", verdict: { tag: "rework", reason: "x" } },
      })
      const text = output()
      assert.ok(text.includes("\x1b[33m"), "expected ANSI yellow for rework")
    })
  })

  describe("stage closer — merger", () => {
    it("renders merged issue list (ASCII)", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onStageEnd({
        stage: "merge",
        issue: { number: 1, title: "issue-1", itemId: null, branch: "sandcastle/issue-1" },
        wave: { index: 0, issues: [1, 2, 3] },
        attempt: 1,
        durationMs: 62_000,
        outcome: { tag: "merger", issues: [1, 2, 3] },
      })
      const text = output()
      assert.match(text, /\[ok\] merged #1, #2, #3/)
      assert.match(text, /1m 02s/)
    })
  })

  describe("stage closer — no outcome, no error", () => {
    it("writes nothing when stage-end has neither outcome nor error", () => {
      const { pane, ops } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      const opsBefore = ops.length
      sink.onStageEnd({
        stage: "implement",
        issue: { number: 1, title: "issue-1", itemId: null, branch: "b" },
        attempt: 1,
        durationMs: 1000,
      })
      assert.equal(ops.length, opsBefore)
    })
  })

  describe("stage closer — error", () => {
    it("renders failure marker on stage throw (ASCII)", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onStageEnd({
        stage: "implement",
        issue: { number: 7, title: "issue-7", itemId: null, branch: "sandcastle/issue-7" },
        attempt: 1,
        durationMs: 5000,
        error: new Error("sandbox blew up"),
      })
      const text = output()
      assert.match(text, /\[error\] failed: sandbox blew up/)
    })

    it("renders failure marker with unicode glyph", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, UNICODE_NO_COLOR, makeHeader())
      sink.onStageEnd({
        stage: "review",
        issue: { number: 3, title: "issue-3", itemId: null, branch: "b" },
        attempt: 2,
        durationMs: 1000,
        error: new Error("oops"),
      })
      const text = output()
      assert.match(text, /✗ failed: oops/)
    })

    it("emits ANSI red for failure", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, COLOR_ASCII, makeHeader())
      sink.onStageEnd({
        stage: "implement",
        issue: { number: 1, title: "issue-1", itemId: null, branch: "b" },
        attempt: 1,
        durationMs: 1000,
        error: new Error("boom"),
      })
      const text = output()
      assert.ok(text.includes("\x1b[31m"), "expected ANSI red for failure")
    })
  })

  describe("issue-done milestone", () => {
    it("renders finalizeIssue as milestone line (ASCII)", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      const event: TickEvent = {
        ...fakeTickEvent("finalizeIssue", 31),
        decision: {
          tag: "act" as const,
          action: {
            tag: "finalizeIssue" as const,
            issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
          },
        },
      }
      sink.onTick(event)
      const text = output()
      assert.match(text, /\[ok\] #31 done/)
    })

    it("renders finalizePrd as milestone line (unicode)", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, UNICODE_NO_COLOR, makeHeader())
      const event: TickEvent = {
        ...fakeTickEvent("finalizePrd", 100),
        decision: {
          tag: "act" as const,
          action: {
            tag: "finalizePrd" as const,
            issue: {
              number: 100,
              title: "PRD",
              itemId: null,
              branch: "sandcastle/issue-100",
            },
          },
        },
      }
      sink.onTick(event)
      const text = output()
      assert.match(text, /✓ #100 done/)
    })
  })

  describe("bookkeeping action filtering", () => {
    it("does not render claimIssue tick", () => {
      const { pane, ops } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      const opsBefore = ops.length
      sink.onTick(fakeTickEvent("claimIssue", 1))
      assert.equal(ops.length, opsBefore)
    })

    it("does not render promoteToReview tick", () => {
      const { pane, ops } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      const opsBefore = ops.length
      sink.onTick(fakeTickEvent("promoteToReview", 1))
      assert.equal(ops.length, opsBefore)
    })

    it("does not render applyReworkVerdict tick", () => {
      const { pane, ops } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      const opsBefore = ops.length
      sink.onTick({
        ...fakeTickEvent("applyReworkVerdict", 1),
        decision: {
          tag: "act" as const,
          action: {
            tag: "applyReworkVerdict" as const,
            issue: { number: 1, title: "issue-1", itemId: null, branch: "b" },
            reason: "tests failing",
          },
        },
      })
      assert.equal(ops.length, opsBefore)
    })
  })

  describe("full scenario — clean run snapshot", () => {
    it("renders stage blocks with closers and issue milestone (ASCII)", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(
        pane,
        NO_COLOR,
        makeHeader({
          seed: { number: 31, isPrd: false },
          children: [],
        }),
      )

      sink.onStageStart({
        stage: "implement",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        wave: { index: 0, issues: [31] },
        attempt: 1,
      })
      sink.onStageEnd({
        stage: "implement",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        wave: { index: 0, issues: [31] },
        attempt: 1,
        durationMs: 194_000,
        outcome: { tag: "implementer", stats: { newCommits: 1, totalAhead: 3 } },
      })

      sink.onStageStart({
        stage: "review",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        wave: { index: 0, issues: [31] },
        attempt: 1,
      })
      sink.onStageEnd({
        stage: "review",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        wave: { index: 0, issues: [31] },
        attempt: 1,
        durationMs: 102_000,
        outcome: { tag: "reviewer", verdict: { tag: "approved" } },
      })

      sink.onStageStart({
        stage: "merge",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        wave: { index: 0, issues: [31] },
        attempt: 1,
      })
      sink.onStageEnd({
        stage: "merge",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        wave: { index: 0, issues: [31] },
        attempt: 1,
        durationMs: 62_000,
        outcome: { tag: "merger", issues: [31] },
      })

      sink.onTick({
        ...fakeTickEvent("finalizeIssue", 31),
        decision: {
          tag: "act" as const,
          action: {
            tag: "finalizeIssue" as const,
            issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
          },
        },
      })

      sink.close({ tag: "done", tickCount: 6 })

      const text = output()
      assert.match(text, /\* #31 implement/)
      assert.match(text, /\[ok\] done/)
      assert.match(text, /1 commit/)
      assert.match(text, /\* #31 review/)
      assert.match(text, /\[ok\] approved/)
      assert.match(text, /\* merge/)
      assert.match(text, /\[ok\] merged #31/)
      assert.match(text, /\[ok\] #31 done/)
      assert.match(text, /\[ok\] Run done/)
    })
  })

  describe("full scenario — rework loop snapshot", () => {
    it("renders rework then success (ASCII)", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(
        pane,
        NO_COLOR,
        makeHeader({
          seed: { number: 31, isPrd: false },
          children: [],
        }),
      )

      sink.onStageStart({
        stage: "implement",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        wave: { index: 0, issues: [31] },
        attempt: 1,
      })
      sink.onStageEnd({
        stage: "implement",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        wave: { index: 0, issues: [31] },
        attempt: 1,
        durationMs: 120_000,
        outcome: { tag: "implementer", stats: { newCommits: 2, totalAhead: 2 } },
      })

      sink.onStageStart({
        stage: "review",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        wave: { index: 0, issues: [31] },
        attempt: 1,
      })
      sink.onStageEnd({
        stage: "review",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        wave: { index: 0, issues: [31] },
        attempt: 1,
        durationMs: 60_000,
        outcome: {
          tag: "reviewer",
          verdict: { tag: "rework", reason: "missing tests" },
        },
      })

      sink.onStageStart({
        stage: "implement",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        wave: { index: 0, issues: [31] },
        attempt: 2,
      })
      sink.onStageEnd({
        stage: "implement",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        wave: { index: 0, issues: [31] },
        attempt: 2,
        durationMs: 175_000,
        outcome: { tag: "implementer", stats: { newCommits: 1, totalAhead: 4 } },
      })

      sink.onStageStart({
        stage: "review",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        wave: { index: 0, issues: [31] },
        attempt: 2,
      })
      sink.onStageEnd({
        stage: "review",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        wave: { index: 0, issues: [31] },
        attempt: 2,
        durationMs: 50_000,
        outcome: { tag: "reviewer", verdict: { tag: "approved" } },
      })

      sink.close({ tag: "done", tickCount: 10 })

      const text = output()
      assert.match(text, /\* #31 implement.*attempt 1/)
      assert.match(text, /\[rework\] rework: "missing tests"/)
      assert.match(text, /\* #31 implement.*attempt 2/)
      assert.match(text, /\[ok\] approved/)
    })
  })

  describe("agent stream — text records", () => {
    it("renders first text event with corner glyph (ASCII)", () => {
      const { pane, ops } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onStageStart({
        stage: "implement",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        attempt: 1,
      })
      const opsBefore = ops.length
      const event: AgentStreamEvent = {
        type: "text",
        message: "I'll start by fetching the issue details…",
        iteration: 1,
        timestamp: new Date(),
      }
      sink.onAgentStream(event)
      const newOps = ops.slice(opsBefore)
      const text = newOps
        .filter((o) => o.type === "appendLine")
        .map((o) => (o as { type: "appendLine"; line: string }).line)
        .join("\n")
      assert.match(text, /\| I'll start by fetching the issue details/)
    })

    it("renders first text event with unicode corner glyph", () => {
      const { pane, ops } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, UNICODE_NO_COLOR, makeHeader())
      sink.onStageStart({
        stage: "implement",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        attempt: 1,
      })
      const opsBefore = ops.length
      sink.onAgentStream({
        type: "text",
        message: "Analyzing code...",
        iteration: 1,
        timestamp: new Date(),
      })
      const newOps = ops.slice(opsBefore)
      const text = newOps
        .filter((o) => o.type === "appendLine")
        .map((o) => (o as { type: "appendLine"; line: string }).line)
        .join("\n")
      assert.ok(text.includes("⎿"), "expected unicode corner glyph")
      assert.ok(text.includes("Analyzing code..."))
    })

    it("renders subsequent text events with continuation indent", () => {
      const { pane, ops } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onStageStart({
        stage: "implement",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        attempt: 1,
      })
      sink.onAgentStream({
        type: "text",
        message: "First line",
        iteration: 1,
        timestamp: new Date(),
      })
      const opsBefore = ops.length
      sink.onAgentStream({
        type: "text",
        message: "Second line",
        iteration: 1,
        timestamp: new Date(),
      })
      const newOps = ops.slice(opsBefore)
      const text = newOps
        .filter((o) => o.type === "appendLine")
        .map((o) => (o as { type: "appendLine"; line: string }).line)
        .join("\n")
      assert.ok(!text.includes("|"), "continuation should not have corner glyph")
      assert.ok(text.includes("Second line"))
      assert.match(text, /^ {4}Second line/)
    })

    it("indents every physical line of a multi-line text event", () => {
      const { pane, ops } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onStageStart({
        stage: "implement",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        attempt: 1,
      })
      const opsBefore = ops.length
      sink.onAgentStream({
        type: "text",
        message: "Heading\n- bullet one\n- bullet two\n\nFollow-up paragraph",
        iteration: 1,
        timestamp: new Date(),
      })
      const newLines = ops
        .slice(opsBefore)
        .filter((o) => o.type === "appendLine")
        .map((o) => (o as { type: "appendLine"; line: string }).line)
      assert.equal(newLines.length, 5, "each physical line should yield one appendLine call")
      assert.match(newLines[0] as string, /^ {2}\| Heading$/)
      assert.match(newLines[1] as string, /^ {4}- bullet one$/)
      assert.match(newLines[2] as string, /^ {4}- bullet two$/)
      assert.match(newLines[3] as string, /^ {4}$/)
      assert.match(newLines[4] as string, /^ {4}Follow-up paragraph$/)
    })

    it("indents every physical line of a multi-line tool-call args block", () => {
      const { pane, ops } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onStageStart({
        stage: "implement",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        attempt: 1,
      })
      const opsBefore = ops.length
      sink.onAgentStream({
        type: "toolCall",
        name: "Bash",
        formattedArgs: "git commit -m \"$(cat <<'EOF'\nfeat: foo\nEOF\n)\"",
        iteration: 1,
        timestamp: new Date(),
      })
      const newLines = ops
        .slice(opsBefore)
        .filter((o) => o.type === "appendLine")
        .map((o) => (o as { type: "appendLine"; line: string }).line)
      assert.equal(newLines.length, 4)
      assert.match(newLines[0] as string, /^ {2}\| Bash\(git commit -m "\$\(cat <<'EOF'$/)
      assert.match(newLines[1] as string, /^ {4}feat: foo$/)
      assert.match(newLines[2] as string, /^ {4}EOF$/)
      assert.match(newLines[3] as string, /^ {4}\)"\)$/)
    })
  })

  describe("agent stream — tool-call records", () => {
    it("renders tool call as Name(args) line (ASCII)", () => {
      const { pane, ops } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())
      sink.onStageStart({
        stage: "implement",
        issue: { number: 7, title: "issue-7", itemId: null, branch: "sandcastle/issue-7" },
        attempt: 1,
      })
      sink.onAgentStream({
        type: "text",
        message: "Let me read the file",
        iteration: 1,
        timestamp: new Date(),
      })
      const opsBefore = ops.length
      sink.onAgentStream({
        type: "toolCall",
        name: "Read",
        formattedArgs: "orchestrator.ts",
        iteration: 1,
        timestamp: new Date(),
      })
      const newOps = ops.slice(opsBefore)
      const text = newOps
        .filter((o) => o.type === "appendLine")
        .map((o) => (o as { type: "appendLine"; line: string }).line)
        .join("\n")
      assert.match(text, /Read\(orchestrator\.ts\)/)
      assert.match(text, /^ {4}Read\(orchestrator\.ts\)/)
    })

    it("renders tool call with corner glyph when it is the first event", () => {
      const { pane, ops } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, UNICODE_NO_COLOR, makeHeader())
      sink.onStageStart({
        stage: "review",
        issue: { number: 5, title: "issue-5", itemId: null, branch: "sandcastle/issue-5" },
        attempt: 1,
      })
      const opsBefore = ops.length
      sink.onAgentStream({
        type: "toolCall",
        name: "Bash",
        formattedArgs: "gh issue view 5",
        iteration: 1,
        timestamp: new Date(),
      })
      const newOps = ops.slice(opsBefore)
      const text = newOps
        .filter((o) => o.type === "appendLine")
        .map((o) => (o as { type: "appendLine"; line: string }).line)
        .join("\n")
      assert.ok(text.includes("⎿"), "first tool call should have corner glyph")
      assert.ok(text.includes("Bash(gh issue view 5)"))
    })
  })

  describe("agent stream — stage boundary reset", () => {
    it("resets corner glyph on new stage start", () => {
      const { pane, ops } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, NO_COLOR, makeHeader())

      sink.onStageStart({
        stage: "implement",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        attempt: 1,
      })
      sink.onAgentStream({
        type: "text",
        message: "Working on implement",
        iteration: 1,
        timestamp: new Date(),
      })
      sink.onStageEnd({
        stage: "implement",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        attempt: 1,
        durationMs: 60_000,
        outcome: { tag: "implementer", stats: { newCommits: 1, totalAhead: 1 } },
      })

      sink.onStageStart({
        stage: "review",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        attempt: 1,
      })
      const opsBefore = ops.length
      sink.onAgentStream({
        type: "text",
        message: "Reviewing code",
        iteration: 1,
        timestamp: new Date(),
      })
      const newOps = ops.slice(opsBefore)
      const text = newOps
        .filter((o) => o.type === "appendLine")
        .map((o) => (o as { type: "appendLine"; line: string }).line)
        .join("\n")
      assert.match(text, /\| Reviewing code/)
    })
  })

  describe("agent stream — snapshot with text and tool calls", () => {
    it("renders indented stage block with mixed text and tool calls (ASCII)", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(
        pane,
        NO_COLOR,
        makeHeader({ seed: { number: 31, isPrd: false }, children: [] }),
      )

      sink.onStageStart({
        stage: "implement",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        wave: { index: 0, issues: [31] },
        attempt: 1,
      })

      sink.onAgentStream({
        type: "text",
        message: "I'll start by fetching the issue details",
        iteration: 1,
        timestamp: new Date(),
      })
      sink.onAgentStream({
        type: "toolCall",
        name: "Bash",
        formattedArgs: "gh issue view 31",
        iteration: 1,
        timestamp: new Date(),
      })
      sink.onAgentStream({
        type: "toolCall",
        name: "Read",
        formattedArgs: "orchestrator.ts",
        iteration: 1,
        timestamp: new Date(),
      })
      sink.onAgentStream({
        type: "toolCall",
        name: "Edit",
        formattedArgs: "stages.ts",
        iteration: 1,
        timestamp: new Date(),
      })

      sink.onStageEnd({
        stage: "implement",
        issue: { number: 31, title: "issue-31", itemId: null, branch: "sandcastle/issue-31" },
        wave: { index: 0, issues: [31] },
        attempt: 1,
        durationMs: 194_000,
        outcome: { tag: "implementer", stats: { newCommits: 1, totalAhead: 3 } },
      })

      sink.close({ tag: "done", tickCount: 4 })

      const text = output()
      assert.match(text, /\* #31 implement/)
      assert.match(text, /\| I'll start by fetching/)
      assert.match(text, / {4}Bash\(gh issue view 31\)/)
      assert.match(text, / {4}Read\(orchestrator\.ts\)/)
      assert.match(text, / {4}Edit\(stages\.ts\)/)
      assert.match(text, /\[ok\] done/)
      assert.match(text, /1 commit/)

      const lines = text.split("\n")
      const cornerIdx = lines.findIndex((l) => l.includes("| I'll start"))
      const bashIdx = lines.findIndex((l) => l.includes("Bash(gh issue view 31)"))
      const readIdx = lines.findIndex((l) => l.includes("Read(orchestrator.ts)"))
      const editIdx = lines.findIndex((l) => l.includes("Edit(stages.ts)"))
      assert.ok(cornerIdx < bashIdx, "text before Bash")
      assert.ok(bashIdx < readIdx, "Bash before Read")
      assert.ok(readIdx < editIdx, "Read before Edit")
    })
  })

  describe("agent stream — ANSI color", () => {
    it("emits ANSI dim for agent stream events when color enabled", () => {
      const { pane, output } = fakePaneHandle()
      const sink = openPrettyStdoutSink(pane, COLOR_ASCII, makeHeader())
      sink.onStageStart({
        stage: "implement",
        issue: { number: 1, title: "issue-1", itemId: null, branch: "b" },
        attempt: 1,
      })
      sink.onAgentStream({
        type: "text",
        message: "Working...",
        iteration: 1,
        timestamp: new Date(),
      })
      const text = output()
      assert.ok(text.includes("\x1b[2m"), "expected ANSI dim for agent stream")
    })
  })
})
