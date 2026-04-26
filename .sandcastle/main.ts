import { runOrchestrator } from "./lib/orchestrator.ts"

const issueNumber = Number(process.argv[2])
if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
  console.error("Usage: pnpm sandcastle <issue-number>")
  process.exit(2)
}

const result = await runOrchestrator(issueNumber)

process.exit(result.tag === "done" ? 0 : 1)
