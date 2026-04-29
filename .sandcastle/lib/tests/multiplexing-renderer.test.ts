import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import { createMultiplexingRenderer } from "../multiplexing-renderer.ts"
import type { OutputCapabilities } from "../palette.ts"

function capture(): { out: { write(s: string): void }; bytes: () => string } {
  const chunks: string[] = []
  return {
    out: { write: (s: string) => chunks.push(s) },
    bytes: () => chunks.join(""),
  }
}

const STREAM: OutputCapabilities = { color: false, unicode: false, liveRedraw: false }
const STREAM_UNICODE: OutputCapabilities = { color: false, unicode: true, liveRedraw: false }
const STREAM_COLOR_ASCII: OutputCapabilities = { color: true, unicode: false, liveRedraw: false }
const STREAM_COLOR: OutputCapabilities = { color: true, unicode: true, liveRedraw: false }
const TTY: OutputCapabilities = { color: true, unicode: true, liveRedraw: true }
const TTY_ASCII: OutputCapabilities = { color: true, unicode: false, liveRedraw: true }

const HIDE = "\x1b[?25l"
const SHOW = "\x1b[?25h"
const EL = "\x1b[2K"
const ED = "\x1b[J"
const COL1 = "\x1b[G"
const RST = "\x1b[0m"
const CYAN = "\x1b[36m"
const MAGENTA = "\x1b[35m"
const YELLOW = "\x1b[33m"

function up(n: number): string {
  return `\x1b[${n}A`
}

function title(text: string, color: string, border = "─"): string {
  return `${color}${border}${border}${border} ${text} ${border}${border}${border}${RST}`
}

function frame(liveLines: number, contentLines: string[]): string {
  const parts = [HIDE]
  if (liveLines > 0) {
    parts.push(up(liveLines), COL1)
  }
  for (const line of contentLines) {
    parts.push(`${EL}${line}\n`)
  }
  parts.push(ED, SHOW)
  return parts.join("")
}

function closeFrame(liveLines: number, summaryLine: string, remainingLines: string[]): string {
  const parts = [HIDE]
  if (liveLines > 0) {
    parts.push(up(liveLines), COL1)
  }
  parts.push(`${EL}${summaryLine}\n`)
  for (const line of remainingLines) {
    parts.push(`${EL}${line}\n`)
  }
  parts.push(ED, SHOW)
  return parts.join("")
}

