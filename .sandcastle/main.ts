import * as sandcastle from "@ai-hero/sandcastle";
import { claudeCustom, docker } from "./lib/index.ts";

const issueNumber = Number(process.argv[2]);
if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
  console.error("Usage: pnpm sandcastle <issue-number>");
  process.exit(2);
}

interface PlannedIssue {
  readonly number: number;
  readonly title: string;
  readonly itemId: string;
  readonly branch: string;
}

const COMPLETION_SIGNAL = "<promise>COMPLETE</promise>";

const INSTALL_HOOKS = {
  sandbox: {
    onSandboxReady: [{ command: "pnpm install --prefer-offline" }],
  },
} as const;

const issuePromptArgs = (issue: PlannedIssue) => ({
  ISSUE_NUMBER: String(issue.number),
  ISSUE_TITLE: issue.title,
  ITEM_ID: issue.itemId,
  BRANCH: issue.branch,
});

// Hard cap on outer iterations as a backstop. Normal termination is the
// planner returning an empty issue list; this cap only fires if something
// keeps re-planning the same set without progress.
const MAX_ITERATIONS = 10;

// Issues we have already implemented + merged in earlier iterations. If the
// planner re-emits one, the merger failed to close it (or the project board
// is out of sync) — abort instead of looping forever.
const seenIssueNumbers = new Set<number>();

let plannerSignalledDone = false;

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===`);

  // Planner is read-only (gh + project-cli) — no install needed.
  const plan = await sandcastle.run({
    sandbox: docker(),
    name: `Planner (iter ${iteration})`,
    agent: claudeCustom("claude-sonnet-4-6"),
    promptFile: "./.sandcastle/prompts/plan.md",
    promptArgs: { ISSUE_NUMBER: String(issueNumber) },
  });

  const planMatch = plan.stdout.match(/<plan>([\s\S]*?)<\/plan>/);
  const planJson = planMatch?.[1];
  if (!planJson) {
    if (iteration === 1) {
      throw new Error(
        `Planner did not produce a <plan> tag.\n\n${plan.stdout}`,
      );
    }
    console.log("Planner produced no <plan> tag — treating as done.");
    plannerSignalledDone = true;
    break;
  }

  const { issues } = JSON.parse(planJson) as { issues: PlannedIssue[] };

  if (issues.length === 0) {
    if (iteration === 1) {
      throw new Error("Planner returned an empty issue list on first run.");
    }
    console.log("No more eligible issues. Done.");
    plannerSignalledDone = true;
    break;
  }

  const replanned = issues.filter((i) => seenIssueNumbers.has(i.number));
  if (replanned.length > 0) {
    const tag = replanned.map((i) => `#${i.number}`).join(", ");
    throw new Error(
      `Planner re-emitted already-completed issue(s): ${tag}. ` +
        "Either the previous merger failed to close them, or their project " +
        "status was not moved to Done, or the board is otherwise out of " +
        "sync. Aborting to avoid an infinite loop.",
    );
  }

  console.log(`Planner picked ${issues.length} issue(s):`);
  for (const issue of issues) {
    console.log(`  #${issue.number} ${issue.title} → ${issue.branch}`);
  }

  const completedIssues: PlannedIssue[] = [];

  for (const issue of issues) {
    console.log(`\n--- Implementing #${issue.number} on ${issue.branch} ---`);

    await using sandbox = await sandcastle.createSandbox({
      sandbox: docker(),
      branch: issue.branch,
      hooks: INSTALL_HOOKS,
    });

    const implement = await sandbox.run({
      name: `Implementer #${issue.number}`,
      agent: claudeCustom("claude-sonnet-4-6"),
      promptFile: "./.sandcastle/prompts/implement.md",
      promptArgs: issuePromptArgs(issue),
      completionSignal: COMPLETION_SIGNAL,
    });

    if (implement.commits.length === 0) {
      throw new Error(
        `Implementer for #${issue.number} produced no commits on ${issue.branch}. ` +
          `Inspect .sandcastle/logs/ for the implementer transcript before re-running.`,
      );
    }

    console.log(
      `Implementer for #${issue.number} produced ${implement.commits.length} commit(s).`,
    );

    await sandbox.run({
      name: `Reviewer #${issue.number}`,
      agent: claudeCustom("claude-sonnet-4-6"),
      promptFile: "./.sandcastle/prompts/review.md",
      promptArgs: issuePromptArgs(issue),
      completionSignal: COMPLETION_SIGNAL,
    });

    completedIssues.push(issue);
  }

  console.log(
    `\n${completedIssues.length} branch(es) ready to merge:\n${completedIssues
      .map((i) => `  ${i.branch}`)
      .join("\n")}`,
  );

  await sandcastle.run({
    sandbox: docker(),
    name: `Merger (iter ${iteration})`,
    agent: claudeCustom("claude-sonnet-4-6"),
    promptFile: "./.sandcastle/prompts/merge.md",
    promptArgs: {
      BRANCH_LIST: completedIssues.map((i) => `- ${i.branch}`).join("\n"),
      ISSUE_LIST: completedIssues
        .map((i) => `- #${i.number} (itemId: ${i.itemId}): ${i.title}`)
        .join("\n"),
    },
    completionSignal: COMPLETION_SIGNAL,
    hooks: INSTALL_HOOKS,
  });

  for (const issue of completedIssues) {
    seenIssueNumbers.add(issue.number);
  }

  console.log(
    `\nIteration ${iteration} complete. ${completedIssues.length} issue(s) merged.`,
  );
}

if (!plannerSignalledDone) {
  throw new Error(
    `Reached MAX_ITERATIONS (${MAX_ITERATIONS}) without the planner ` +
      "returning an empty list. Investigate before re-running.",
  );
}

console.log(`\nAll done. ${seenIssueNumbers.size} issue(s) merged.`);
