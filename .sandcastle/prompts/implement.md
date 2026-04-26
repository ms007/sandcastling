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

!`git log --oneline -n 10`

</recent-commits>

Only if the issue itself does not give you enough context, pull the
parent PRD:

```bash
gh issue view <parent-number>
```

# WORKFLOW

## 1. Explore the relevant code

<<<<<<< Updated upstream
Read the codebase before changing it. Pay extra attention to test files
that exercise the area you are about to touch.
=======
Goal: enough context to implement the issue correctly — but no
exploration for its own sake.

- Start with the files the issue (or a linked PRD) explicitly names.
  Reading the test file that covers the affected module alongside is
  expected — it's the most compact behavior contract you'll get.
- Expand only with a concrete open question (e.g. "where is X
  called?"). Use targeted `Grep` for the symbol — not directory
  listings, not `find`, not recursive `ls`, not `Glob '**/*'`. The repo
  layout is irrelevant to the task.
- Do **not** re-fetch context the prompt already inlines (the issue
  body, recent commits) and do not enumerate the workspace to "see what
  the project looks like".
- **Avoid the Explore subagent when the issue already names files or is
  scoped to a single module.** While a subagent runs, the parent emits
  no tokens — long Explore runs count as agent idle time and risk a
  10-minute timeout abort. Use it only for genuinely cross-cutting
  searches you cannot answer with one or two `Grep`s.
- Read a file in full only if you intend to modify it, derive a test
  pattern from it, or use its types in your patch. Otherwise a targeted
  range or `Grep` is enough.
- Stop exploring as soon as you can write the first Red test. Further
  reading should be triggered by a concrete question that arises during
  implementation, not collected up front.
- **Emit one short status line after every batch of tool calls.** The
  harness aborts after 10 minutes of silence; long tool chains and
  subagent runs without parent text count as silence.
>>>>>>> Stashed changes

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
