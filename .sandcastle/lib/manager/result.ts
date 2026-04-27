import type { ReviewerVerdict } from "./types.ts"

const VERDICT_TAG_RE = /<verdict>([\s\S]*?)<\/verdict>/

export function parseReviewerVerdict(stdout: string): ReviewerVerdict {
  const match = VERDICT_TAG_RE.exec(stdout)
  if (match?.[1]) {
    const content = match[1].trim()
    if (content === "approved") return { tag: "approved" }
    if (content.startsWith("rework")) {
      const reason = content
        .slice("rework".length)
        .replace(/^[\s:–—-]*/, "")
        .trim()
      return { tag: "rework", reason: reason || "No reason provided" }
    }
  }
  return { tag: "approved" }
}

export type ImplementerResult =
  | { readonly tag: "ok" }
  | { readonly tag: "failed"; readonly reason: string }

const RESULT_TAG_RE = /<result>([\s\S]*?)<\/result>/

export function parseImplementerResult(stdout: string): ImplementerResult {
  const match = RESULT_TAG_RE.exec(stdout)
  if (match?.[1]) {
    const content = match[1].trim()
    if (content.startsWith("failed")) {
      const reason = content
        .slice("failed".length)
        .replace(/^[\s:–—-]*/, "")
        .trim()
      return { tag: "failed", reason: reason || "No reason provided" }
    }
  }
  return { tag: "ok" }
}
