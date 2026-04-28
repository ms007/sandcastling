# Sandcastling

Harness around `@ai-hero/sandcastle` that runs Claude Code in a Docker
sandbox to resolve GitHub issues end-to-end. The product of this repo is
the sandbox run, not the host code.

## Where to make changes

- Behavior of the sandboxed agent → `.sandcastle/prompts/{system,implement,review,merge}.md`.
- Workflow / scheduling logic → `.sandcastle/lib/manager/` (pure
  observe-decide-act loop in `workflow.ts`; do not couple to gh/git here).
- gh / git / Docker / Projects adapters → `.sandcastle/lib/orchestrator.ts`
  and the sibling adapter files.
- Entrypoint knobs (model, caps, transcript) → `.sandcastle/main.ts` only.

Sandbox plumbing — `.sandcastle/sandboxes/docker/docker.ts`,
`.sandcastle/sandboxes/docker/chown.ts`, `.sandcastle/Dockerfile`, and the
volume names in `package.json` — is coupled. Read the comments in
`docker.ts` and `chown.ts` before editing.

## Verify

```
pnpm verify   # tsc --noEmit + biome check + node --test
```

Never declare done with a red verify.

## Conventions

- TypeScript, ES modules, Node ≥ 22. No CommonJS.
- Biome (`biome.json`) is the formatter and linter — match its rules.
- Code, comments, commit messages, docs: English.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`,
  `test:`, `build:`, `ci:`). One logical change per commit. No `--amend`,
  no force-push, no `git add -A`.
- Default to no comments. Don't add comments, docstrings, or type
  annotations to code you didn't change.

## Don't

- Don't commit secrets. `.sandcastle/.env` is gitignored.
- Don't edit `.sandcastle/prompts/*.md` and the corresponding stage runner
  in the same change without checking the placeholder contract in
  `stages.ts` — `{{ISSUE_NUMBER}}`, `{{BRANCH}}`, `{{PRIOR_ATTEMPTS}}`,
  etc. are substituted there.
