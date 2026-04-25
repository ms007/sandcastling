import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import type { AgentProvider } from "@ai-hero/sandcastle"
import { __testing, wrapAgentProvider } from "../agent.ts"

const { shellEscape } = __testing

/** Build a minimally-typed AgentProvider for tests. */
const fakeProvider = (overrides: Partial<AgentProvider>): AgentProvider =>
  overrides as unknown as AgentProvider

describe("shellEscape", () => {
  it("wraps simple strings in single quotes", () => {
    assert.equal(shellEscape("hello"), "'hello'")
  })

  it("escapes a single quote by closing, escaping, and re-opening", () => {
    assert.equal(shellEscape("it's"), "'it'\\''s'")
  })

  it("escapes consecutive single quotes", () => {
    assert.equal(shellEscape("''"), "''\\'''\\'''")
  })

  it("leaves spaces, dollars, and backslashes untouched inside the quotes", () => {
    assert.equal(shellEscape("a $b \\c"), "'a $b \\c'")
  })

  it("handles the empty string", () => {
    assert.equal(shellEscape(""), "''")
  })

  it("escapes newlines literally — they pass through inside single quotes", () => {
    assert.equal(shellEscape("line1\nline2"), "'line1\nline2'")
  })
})

describe("wrapAgentProvider", () => {
  it("injects --system-prompt with shell-escaped content into buildPrintCommand", () => {
    const base = fakeProvider({
      buildPrintCommand: () => ({ command: "claude --print --foo bar" }),
    })
    const wrapped = wrapAgentProvider(base, "you are a test")
    const result = wrapped.buildPrintCommand({} as never)
    assert.equal(result.command, "claude --print --system-prompt 'you are a test' --foo bar")
  })

  it("preserves stdin when the base provider returns one", () => {
    const base = fakeProvider({
      buildPrintCommand: () => ({
        command: "claude --print --foo",
        stdin: "input data",
      }),
    })
    const wrapped = wrapAgentProvider(base, "x")
    const result = wrapped.buildPrintCommand({} as never)
    assert.equal(result.stdin, "input data")
  })

  it("omits stdin from the wrapped result when the base provider does not return one", () => {
    const base = fakeProvider({
      buildPrintCommand: () => ({ command: "claude --print" }),
    })
    const wrapped = wrapAgentProvider(base, "sys")
    const result = wrapped.buildPrintCommand({} as never)
    assert.equal("stdin" in result, false)
  })

  it("escapes single quotes in the system prompt so the shell parses it cleanly", () => {
    const base = fakeProvider({
      buildPrintCommand: () => ({ command: "claude --print" }),
    })
    const wrapped = wrapAgentProvider(base, "you're a test")
    const result = wrapped.buildPrintCommand({} as never)
    assert.equal(result.command, "claude --print --system-prompt 'you'\\''re a test'")
  })

  it("throws when sandcastle's claude command format changes (no 'claude --print' substring)", () => {
    const base = fakeProvider({
      buildPrintCommand: () => ({ command: "claude-code --invocation" }),
    })
    const wrapped = wrapAgentProvider(base, "x")
    assert.throws(() => wrapped.buildPrintCommand({} as never), /failed to inject --system-prompt/)
  })

  it("injects --system-prompt as separate args at position 1 of buildInteractiveArgs", () => {
    const base = fakeProvider({
      buildPrintCommand: () => ({ command: "claude --print" }),
      buildInteractiveArgs: () => ["claude", "--resume", "abc"],
    })
    const wrapped = wrapAgentProvider(base, "sys")
    const args = wrapped.buildInteractiveArgs?.({} as never)
    assert.deepEqual(args, ["claude", "--system-prompt", "sys", "--resume", "abc"])
  })

  it("falls back to ['--system-prompt', prompt] when the base returns an empty arg list", () => {
    const base = fakeProvider({
      buildPrintCommand: () => ({ command: "claude --print" }),
      buildInteractiveArgs: () => [],
    })
    const wrapped = wrapAgentProvider(base, "sys")
    const args = wrapped.buildInteractiveArgs?.({} as never)
    assert.deepEqual(args, ["--system-prompt", "sys"])
  })

  it("does not define buildInteractiveArgs when the base provider lacks it", () => {
    const base = fakeProvider({
      buildPrintCommand: () => ({ command: "claude --print" }),
    })
    const wrapped = wrapAgentProvider(base, "sys")
    assert.equal(wrapped.buildInteractiveArgs, undefined)
  })
})
