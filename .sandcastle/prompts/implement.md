# TASK

Implement issue **#{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}** on branch
**`{{BRANCH}}`**.

The Planner has already moved this issue to `In Progress` on the project
board (Project v2 item id: `{{ITEM_ID}}`). You are on `{{BRANCH}}`, which
Sandcastle forked from the host's HEAD. Work only on this single issue —
do not pull in adjacent fixes or refactors.

# CONTEXT

<issue>

!`gh issue view {{ISSUE_NUMBER}} --comments`

</issue>

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

If the issue references a parent (PRD), pull it for wider context:

```bash
gh issue view <parent-number>
```

# WORKFLOW

## 1. Explore the relevant code

Read the codebase before changing it. Pay extra attention to test files
that exercise the area you are about to touch.

## 2. Implement (RGR where it applies)

1. **Red** — failing test that captures the acceptance criterion.
2. **Green** — smallest change that turns it green.
3. **Repeat** until every acceptance criterion of this issue is covered.
4. **Refactor** for clarity once green.

Where TDD is impractical (config, docs, scaffolding), implement directly
and add coverage where it makes sense.

## 3. Verify

Both must be green:

```bash
pnpm typecheck
pnpm check
```

Or `pnpm verify`, which runs both. If verification fails, fix and re-run.
Do not commit broken code.

## 4. Commit

Conventional Commits, one logical change per commit:

```
<type>(<scope>): <summary>

<body — explain WHY, not what>

Refs #{{ISSUE_NUMBER}}
```

Acceptable `<type>` values: `feat`, `fix`, `chore`, `refactor`, `docs`,
`test`, `build`, `ci`. Multiple commits are fine if the work has multiple
logical chunks — each must be self-contained and verified.

## 5. Move status

Once **all** commits are in place AND `pnpm verify` is green:

```bash
bun .sandcastle/lib/project-cli.ts move-status {{ITEM_ID}} "In Review"
```

Idempotent.

# HANDLING BLOCKERS

If you cannot complete the issue (missing infrastructure, ambiguous
requirements, blocked by another open issue):

1. Do **not** move the status (leave it `In Progress`).
2. Leave a comment summarizing what was done, what's missing, and any
   decisions you would defer to a human:

   ```bash
   gh issue comment {{ISSUE_NUMBER}} --body "<summary>"
   ```

3. Do **not** emit the completion signal — exit normally.

Do not close the issue. The merger step closes issues at the end of the
run.

# RULES

- The sandbox already ran `pnpm install --prefer-offline`. Do not
  reinstall.
- Stay on `{{BRANCH}}`. Do not switch, push, or open a PR.
- Code, comments, and commit messages in **English**.
- Do not touch `.sandcastle/` (sandbox plumbing) unless the issue
  explicitly asks for it.
- No secrets in the repo, the diff, or the logs.

# DONE

Once the issue's commits are in place + `pnpm verify` is green + status
moved to `In Review`, output exactly:

```
<promise>COMPLETE</promise>
```

If you cannot complete the issue, do **not** emit the signal — leave the
issue comment and exit normally.