describe("MultiplexingRenderer", () => {
  describe("stream backend — single-pane passthrough", () => {
    it("passes appendLine bytes through with trailing newline (color+unicode)", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM_COLOR)
      const pane = renderer.openPane("test", "test")
      pane.appendLine("hello world")
      assert.equal(bytes(), "hello world\n")
    })

    it("passes appendLine bytes through with trailing newline (no-color)", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM)
      const pane = renderer.openPane("test", "test")
      pane.appendLine("hello world")
      assert.equal(bytes(), "hello world\n")
    })

    it("passes appendLine bytes through with trailing newline (no-color unicode)", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM_UNICODE)
      const pane = renderer.openPane("test", "test")
      pane.appendLine("hello world")
      assert.equal(bytes(), "hello world\n")
    })

    it("preserves ANSI escape sequences in passthrough (color)", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM_COLOR)
      const pane = renderer.openPane("test", "test")
      pane.appendLine("\x1b[1mbold text\x1b[0m")
      assert.equal(bytes(), "\x1b[1mbold text\x1b[0m\n")
    })

    it("preserves plain text in passthrough (no-color)", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM)
      const pane = renderer.openPane("test", "test")
      pane.appendLine("plain text")
      assert.equal(bytes(), "plain text\n")
    })

    it("preserves unicode in passthrough (no-color unicode)", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM_UNICODE)
      const pane = renderer.openPane("test", "test")
      pane.appendLine("● stage · bullet ✓ done")
      assert.equal(bytes(), "● stage · bullet ✓ done\n")
    })

    it("accumulates multiple lines in order (color)", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM_COLOR)
      const pane = renderer.openPane("test", "test")
      pane.appendLine("line 1")
      pane.appendLine("line 2")
      pane.appendLine("line 3")
      assert.equal(bytes(), "line 1\nline 2\nline 3\n")
    })

    it("accumulates multiple lines in order (no-color)", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM)
      const pane = renderer.openPane("test", "test")
      pane.appendLine("line 1")
      pane.appendLine("line 2")
      pane.appendLine("line 3")
      assert.equal(bytes(), "line 1\nline 2\nline 3\n")
    })

    it("writes empty line for appendLine with empty string", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM_COLOR)
      const pane = renderer.openPane("test", "test")
      pane.appendLine("")
      assert.equal(bytes(), "\n")
    })
  })

  describe("stream backend — setTitle", () => {
    it("is a no-op for the stream backend", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM_COLOR)
      const pane = renderer.openPane("test", "initial title")
      pane.setTitle("new title")
      assert.equal(bytes(), "")
    })
  })

  describe("stream backend — close", () => {
    it("stops writing after close (color)", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM_COLOR)
      const pane = renderer.openPane("test", "test")
      pane.appendLine("before")
      pane.close("done")
      pane.appendLine("after")
      assert.equal(bytes(), "before\n")
    })

    it("stops writing after close (no-color)", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM)
      const pane = renderer.openPane("test", "test")
      pane.appendLine("before")
      pane.close("done")
      pane.appendLine("after")
      assert.equal(bytes(), "before\n")
    })

    it("allows opening a new pane after close", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM_COLOR)
      const pane1 = renderer.openPane("first", "first")
      pane1.appendLine("from first")
      pane1.close("done")
      const pane2 = renderer.openPane("second", "second")
      pane2.appendLine("from second")
      assert.equal(bytes(), "from first\nfrom second\n")
    })

    it("double-close is harmless and still allows a new pane", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM_COLOR)
      const pane = renderer.openPane("test", "test")
      pane.appendLine("before")
      pane.close("first close")
      pane.close("second close")
      const pane2 = renderer.openPane("next", "next")
      pane2.appendLine("after")
      assert.equal(bytes(), "before\nafter\n")
    })

    it("close on a fresh pane with no writes does not throw", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM_COLOR)
      const pane = renderer.openPane("test", "test")
      pane.close("immediate")
      assert.equal(bytes(), "")
    })

    it("setTitle on a closed pane does not throw", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM_COLOR)
      const pane = renderer.openPane("test", "test")
      pane.appendLine("data")
      pane.close("done")
      pane.setTitle("after close")
      assert.equal(bytes(), "data\n")
    })
  })

  describe("stream backend — byte-identical passthrough snapshot", () => {
    it("produces byte-identical output to a direct stream.write (color+unicode)", () => {
      const { out: directOut, bytes: directBytes } = capture()
      const { out: rendererOut, bytes: rendererBytes } = capture()

      const lines = [
        "\x1b[1mRun 01JTEST\x1b[0m · seed #42 (PRD) · 1 child issue(s): #10",
        "\x1b[2mLogs: /tmp/logs\x1b[0m",
        "",
        "\x1b[1m● #31 implement · wave 1 · attempt 1\x1b[0m",
        "\x1b[2m  ⎿ Starting implementation\x1b[0m",
        "  \x1b[32m✓ done\x1b[0m · 3m 14s · 1 commit · 3 ahead of base",
        "",
        "\x1b[32m✓ Run done\x1b[0m · 6 ticks · 5m 00s",
      ]

      for (const line of lines) {
        directOut.write(`${line}\n`)
      }

      const renderer = createMultiplexingRenderer(rendererOut, STREAM_COLOR)
      const pane = renderer.openPane("test", "test")
      for (const line of lines) {
        pane.appendLine(line)
      }

      assert.equal(rendererBytes(), directBytes())
    })

    it("produces byte-identical output to a direct stream.write (no-color)", () => {
      const { out: directOut, bytes: directBytes } = capture()
      const { out: rendererOut, bytes: rendererBytes } = capture()

      const lines = [
        "Run 01JTEST - seed #42 (PRD) - 1 child issue(s): #10",
        "Logs: /tmp/logs",
        "",
        "* #31 implement - wave 1 - attempt 1",
        "  | Starting implementation",
        "  [ok] done - 3m 14s - 1 commit - 3 ahead of base",
        "",
        "[ok] Run done - 6 ticks - 5m 00s",
      ]

      for (const line of lines) {
        directOut.write(`${line}\n`)
      }

      const renderer = createMultiplexingRenderer(rendererOut, STREAM)
      const pane = renderer.openPane("test", "test")
      for (const line of lines) {
        pane.appendLine(line)
      }

      assert.equal(rendererBytes(), directBytes())
    })

    it("produces byte-identical output to a direct stream.write (color+ASCII)", () => {
      const { out: directOut, bytes: directBytes } = capture()
      const { out: rendererOut, bytes: rendererBytes } = capture()

      const lines = [
        "\x1b[1mRun 01JTEST\x1b[0m - seed #42 (PRD) - 1 child issue(s): #10",
        "\x1b[2mLogs: /tmp/logs\x1b[0m",
        "",
        "\x1b[1m* #31 implement - wave 1 - attempt 1\x1b[0m",
        "\x1b[2m  | Starting implementation\x1b[0m",
        "  \x1b[32m[ok] done\x1b[0m - 3m 14s - 1 commit - 3 ahead of base",
        "",
        "\x1b[32m[ok] Run done\x1b[0m - 6 ticks - 5m 00s",
      ]

      for (const line of lines) {
        directOut.write(`${line}\n`)
      }

      const renderer = createMultiplexingRenderer(rendererOut, STREAM_COLOR_ASCII)
      const pane = renderer.openPane("test", "test")
      for (const line of lines) {
        pane.appendLine(line)
      }

      assert.equal(rendererBytes(), directBytes())
    })
  })

  describe("multi-pane stream prefixing", () => {
    it("prefixes lines with [streamKey] when two panes are open (color)", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM_COLOR)
      const paneA = renderer.openPane("run-a", "Run A")
      const paneB = renderer.openPane("run-b", "Run B")
      paneA.appendLine("hello from A")
      paneB.appendLine("hello from B")
      assert.equal(
        bytes(),
        "\x1b[36m[run-a]\x1b[0m hello from A\n" + "\x1b[33m[run-b]\x1b[0m hello from B\n",
      )
    })

    it("prefixes lines with [streamKey] when two panes are open (no-color)", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM)
      const paneA = renderer.openPane("run-a", "Run A")
      const paneB = renderer.openPane("run-b", "Run B")
      paneA.appendLine("hello from A")
      paneB.appendLine("hello from B")
      assert.equal(bytes(), "[run-a] hello from A\n[run-b] hello from B\n")
    })

    it("two panes alternating writes interleave correctly", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM)
      const paneA = renderer.openPane("a", "A")
      const paneB = renderer.openPane("b", "B")
      paneA.appendLine("a1")
      paneB.appendLine("b1")
      paneA.appendLine("a2")
      paneB.appendLine("b2")
      assert.equal(bytes(), "[a] a1\n[b] b1\n[a] a2\n[b] b2\n")
    })

    it("prefixes disappear when one pane closes and a single pane remains", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM)
      const paneA = renderer.openPane("a", "A")
      const paneB = renderer.openPane("b", "B")
      paneA.appendLine("prefixed")
      paneB.appendLine("prefixed")
      paneA.close("done")
      paneB.appendLine("no prefix now")
      assert.equal(bytes(), "[a] prefixed\n[b] prefixed\n" + "no prefix now\n")
    })

    it("prefixes reappear when a third pane opens after one closed", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM)
      const paneA = renderer.openPane("a", "A")
      const paneB = renderer.openPane("b", "B")
      paneA.appendLine("a-multi")
      paneA.close("done")
      paneB.appendLine("b-single")
      const paneC = renderer.openPane("c", "C")
      paneB.appendLine("b-multi")
      paneC.appendLine("c-multi")
      assert.equal(bytes(), "[a] a-multi\n" + "b-single\n" + "[b] b-multi\n[c] c-multi\n")
    })

    it("deterministic color reassignment when a streamKey is reopened", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM_COLOR)
      const paneA1 = renderer.openPane("run-a", "Run A")
      renderer.openPane("run-b", "Run B")
      paneA1.appendLine("first")
      paneA1.close("done")
      const paneA2 = renderer.openPane("run-a", "Run A again")
      paneA2.appendLine("second")
      const output = bytes()
      const lines = output.split("\n").filter((l) => l.length > 0)
      assert.equal(lines.length, 2)
      assert.ok(lines[0]?.startsWith("\x1b[36m[run-a]\x1b[0m"), `first line: ${lines[0]}`)
      assert.ok(lines[1]?.startsWith("\x1b[36m[run-a]\x1b[0m"), `second line: ${lines[1]}`)
    })

    it("no-color produces uncolored prefixes", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM)
      const paneA = renderer.openPane("alpha", "A")
      const paneB = renderer.openPane("beta", "B")
      paneA.appendLine("test")
      paneB.appendLine("test")
      const output = bytes()
      assert.ok(!output.includes("\x1b["), "should not contain ANSI escape sequences")
      assert.equal(output, "[alpha] test\n[beta] test\n")
    })

    it("single pane stays passthrough even when previous panes were concurrent", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM_COLOR)
      const p1 = renderer.openPane("x", "X")
      const p2 = renderer.openPane("y", "Y")
      p1.close("done")
      p2.close("done")
      const p3 = renderer.openPane("z", "Z")
      p3.appendLine("solo line")
      assert.equal(bytes(), "solo line\n")
    })

    it("three concurrent panes all get prefixes (no-color)", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM)
      const pA = renderer.openPane("a", "A")
      const pB = renderer.openPane("b", "B")
      const pC = renderer.openPane("c", "C")
      pA.appendLine("from a")
      pB.appendLine("from b")
      pC.appendLine("from c")
      assert.equal(bytes(), "[a] from a\n[b] from b\n[c] from c\n")
    })

    it("three concurrent panes get distinct colors (color)", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM_COLOR)
      const pA = renderer.openPane("a", "A")
      const pB = renderer.openPane("b", "B")
      const pC = renderer.openPane("c", "C")
      pA.appendLine("x")
      pB.appendLine("x")
      pC.appendLine("x")
      const output = bytes()
      assert.ok(output.includes("\x1b[36m[a]\x1b[0m"), "a gets cyan")
      assert.ok(output.includes("\x1b[33m[b]\x1b[0m"), "b gets yellow")
      assert.ok(output.includes("\x1b[35m[c]\x1b[0m"), "c gets magenta")
    })

    it("empty-line appendLine gets prefix in multi-pane mode", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM)
      const pA = renderer.openPane("a", "A")
      renderer.openPane("b", "B")
      pA.appendLine("")
      assert.equal(bytes(), "[a] \n")
    })

    it("appendLine after close is silent even in multi-pane mode", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM)
      const pA = renderer.openPane("a", "A")
      const pB = renderer.openPane("b", "B")
      pA.appendLine("visible")
      pA.close("done")
      pA.appendLine("invisible")
      pB.appendLine("still visible")
      assert.equal(bytes(), "[a] visible\nstill visible\n")
    })
  })

  describe("TTY backend — single pane single line", () => {
    it("renders title on open and redraws with content on appendLine", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, TTY)
      const pane = renderer.openPane("a", "Test")
      pane.appendLine("hello")

      const expected = frame(0, [title("Test", CYAN)]) + frame(1, [title("Test", CYAN), "  hello"])

      assert.equal(bytes(), expected)
    })
  })

  describe("TTY backend — two panes alternating writes", () => {
    it("redraws both panes on each write", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, TTY)
      const p1 = renderer.openPane("a", "Pane A")
      const p2 = renderer.openPane("b", "Pane B")
      p1.appendLine("from A")
      p2.appendLine("from B")

      const tA = title("Pane A", CYAN)
      const tB = title("Pane B", MAGENTA)

      const expected =
        frame(0, [tA]) +
        frame(1, [tA, tB]) +
        frame(2, [tA, "  from A", tB]) +
        frame(3, [tA, "  from A", tB, "  from B"])

      assert.equal(bytes(), expected)
    })
  })

  describe("TTY backend — one pane closing while the other continues", () => {
    it("collapses closed pane to summary and keeps the other live", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, TTY)
      const p1 = renderer.openPane("a", "Pane A")
      const p2 = renderer.openPane("b", "Pane B")
      p1.appendLine("a-line")
      p2.appendLine("b-line")

      const tA = title("Pane A", CYAN)
      const tB = title("Pane B", MAGENTA)

      const beforeClose =
        frame(0, [tA]) +
        frame(1, [tA, tB]) +
        frame(2, [tA, "  a-line", tB]) +
        frame(3, [tA, "  a-line", tB, "  b-line"])

      p1.close("A done")
      p2.appendLine("more B")

      const afterClose =
        closeFrame(4, `${CYAN}✓ A done${RST}`, [tB, "  b-line"]) +
        frame(2, [tB, "  b-line", "  more B"])

      assert.equal(bytes(), beforeClose + afterClose)
    })
  })

  describe("TTY backend — deterministic color reassignment", () => {
    it("reuses the same color when a streamKey is reopened", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, TTY)

      const p1 = renderer.openPane("key-x", "First")
      p1.close("done first")

      const p2 = renderer.openPane("key-x", "Second")
      p2.appendLine("content")

      const tFirst = title("First", CYAN)
      const tSecond = title("Second", CYAN)

      const expected =
        frame(0, [tFirst]) +
        closeFrame(1, `${CYAN}✓ done first${RST}`, []) +
        frame(0, [tSecond]) +
        frame(1, [tSecond, "  content"])

      assert.equal(bytes(), expected)
    })

    it("assigns different colors to different streamKeys", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, TTY)

      const p1 = renderer.openPane("a", "A")
      const p2 = renderer.openPane("b", "B")
      p1.close("done A")
      p2.close("done B")

      const tA = title("A", CYAN)
      const tB = title("B", MAGENTA)

      const expected =
        frame(0, [tA]) +
        frame(1, [tA, tB]) +
        closeFrame(2, `${CYAN}✓ done A${RST}`, [tB]) +
        closeFrame(1, `${MAGENTA}✓ done B${RST}`, [])

      assert.equal(bytes(), expected)
    })
  })

  describe("TTY backend — edge cases", () => {
    it("setTitle rewrites the title in place", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, TTY)
      const pane = renderer.openPane("a", "Old")
      pane.setTitle("New")

      const expected = frame(0, [title("Old", CYAN)]) + frame(1, [title("New", CYAN)])

      assert.equal(bytes(), expected)
    })

    it("double-close is harmless", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, TTY)
      const pane = renderer.openPane("a", "Test")
      pane.close("bye")
      pane.close("bye again")
      pane.appendLine("ignored")
      pane.setTitle("ignored")

      const expected = frame(0, [title("Test", CYAN)]) + closeFrame(1, `${CYAN}✓ bye${RST}`, [])

      assert.equal(bytes(), expected)
    })

    it("close on a fresh pane with no content lines", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, TTY)
      const pane = renderer.openPane("a", "Fresh")
      pane.close("immediate")

      const expected =
        frame(0, [title("Fresh", CYAN)]) + closeFrame(1, `${CYAN}✓ immediate${RST}`, [])

      assert.equal(bytes(), expected)
    })

    it("sliding window drops lines beyond the window size", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, TTY)
      const pane = renderer.openPane("a", "W")
      for (let i = 1; i <= 7; i++) {
        pane.appendLine(`line ${i}`)
      }

      const t = title("W", CYAN)
      const chunks: string[] = []
      chunks.push(frame(0, [t]))
      for (let i = 1; i <= 7; i++) {
        const start = Math.max(1, i - 4)
        const windowLines: string[] = []
        for (let j = start; j <= i; j++) {
          windowLines.push(`  line ${j}`)
        }
        chunks.push(frame(1 + Math.min(i - 1, 5), [t, ...windowLines]))
      }

      assert.equal(bytes(), chunks.join(""))
    })
  })

  describe("TTY backend — ASCII borders and fold marker", () => {
    it("uses dash borders and asterisk fold marker when unicode is false", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, TTY_ASCII)
      const pane = renderer.openPane("a", "Run X")
      pane.appendLine("working")
      pane.close("done")

      const t = title("Run X", CYAN, "-")
      const expected =
        frame(0, [t]) + frame(1, [t, "  working"]) + closeFrame(2, `${CYAN}* done${RST}`, [])

      assert.equal(bytes(), expected)
    })
  })

  describe("TTY backend — color wraparound", () => {
    it("wraps back to the first color after exhausting the palette", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, TTY)

      for (let i = 0; i < 6; i++) {
        const p = renderer.openPane(`key-${i}`, `P${i}`)
        p.close(`done-${i}`)
      }

      const p7 = renderer.openPane("key-6", "P6")
      p7.appendLine("content")

      const output = bytes()
      const t7 = title("P6", CYAN)
      assert.ok(output.includes(t7), "7th pane should reuse the first color (cyan)")
    })

    it("cycles through all six colors in order", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, TTY)

      const p1 = renderer.openPane("a", "A")
      const p2 = renderer.openPane("b", "B")
      const p3 = renderer.openPane("c", "C")
      p1.close("done")
      p2.close("done")
      p3.close("done")

      const output = bytes()
      assert.ok(output.includes(title("A", CYAN)))
      assert.ok(output.includes(title("B", MAGENTA)))
      assert.ok(output.includes(title("C", YELLOW)))
    })
  })

  describe("TTY backend — writes to closed pane with active sibling", () => {
    it("does not trigger redraws when writing to a closed pane", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, TTY)
      const p1 = renderer.openPane("a", "A")
      renderer.openPane("b", "B")
      p1.close("done A")

      const snapshotAfterClose = bytes()
      p1.appendLine("ignored")
      p1.setTitle("ignored")
      assert.equal(bytes(), snapshotAfterClose)
    })
  })

  describe("TTY backend — autoselect", () => {
    it("uses stream backend when liveRedraw is false", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM_COLOR)
      const pane = renderer.openPane("k", "test")
      pane.appendLine("hello")
      assert.equal(bytes(), "hello\n")
    })

    it("uses TTY backend when liveRedraw and color are true", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, TTY)
      const pane = renderer.openPane("k", "test")
      pane.appendLine("hello")
      assert.ok(bytes().includes(HIDE))
      assert.ok(bytes().includes(SHOW))
    })
  })

  describe("TTY backend — sticky lines", () => {
    it("keeps sticky lines visible above the rolling content window", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, TTY)
      const pane = renderer.openPane("a", "T")
      pane.appendSticky("● stage A")
      // Write more rolling lines than the window holds (5).
      for (let i = 1; i <= 7; i++) {
        pane.appendLine(`line ${i}`)
      }

      // After all writes, the latest frame must still contain the sticky line
      // and only the last 5 rolling lines (line 3..7).
      const t = title("T", CYAN)
      const lastFrame = frame(7, [
        t,
        "  ● stage A",
        "  line 3",
        "  line 4",
        "  line 5",
        "  line 6",
        "  line 7",
      ])
      assert.ok(
        bytes().endsWith(lastFrame),
        `final frame mismatch: ${JSON.stringify(bytes().slice(-200))}`,
      )
    })

    it("renders multiple sticky lines in append order, all preserved across rolling churn", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, TTY)
      const pane = renderer.openPane("a", "T")
      pane.appendSticky("● stage A")
      pane.appendLine("a-line")
      pane.appendSticky("● stage B")
      for (let i = 1; i <= 6; i++) {
        pane.appendLine(`b ${i}`)
      }

      const t = title("T", CYAN)
      const lastFrame = frame(8, [
        t,
        "  ● stage A",
        "  ● stage B",
        "  b 2",
        "  b 3",
        "  b 4",
        "  b 5",
        "  b 6",
      ])
      assert.ok(
        bytes().endsWith(lastFrame),
        `final frame mismatch: ${JSON.stringify(bytes().slice(-300))}`,
      )
    })

    it("stream backend writes sticky lines just like appendLine (single pane)", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM)
      const pane = renderer.openPane("k", "T")
      pane.appendSticky("● stage")
      pane.appendLine("line")
      assert.equal(bytes(), "● stage\nline\n")
    })

    it("stream backend prefixes sticky lines in multi-pane mode", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM)
      const a = renderer.openPane("a", "A")
      renderer.openPane("b", "B")
      a.appendSticky("● stage")
      assert.ok(bytes().endsWith("[a] ● stage\n"), `got: ${JSON.stringify(bytes())}`)
    })
  })

  describe("TTY backend — wrapped-line cursor accounting", () => {
    it("counts physical rows by terminal width when computing cursorUp", () => {
      const { out, bytes } = capture()
      const cols = 20
      const renderer = createMultiplexingRenderer(out, TTY, () => cols)
      const pane = renderer.openPane("a", "T")
      // Visible width 30 chars → wraps onto 2 physical rows when cols=20.
      const long = "x".repeat(30)
      pane.appendLine(long)

      // First frame draws only the title (1 row). Second frame must move up
      // by (1 title row) + (2 wrapped content rows) = 3 — not 2.
      const t = title("T", CYAN)
      const firstFrame = frame(0, [t])
      const secondFrame = `${HIDE}${up(1)}${COL1}${EL}${t}\n${EL}  ${long}\n${ED}${SHOW}`
      const expected = `${firstFrame}${secondFrame}`

      assert.equal(bytes(), expected)

      // Now drive a third write and verify that the next cursorUp lifts past
      // the 2 wrapped content rows from the previous frame.
      pane.appendLine("y")
      const tail = bytes().slice(expected.length)
      assert.ok(
        tail.startsWith(`${HIDE}${up(3)}${COL1}`),
        `tail did not start with up(3): ${JSON.stringify(tail)}`,
      )
    })

    it("falls back to logical line count when no columns provider is given", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, TTY)
      const pane = renderer.openPane("a", "T")
      const long = "x".repeat(200)
      pane.appendLine(long)
      pane.appendLine("y")

      // Without columns info the renderer must keep the legacy behavior:
      // logical line counts (1 title + 1 content = 2) for cursorUp.
      const allBytes = bytes()
      assert.ok(allBytes.includes(`${HIDE}${up(2)}${COL1}`))
    })
  })

  describe("multi-line appendLine defensive split", () => {
    it("stream backend writes one terminal line per embedded \\n (single pane)", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM)
      const pane = renderer.openPane("k", "test")
      pane.appendLine("first\nsecond\nthird")
      assert.equal(bytes(), "first\nsecond\nthird\n")
    })

    it("stream backend repeats the [streamKey] prefix on every physical line (multi pane)", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, STREAM)
      const a = renderer.openPane("a", "a")
      renderer.openPane("b", "b")
      a.appendLine("first\nsecond")
      assert.ok(
        bytes().endsWith("[a] first\n[a] second\n"),
        `expected per-line [a] prefix, got: ${JSON.stringify(bytes())}`,
      )
    })

    it("TTY backend pushes one window entry per physical line", () => {
      const { out, bytes } = capture()
      const renderer = createMultiplexingRenderer(out, TTY)
      const pane = renderer.openPane("k", "test")
      pane.appendLine("alpha\nbeta\ngamma")
      const final = bytes()
      // Each physical line should appear on its own redrawn row, indented by the TTY pane gutter.
      assert.ok(final.includes("  alpha\n"))
      assert.ok(final.includes("  beta\n"))
      assert.ok(final.includes("  gamma\n"))
    })
  })
})
