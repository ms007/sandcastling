# sandcastling

A testbed for automating GitHub issues with [`@ai-hero/sandcastle`](https://github.com/mattpocock/sandcastle).

`sandcastle` runs a coding agent (here: Claude Code) inside a disposable Docker
sandbox against a git worktree of this repo. `sandcastling` is the playground
where we evaluate that workflow end-to-end — from picking up a GitHub issue,
to having the agent code, commit, and (eventually) open a PR — without ever
touching the host filesystem or the main branch.

> **Status:** smoke-test stage. The current run wires up the sandbox and asks
> the agent to make a single trivial commit. Issue-driven automation is the
> next milestone.

---

## For humans

### What this repo is for

- Validate that `sandcastle` boots reliably with our Dockerfile, volumes, and
  branch strategy.
- Iterate on the system prompt and tooling the agent gets when it is asked to
  resolve a GitHub issue.
- Catch breakage early when bumping `@ai-hero/sandcastle`, the Claude Code CLI,
  or the model in use.

### What's inside

```
.sandcastle/
├── main.ts              # entrypoint: configures and runs sandcastle
├── Dockerfile           # sandbox image (node 22 + git + Claude Code CLI + pnpm)
├── prompts/
│   └── sample.md        # task prompt handed to the agent
├── lib/                 # custom docker bind-mount provider (see lib/docker.ts)
├── .env.example         # ANTHROPIC_API_KEY lives here
├── logs/                # per-run agent logs (gitignored)
└── worktrees/           # ephemeral git worktrees per run (gitignored)
```

The host project itself is intentionally minimal: TypeScript + Biome, a
`chalk` dependency so the agent has something to import, and pnpm as the
package manager (pinned via `packageManager` in `package.json`).

### Prerequisites

- Node.js ≥ 22 (see `.nvmrc`)
- pnpm 10.31.0 (auto-activated via Corepack)
- Docker running locally
- An Anthropic API key

### Setup

```bash
pnpm install
cp .sandcastle/.env.example .sandcastle/.env
# then edit .sandcastle/.env and set ANTHROPIC_API_KEY=sk-ant-...
pnpm build:image      # builds the sandcastle:latest Docker image
```

### Run the smoke test

```bash
pnpm smoke
```

This will:

1. Spin up a container from `sandcastle:latest`.
2. Bind-mount a fresh git worktree on branch `smoke`.
3. Run `pnpm install --prefer-offline` inside the sandbox.
4. Hand `prompts/sample.md` to Claude Code and let it work.
5. Print the number of commits and the completion signal on exit.

The agent's task in the sample prompt is to create `greeting.ts` and make
exactly one Conventional Commit. Logs land in `.sandcastle/logs/`.

### Useful scripts

| Command                | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `pnpm smoke`           | Run the sandcastle agent end-to-end                  |
| `pnpm build:image`     | (Re)build the sandbox Docker image                   |
| `pnpm clean`           | Drop the persistent `node_modules` / pnpm-store volumes |
| `pnpm verify`          | `tsc --noEmit` + Biome `check`                       |
| `pnpm lint` / `format` | Biome lint / format                                  |

### Switching models or prompts

- **Model:** edit the `sandcastle.claudeCode("…")` call in
  `.sandcastle/main.ts`.
- **Task:** point `promptFile` at a different file under
  `.sandcastle/prompts/`.
- **Branch strategy:** see `branchStrategy` in `main.ts` — defaults to a
  fixed `smoke` branch so each run is reproducible.

### Known limitations

- Auth is API-key only. Subscription-based auth via `CLAUDE_CODE_OAUTH_TOKEN`
  is tracked upstream in
  [mattpocock/sandcastle#191](https://github.com/mattpocock/sandcastle/issues/191).
- The sandbox runs as UID 1000 (`agent`); the custom provider in
  `.sandcastle/lib/` exists to keep file ownership sane on bind mounts — see
  the design notes in `lib/docker.ts` and `lib/chown.ts` before changing it.

---

## For agents

If you are an LLM-based coding agent reading this repo, here is what you need
to know to be useful:

### Mental model

- This repo is **not** the product. It is a harness whose product is *another
  agent run* (yours or Claude Code's, executed by `sandcastle`).
- The "real" workflow we are building toward: a GitHub issue → an autonomous
  sandcastle run that produces a PR resolving it. Today only the smoke path
  exists.
- Source of truth for what the sandboxed agent does is `prompts/sample.md`
  plus `.sandcastle/main.ts`. Behavior changes belong there, not in
  application code.

### Ground rules

- **Stay on your assigned branch.** `branchStrategy` in `main.ts` controls
  this. Don't switch branches, don't push, don't open PRs unless the prompt
  explicitly asks.
- **One logical change per commit.** Use Conventional Commits
  (`feat:`, `fix:`, `chore:`, …). No `--amend`, no force-pushes.
- **Don't reinstall dependencies.** `onSandboxReady` already runs
  `pnpm install --prefer-offline`. Re-running it wastes the warm volume cache.
- **Don't write secrets to the repo.** `.sandcastle/.env` is gitignored;
  never commit `ANTHROPIC_API_KEY` or any other credential, and never echo it
  into logs or chat.
- **Don't touch the sandbox plumbing casually.** Files under
  `.sandcastle/lib/`, `.sandcastle/Dockerfile`, and the volume names in
  `package.json` are coupled. Read the comments in `lib/docker.ts` and
  `lib/chown.ts` before editing.
- **Verify before declaring done.** Run `pnpm verify` (typecheck + Biome) for
  any TypeScript change. The smoke prompt also defines its own
  `<promise>COMPLETE</promise>` signal — emit it only when the post-conditions
  it lists actually hold.

### When asked to extend automation

Likely shapes of future work:

- A new prompt under `.sandcastle/prompts/` describing how to consume a
  GitHub issue (title, body, comments) and what "done" means.
- A new entrypoint alongside `main.ts` that fetches the issue via `gh` and
  feeds its content into `promptFile` (or an inline `prompt`).
- A different `branchStrategy` (e.g. one branch per issue).

Prefer additive changes over rewriting `main.ts` so the smoke path keeps
working as a regression check.

### Style

- TypeScript, ES modules, Node 22+. No CommonJS.
- Biome (`biome.json`) is the formatter and linter — match its rules instead
  of arguing with them.
- Code, comments, commit messages, and docs are written in **English**.

---

## License

Private / unpublished. Do not redistribute.
