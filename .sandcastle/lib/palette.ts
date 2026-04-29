export interface OutputCapabilities {
  readonly color: boolean
  readonly unicode: boolean
}

export type ColorOverride = "auto" | "always" | "never"

const VALID_OVERRIDES = new Set<string>(["auto", "always", "never"])

export function resolveOutputCapabilities(
  isTTY: boolean,
  noColor: string | undefined,
  override: string | undefined,
): OutputCapabilities {
  const parsed: ColorOverride =
    override !== undefined && VALID_OVERRIDES.has(override) ? (override as ColorOverride) : "auto"

  if (parsed === "always") return { color: true, unicode: true }
  if (parsed === "never") return { color: false, unicode: false }

  if (noColor !== undefined && noColor !== "") return { color: false, unicode: isTTY }
  return { color: isTTY, unicode: isTTY }
}
