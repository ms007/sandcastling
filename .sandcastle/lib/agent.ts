/**
 * Custom Claude Code agent provider that wraps `sandcastle.claudeCode` and
 * injects a `--system-prompt` flag, replacing Claude Code's built-in system
 * prompt with the contents of `.sandcastle/prompts/system.md`.
 *
 * The path is resolved relative to the current working directory; this assumes
 * the script is launched from the project root (which `pnpm smoke` guarantees).
 */
import { readFileSync } from "node:fs"
import * as sandcastle from "@ai-hero/sandcastle"

const SYSTEM_PROMPT_PATH = "./.sandcastle/prompts/system.md"

const shellEscape = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`

export const claudeCustom = (
  model: string,
  options?: sandcastle.ClaudeCodeOptions,
): sandcastle.AgentProvider => {
  const systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf8")
  const base = sandcastle.claudeCode(model, options)
  const flag = ` --system-prompt ${shellEscape(systemPrompt)}`

  const baseInteractive = base.buildInteractiveArgs

  return {
    ...base,
    buildPrintCommand: (opts) => {
      const result = base.buildPrintCommand(opts)
      const patched = result.command.replace("claude --print", `claude --print${flag}`)
      if (patched === result.command) {
        throw new Error(
          "claudeCustom: failed to inject --system-prompt — sandcastle's claude command format may have changed.",
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
