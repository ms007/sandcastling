import {
  type PlannedIssue,
  captureBaseRef,
  createIssueSandbox,
  runImplementer,
  runMerger,
  runPlanner,
  runReviewer,
} from "./lib/index.ts"

const MAX_ITERATIONS = 10

const issueNumber = Number(process.argv[2])
if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
  console.error("Usage: pnpm sandcastle <issue-number>")
  process.exit(2)
}

let plannerSignalledDone = false
const baseRef = captureBaseRef()
const mergedIssueNumbers = new Set<number>()

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===`)

  // Phase 1: Plan — orchestrator agent analyzes issues and picks eligible ones.
  const issues = await runPlanner({ iteration, issueNumber })
  if (issues.length === 0) {
    console.log("No more eligible issues. Done.")
    plannerSignalledDone = true
    break
  }

  const replanned = issues.filter((i) => mergedIssueNumbers.has(i.number))
  if (replanned.length > 0) {
    const tag = replanned.map((i) => `#${i.number}`).join(", ")
    throw new Error(
      `Planner re-emitted already-completed issue(s): ${tag}. Either the previous merger failed to close them, or their project status was not moved to Done, or the board is otherwise out of sync. Aborting to avoid an infinite loop.`,
    )
  }

  console.log(`Planner picked ${issues.length} issue(s):`)
  for (const issue of issues) {
    console.log(`  #${issue.number} ${issue.title} → ${issue.branch}`)
  }

  const completedIssues: PlannedIssue[] = []

  // Phase 2: Execute + Review — implement then review each branch
  for (const issue of issues) {
    console.log(`\n--- Implementing #${issue.number} on ${issue.branch} ---`)
    await using sandbox = await createIssueSandbox(issue)
    await runImplementer({ sandbox, issue, baseRef })
    await runReviewer({ sandbox, issue })
    completedIssues.push(issue)
  }

  console.log(
    `\n${completedIssues.length} branch(es) ready to merge:\n${completedIssues
      .map((i) => `  ${i.branch}`)
      .join("\n")}`,
  )

  // Phase 3: Merge — one agent merges all branches together
  await runMerger({ iteration, issues: completedIssues })

  for (const issue of completedIssues) mergedIssueNumbers.add(issue.number)
  console.log(`\nIteration ${iteration} complete. ${completedIssues.length} issue(s) merged.`)
}

if (!plannerSignalledDone) {
  throw new Error(
    `Reached MAX_ITERATIONS (${MAX_ITERATIONS}) without the planner returning an empty list. Investigate before re-running.`,
  )
}

console.log(`\nAll done. ${mergedIssueNumbers.size} issue(s) merged.`)
