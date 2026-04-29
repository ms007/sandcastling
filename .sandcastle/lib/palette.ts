export interface OutputCapabilities {
  readonly color: boolean
  readonly unicode: boolean
  readonly liveRedraw: boolean
}

export type ColorOverride = "auto" | "always" | "never"

const VALID_OVERRIDES = new Set<string>(["auto", "always", "never"])

const STREAM_COLORS: readonly string[] = [
  "\x1b[36m", // cyan
  "\x1b[33m", // yellow
  "\x1b[35m", // magenta
  "\x1b[32m", // green
  "\x1b[34m", // blue
  "\x1b[31m", // red
]

export const ANSI_RESET = "\x1b[0m"

export interface StreamColorCycle {
  colorFor(streamKey: string): string
  release(streamKey: string): void
}

export function createStreamColorCycle(): StreamColorCycle {
  const assignments = new Map<string, number>()
  let nextSlot = 0

  return {
    colorFor(streamKey: string): string {
      const existing = assignments.get(streamKey)
      if (existing !== undefined) return STREAM_COLORS[existing % STREAM_COLORS.length] as string
      const slot = nextSlot++
      assignments.set(streamKey, slot)
      return STREAM_COLORS[slot % STREAM_COLORS.length] as string
    },
    release(_streamKey: string): void {
      // Keep the slot assignment so reopening the same key is deterministic
    },
  }
}

export function resolveOutputCapabilities(
  isTTY: boolean,
  noColor: string | undefined,
  override: string | undefined,
): OutputCapabilities {
  const parsed: ColorOverride =
    override !== undefined && VALID_OVERRIDES.has(override) ? (override as ColorOverride) : "auto"

  if (parsed === "always") return { color: true, unicode: true, liveRedraw: isTTY }
  if (parsed === "never") return { color: false, unicode: false, liveRedraw: false }

  if (noColor !== undefined && noColor !== "")
    return { color: false, unicode: isTTY, liveRedraw: false }
  return { color: isTTY, unicode: isTTY, liveRedraw: isTTY }
}
