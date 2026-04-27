/**
 * Project-specific Claude Code agent provider that injects the system prompt
 * from `.sandcastle/prompts/system.md` via `wrapAgentProvider`. The file is
 * read once at module load and reused across all stage invocations.
 *
 * The path is resolved relative to the current working directory; this assumes
 * the script is launched from the project root (which `pnpm sandcastle` guarantees).
 */
import { readFileSync } from "node:fs"
import * as sandcastle from "@ai-hero/sandcastle"
import { wrapAgentProvider } from "./lib/index.ts"

const SYSTEM_PROMPT_PATH = "./.sandcastle/prompts/system.md"

const systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf8")

export const claudeCustom = (
  model: string,
  options?: sandcastle.ClaudeCodeOptions,
): sandcastle.AgentProvider =>
  wrapAgentProvider(sandcastle.claudeCode(model, options), systemPrompt)
