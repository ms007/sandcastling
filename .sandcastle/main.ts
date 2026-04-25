import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "./lib/index.ts";

const result = await sandcastle.run({
  sandbox: docker(),
  name: "Smoke",
  agent: sandcastle.claudeCode("claude-sonnet-4-6"),
  promptFile: "./.sandcastle/prompts/sample.md",
  branchStrategy: { type: "branch", branch: "smoke" },
  hooks: {
    sandbox: {
      onSandboxReady: [{ command: "pnpm install --prefer-offline" }],
    },
  },
});

console.log(
  `\n✅ ${result.commits.length} commit(s), signal: ${result.completionSignal ?? "(none — hit maxIterations)"}`,
);
