# sandcastling

Sandcastling is a GitHub Project workflow automation built on
[`@ai-hero/sandcastle`](https://github.com/mattpocock/sandcastle).
Upstream sandcastle owns the coding agent and sandbox providers;
sandcastling owns the orchestrator that drives implement → review → merge
per issue and fast-forwards the result onto the host's base ref.

## TL;DR

1. Set up [GitHub prerequisites](#github-prerequisites) (Project board, label, `gh` auth).
2. Install `@ai-hero/sandcastle` as a dependency.
3. Register a `sandcastle` run script in `package.json`.
4. Copy the `.sandcastle/` config directory into your repo root.
5. Populate `.sandcastle/.env` with your `ANTHROPIC_API_KEY`.
6. Build the sandbox Docker image (`pnpm build:image`).
7. [Configure the entrypoint](#configure-the-entrypoint) in `.sandcastle/main.ts`.
8. [Write your prompts](#prompts) under `.sandcastle/prompts/`.

## GitHub prerequisites

- **Node.js ≥ 22** (see `.nvmrc`).
- **Docker** running locally.
- Exactly one **GitHub Project v2** linked to the repo with the canonical
  Status field schema: **Todo → In Progress → In Review → Done**.
- A **`sandcastle`** label on every issue the orchestrator should process.
- **Native sub-issue relationships** for PRD / child-issue structure.
- The **`sandcastle/issue-<n>`** branch convention — one branch per issue,
  forked from the host's base ref.
- **`gh` CLI** authenticated against the target repo.

## Setup

```bash
# 1. Add the dependency
pnpm add @ai-hero/sandcastle

# 2. Register the run script in package.json
#    "scripts": { "sandcastle": "tsx .sandcastle/main.ts" }

# 3. Copy the .sandcastle/ config directory into your repo root

# 4. Create the env file and set your API key
cp .sandcastle/.env.example .sandcastle/.env
# edit .sandcastle/.env → ANTHROPIC_API_KEY=sk-ant-...

# 5. Build the sandbox Docker image
pnpm build:image
```

## Configure the entrypoint

`.sandcastle/main.ts` is the single configuration surface:

```ts
import { claudeCustom } from "./agent.ts"
import { runOrchestrator } from "./lib/index.ts"
import { sandbox, sandboxHooks } from "./sandbox.ts"

// Seed issue from the CLI — `pnpm sandcastle <issue-number>`
const seedIssue = Number(process.argv[2])
if (!Number.isInteger(seedIssue) || seedIssue <= 0) {
  console.error("Usage: pnpm sandcastle <issue-number>")
  process.exit(2)
}

const result = await runOrchestrator({
  seedIssue,                          // single issue or a PRD with children
  sandbox,                            // Sandbox factory — swap to retarget the runtime
  hooks: sandboxHooks,                // lifecycle hooks injected into the sandbox
  logDir: ".sandcastle/logs",         // per-run transcripts land here
  stages: {
    implement: {
      agent: claudeCustom("claude-opus-4-6"),   // agent (model) per stage
      promptFile: "./.sandcastle/prompts/implement.md",
    },
    review: {
      agent: claudeCustom("claude-opus-4-6"),
      promptFile: "./.sandcastle/prompts/review.md",
    },
    merge: {
      agent: claudeCustom("claude-opus-4-6"),
      promptFile: "./.sandcastle/prompts/merge.md",
    },
  },
  // tickCap — bounds the total workflow loop iterations
  // attemptCap — bounds the per-issue rework budget
})

process.exit(result.tag === "done" ? 0 : 1)
```

## Prompts

Four prompt files live under `.sandcastle/prompts/`:

| File | Role |
| --- | --- |
| `system.md` | Base system prompt shared by every stage |
| `implement.md` | Implementer task prompt |
| `review.md` | Reviewer task prompt |
| `merge.md` | Merger task prompt |

The orchestrator substitutes placeholders before each stage invocation.

**`implement` and `review` placeholders:**

| Placeholder | Value |
| --- | --- |
| `{{ISSUE_NUMBER}}` | GitHub issue number |
| `{{ISSUE_TITLE}}` | Issue title |
| `{{BRANCH}}` | The `sandcastle/issue-<n>` branch |
| `{{PRIOR_ATTEMPTS}}` | Formatted log of earlier attempts (empty on first run) |

**`merge` placeholders:**

| Placeholder | Value |
| --- | --- |
| `{{BRANCH_LIST}}` | Branches to merge in this wave |
| `{{ISSUE_LIST}}` | Issues included in the merge |
| `{{BASE_LABEL}}` | The base ref the worktree was forked from |
| `{{PRIOR_ATTEMPTS}}` | Formatted log of earlier attempts (empty on first run) |

Prompt content is the adopter's responsibility. The shipped prompts are
project-specific scaffolding, not normative.

## Run

```bash
pnpm sandcastle 42    # seed = issue #42
```

Per-run transcripts land in `.sandcastle/logs/`. Each issue is worked on a
`sandcastle/issue-<n>` branch forked from the host's base ref.

## Limitations

- Auth is API-key only. Subscription-based auth via `CLAUDE_CODE_OAUTH_TOKEN`
  is tracked upstream in
  [mattpocock/sandcastle#191](https://github.com/mattpocock/sandcastle/issues/191).
- The sandbox runs as UID 1000 (`agent`); the custom Docker provider in
  `.sandcastle/sandboxes/docker/` exists to keep file ownership sane on
  bind mounts — see the design notes in `docker.ts` and `chown.ts` before
  changing it.
- One concurrent sandbox container per issue. Cross-issue parallelism is
  bounded by `tickCap` and the manager, not by Docker.
