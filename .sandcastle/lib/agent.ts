/**
 * Generic AgentProvider wrapper that injects a `--system-prompt` flag,
 * replacing Claude Code's built-in system prompt with caller-supplied
 * content. Project-specific wiring (which file to read, which model) lives
 * in user code outside the lib.
 */
import type { AgentProvider } from "@ai-hero/sandcastle"

const shellEscape = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`

export const wrapAgentProvider = (base: AgentProvider, systemPrompt: string): AgentProvider => {
  const flag = ` --system-prompt ${shellEscape(systemPrompt)}`
  const baseInteractive = base.buildInteractiveArgs

  return {
    ...base,
    buildPrintCommand: (opts) => {
      const result = base.buildPrintCommand(opts)
      const patched = result.command.replace("claude --print", `claude --print${flag}`)
      if (patched === result.command) {
        throw new Error(
          "wrapAgentProvider: failed to inject --system-prompt — sandcastle's claude command format may have changed.",
        )
      }
      return result.stdin === undefined
        ? { command: patched }
        : { command: patched, stdin: result.stdin }
    },
    ...(baseInteractive && {
      buildInteractiveArgs: (opts) => {
        const [bin, ...rest] = baseInteractive(opts)
        // Insert "--system-prompt", "<content>" right after the "claude" binary token.
        return bin === undefined
          ? ["--system-prompt", systemPrompt]
          : [bin, "--system-prompt", systemPrompt, ...rest]
      },
    }),
  }
}

/** Test seam — internal helpers exposed for unit tests. Not a public API. */
export const __testing = { shellEscape }
