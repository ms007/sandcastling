import * as sandcastle from "@ai-hero/sandcastle";
import { claudeCustom, docker } from "./lib/index.ts";

const issueNumber = Number(process.argv[2]);
if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
  console.error("Usage: pnpm sandcastle:run <issue-number>");
  process.exit(2);
}

const plan = await sandcastle.run({
  sandbox: docker(),
  name: "Planner",
  agent: claudeCustom("claude-sonnet-4-6"),
  promptFile: "./.sandcastle/prompts/plan.md",
  promptArgs: { ISSUE_NUMBER: String(issueNumber) },
  hooks: {
    sandbox: {
      onSandboxReady: [{ command: "pnpm install --prefer-offline" }],
    },
  },
});

const planMatch = plan.stdout.match(/<plan>([\s\S]*?)<\/plan>/);
if (!planMatch) {
  throw new Error(`Planner did not produce a <plan> tag.\n\n${plan.stdout}`);
}

const { bundle, branch } = JSON.parse(planMatch[1]) as {
  bundle: { number: number; title: string; itemId: string }[];
  branch: string;
};

console.log(`\nPlanner picked ${bundle.length} issue(s) on ${branch}:`);
for (const item of bundle) {
  console.log(`  #${item.number} ${item.title}`);
}

const bundleList = bundle
  .map((b) => `- #${b.number} (itemId: ${b.itemId}): ${b.title}`)
  .join("\n");

// Phase 2: Implement + Review on a single sandbox / single branch
await using sandbox = await sandcastle.createSandbox({
  sandbox: docker(),
  branch,
  hooks: {
    sandbox: {
      onSandboxReady: [{ command: "pnpm install --prefer-offline" }],
    },
  },
});

const implement = await sandbox.run({
  name: "Implementer",
  agent: claudeCustom("claude-sonnet-4-6"),
  promptFile: "./.sandcastle/prompts/implement.md",
  promptArgs: { BRANCH: branch, BUNDLE_LIST: bundleList },
  completionSignal: "<promise>COMPLETE</promise>",
});

if (implement.commits.length === 0) {
  console.log("\nImplementer produced no commits. Nothing to review.");
  process.exit(1);
}

console.log(
  `\nImplementer produced ${implement.commits.length} commit(s) on ${branch}.`,
);

await sandbox.run({
  name: "Reviewer",
  agent: claudeCustom("claude-sonnet-4-6"),
  promptFile: "./.sandcastle/prompts/review.md",
  promptArgs: { BRANCH: branch, BUNDLE_LIST: bundleList },
  completionSignal: "<promise>COMPLETE</promise>",
});

console.log(`\nReview complete. Inspect with:  git log ${branch}`);
console.log(`Merge with:                     git merge ${branch} --no-ff`);
