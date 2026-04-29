import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import { type OutputCapabilities, resolveOutputCapabilities } from "../palette.ts"

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
      expected: { color: true, unicode: true },
    },
    {
      isTTY: false,
      noColor: undefined,
      override: undefined,
      expected: { color: false, unicode: false },
    },
    { isTTY: true, noColor: undefined, override: "auto", expected: { color: true, unicode: true } },
    {
      isTTY: false,
      noColor: undefined,
      override: "auto",
      expected: { color: false, unicode: false },
    },

    // NO_COLOR set — suppresses color but unicode follows TTY
    { isTTY: true, noColor: "1", override: undefined, expected: { color: false, unicode: true } },
    { isTTY: true, noColor: "1", override: "auto", expected: { color: false, unicode: true } },
    { isTTY: false, noColor: "1", override: undefined, expected: { color: false, unicode: false } },
    { isTTY: false, noColor: "1", override: "auto", expected: { color: false, unicode: false } },

    // NO_COLOR empty string — treated as unset
    { isTTY: true, noColor: "", override: undefined, expected: { color: true, unicode: true } },
    { isTTY: false, noColor: "", override: undefined, expected: { color: false, unicode: false } },

    // always — forces everything on regardless of TTY / NO_COLOR
    { isTTY: false, noColor: "1", override: "always", expected: { color: true, unicode: true } },
    {
      isTTY: false,
      noColor: undefined,
      override: "always",
      expected: { color: true, unicode: true },
    },
    { isTTY: true, noColor: "1", override: "always", expected: { color: true, unicode: true } },
    {
      isTTY: true,
      noColor: undefined,
      override: "always",
      expected: { color: true, unicode: true },
    },

    // never — forces everything off regardless of TTY
    {
      isTTY: true,
      noColor: undefined,
      override: "never",
      expected: { color: false, unicode: false },
    },
    { isTTY: true, noColor: "1", override: "never", expected: { color: false, unicode: false } },
    {
      isTTY: false,
      noColor: undefined,
      override: "never",
      expected: { color: false, unicode: false },
    },
    { isTTY: false, noColor: "1", override: "never", expected: { color: false, unicode: false } },

    // invalid override treated as auto
    {
      isTTY: true,
      noColor: undefined,
      override: "bogus",
      expected: { color: true, unicode: true },
    },
    {
      isTTY: false,
      noColor: undefined,
      override: "bogus",
      expected: { color: false, unicode: false },
    },
  ]

  for (const { isTTY, noColor, override, expected } of cases) {
    const label = `TTY=${isTTY}, NO_COLOR=${noColor ?? "unset"}, override=${override ?? "unset"} → color=${expected.color}, unicode=${expected.unicode}`
    it(label, () => {
      const result = resolveOutputCapabilities(isTTY, noColor, override)
      assert.deepStrictEqual(result, expected)
    })
  }
})
