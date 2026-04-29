import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import {
  type OutputCapabilities,
  createStreamColorCycle,
  resolveOutputCapabilities,
} from "../palette.ts"

describe("resolveOutputCapabilities", () => {
  const cases: {
    isTTY: boolean
    noColor: string | undefined
    override: string | undefined
    expected: OutputCapabilities
  }[] = [
    // auto (default) — TTY drives both
    {
      isTTY: true,
      noColor: undefined,
      override: undefined,
      expected: { color: true, unicode: true, liveRedraw: true },
    },
    {
      isTTY: false,
      noColor: undefined,
      override: undefined,
      expected: { color: false, unicode: false, liveRedraw: false },
    },
    {
      isTTY: true,
      noColor: undefined,
      override: "auto",
      expected: { color: true, unicode: true, liveRedraw: true },
    },
    {
      isTTY: false,
      noColor: undefined,
      override: "auto",
      expected: { color: false, unicode: false, liveRedraw: false },
    },

    // NO_COLOR set — suppresses color and liveRedraw but unicode follows TTY
    {
      isTTY: true,
      noColor: "1",
      override: undefined,
      expected: { color: false, unicode: true, liveRedraw: false },
    },
    {
      isTTY: true,
      noColor: "1",
      override: "auto",
      expected: { color: false, unicode: true, liveRedraw: false },
    },
    {
      isTTY: false,
      noColor: "1",
      override: undefined,
      expected: { color: false, unicode: false, liveRedraw: false },
    },
    {
      isTTY: false,
      noColor: "1",
      override: "auto",
      expected: { color: false, unicode: false, liveRedraw: false },
    },

    // NO_COLOR empty string — treated as unset
    {
      isTTY: true,
      noColor: "",
      override: undefined,
      expected: { color: true, unicode: true, liveRedraw: true },
    },
    {
      isTTY: false,
      noColor: "",
      override: undefined,
      expected: { color: false, unicode: false, liveRedraw: false },
    },

    // always — forces color+unicode on; liveRedraw still needs a real TTY
    {
      isTTY: false,
      noColor: "1",
      override: "always",
      expected: { color: true, unicode: true, liveRedraw: false },
    },
    {
      isTTY: false,
      noColor: undefined,
      override: "always",
      expected: { color: true, unicode: true, liveRedraw: false },
    },
    {
      isTTY: true,
      noColor: "1",
      override: "always",
      expected: { color: true, unicode: true, liveRedraw: true },
    },
    {
      isTTY: true,
      noColor: undefined,
      override: "always",
      expected: { color: true, unicode: true, liveRedraw: true },
    },

    // never — forces everything off regardless of TTY
    {
      isTTY: true,
      noColor: undefined,
      override: "never",
      expected: { color: false, unicode: false, liveRedraw: false },
    },
    {
      isTTY: true,
      noColor: "1",
      override: "never",
      expected: { color: false, unicode: false, liveRedraw: false },
    },
    {
      isTTY: false,
      noColor: undefined,
      override: "never",
      expected: { color: false, unicode: false, liveRedraw: false },
    },
    {
      isTTY: false,
      noColor: "1",
      override: "never",
      expected: { color: false, unicode: false, liveRedraw: false },
    },

    // invalid override treated as auto
    {
      isTTY: true,
      noColor: undefined,
      override: "bogus",
      expected: { color: true, unicode: true, liveRedraw: true },
    },
    {
      isTTY: false,
      noColor: undefined,
      override: "bogus",
      expected: { color: false, unicode: false, liveRedraw: false },
    },
  ]

  for (const { isTTY, noColor, override, expected } of cases) {
    const label = `TTY=${isTTY}, NO_COLOR=${noColor ?? "unset"}, override=${override ?? "unset"} → color=${expected.color}, unicode=${expected.unicode}, liveRedraw=${expected.liveRedraw}`
    it(label, () => {
      const result = resolveOutputCapabilities(isTTY, noColor, override)
      assert.deepStrictEqual(result, expected)
    })
  }
})

describe("createStreamColorCycle", () => {
  it("assigns distinct colors to distinct keys", () => {
    const cycle = createStreamColorCycle()
    const a = cycle.colorFor("run-a")
    const b = cycle.colorFor("run-b")
    assert.notEqual(a, b)
  })

  it("returns the same color for the same key on repeated calls", () => {
    const cycle = createStreamColorCycle()
    const first = cycle.colorFor("run-x")
    const second = cycle.colorFor("run-x")
    assert.equal(first, second)
  })

  it("cycle order is stable and deterministic", () => {
    const cycle1 = createStreamColorCycle()
    const cycle2 = createStreamColorCycle()
    const keys = ["a", "b", "c", "d", "e", "f"]
    const colors1 = keys.map((k) => cycle1.colorFor(k))
    const colors2 = keys.map((k) => cycle2.colorFor(k))
    assert.deepStrictEqual(colors1, colors2)
  })

  it("wraps around when more keys than colors", () => {
    const cycle = createStreamColorCycle()
    // allocate many keys to force wraparound
    const colors: string[] = []
    for (let i = 0; i < 20; i++) {
      colors.push(cycle.colorFor(`key-${i}`))
    }
    // slot 0 and slot 6 must share a color (6 colors in the palette)
    assert.equal(colors[0], colors[6])
    assert.equal(colors[1], colors[7])
    const uniqueColors = new Set(colors)
    assert.equal(uniqueColors.size, 6, "exactly 6 distinct colors before wraparound")
  })

  it("reopening a released key gives a deterministic reassignment", () => {
    const cycle = createStreamColorCycle()
    const colorA1 = cycle.colorFor("run-a")
    cycle.colorFor("run-b")
    cycle.release("run-a")
    const colorA2 = cycle.colorFor("run-a")
    // same key gets the same slot it had before
    assert.equal(colorA1, colorA2)
  })

  it("colors are valid ANSI SGR codes", () => {
    const cycle = createStreamColorCycle()
    const color = cycle.colorFor("test")
    assert.ok(color.startsWith("\x1b["), "should start with ESC[")
    assert.ok(color.endsWith("m"), "should end with m")
  })

  it("pinned cycle order snapshot", () => {
    const cycle = createStreamColorCycle()
    const keys = ["a", "b", "c", "d", "e", "f"]
    const colors = keys.map((k) => cycle.colorFor(k))
    // Pin the exact order so regressions show up in diffs
    assert.deepStrictEqual(colors, [
      "\x1b[36m", // cyan
      "\x1b[33m", // yellow
      "\x1b[35m", // magenta
      "\x1b[32m", // green
      "\x1b[34m", // blue
      "\x1b[31m", // red
    ])
  })
})
