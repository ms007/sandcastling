# TASK

Implement the bundle of issues on branch **`{{BRANCH}}`**:

{{BUNDLE_LIST}}

Each line shows `#<number>` (the issue number), `(itemId: <itemId>)` (the
Project v2 item ID — needed for status mutations), and the issue title.

The Planner has already claimed every bundle item by moving it to
`In Progress` on the project board. You are on `{{BRANCH}}`, which Sandcastle
forked from the host's HEAD.

# CONTEXT

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# WORKFLOW

Work through the bundle issues **in the order listed above**. For each
issue:

## 1. Read the issue

```bash
gh issue view <number> --comments
```

If the issue has a parent (PRD), pull that too — it carries wider context:

```bash
gh issue view <parent-number>
```

Only work on **this one issue** in this iteration of the loop. Do not
opportunistically fix other things.

## 2. Explore the relevant code

Read the codebase before changing it. Pay extra attention to test files
that exercise the area you are about to touch.

## 3. Implement (RGR where it applies)

1. **Red** — failing test that captures the acceptance criterion.
2. **Green** — smallest change that turns it green.
3. **Repeat** until every acceptance criterion of *this* issue is covered.
4. **Refactor** for clarity once green.

Where TDD is impractical (config, docs, scaffolding), implement directly
and add coverage where it makes sense.

## 4. Verify

Both must be green:

```bash
pnpm typecheck
pnpm check
```

Or `pnpm verify`, which runs both.

If verification fails, fix and re-run. Do not commit broken code.

## 5. Commit

Conventional Commits, one logical change per commit:

```
<type>(<scope>): <summary>

<body — explain WHY, not what>

Refs #<number>
```

Acceptable `<type>` values: `feat`, `fix`, `chore`, `refactor`, `docs`,
`test`, `build`, `ci`. Multiple commits per issue are fine if the work has
multiple logical chunks — each must be self-contained and verified.

## 6. Move status

Once **all** of the issue's commits are in place AND `pnpm verify` is green:

```bash
bun .sandcastle/lib/project-cli.ts move-status <itemId> "In Review"
```

Use the exact `itemId` from the bundle list at the top of this prompt.
Idempotent.

## 7. Move on to the next issue

Return to step 1 with the next item in the bundle list.

# HANDLING BLOCKERS MID-BUNDLE

If, while working an issue, you discover it must merge before another
bundle item can proceed (or vice versa), or you simply cannot complete it:

1. Do **not** move that issue's status (leave it `In Progress`).
2. Leave a comment summarizing what was done, what's missing, and any
   decisions you would defer to a human:

   ```bash
   gh issue comment <number> --body "<summary>"
   ```

3. Continue to the next issue if it can stand alone, otherwise stop.

Do not close any issue.

# RULES

- The sandbox already ran `pnpm install --prefer-offline`. Do not reinstall.
- Stay on `{{BRANCH}}`. Do not switch, push, or open a PR.
- Code, comments, and commit messages in **English**.
- Do not touch `.sandcastle/` (sandbox plumbing) unless the issue explicitly
  asks for it.
- No secrets in the repo, the diff, or the logs.

# DONE

Once **every** issue in the bundle has its commits + `pnpm verify` is green
+ status moved to `In Review`, output exactly:

```
<promise>COMPLETE</promise>
```

If you cannot complete every issue, do **not** emit the signal — leave the
relevant issue comments and exit normally.
