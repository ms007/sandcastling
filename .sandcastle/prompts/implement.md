# TASK

Implement issue **#{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}** on branch
**`{{BRANCH}}`**.

You are on `{{BRANCH}}`, which Sandcastle forked from the host's HEAD.
Work only on this single issue — do not pull in adjacent fixes or
refactors.

# CONTEXT

<issue>

!`gh issue view {{ISSUE_NUMBER}} --comments`

</issue>

{{PRIOR_ATTEMPTS}}

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

If the issue references a parent (PRD), pull it for wider context:

```bash
gh issue view <parent-number>
```

# WORKFLOW

## 1. Exploration

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

# RULES

- The sandbox already ran `pnpm install --prefer-offline`. Do not
  reinstall.
- Stay on `{{BRANCH}}`. Do not switch, push, or open a PR.
- Do **not** merge, rebase, or cherry-pick from any other
  `sandcastle/*` branch. Your branch was forked from the host's HEAD
  and must stay independent.
- If you discover that completing this issue requires code from another
  sandcastle issue branch that has not yet been merged into the base,
  **stop immediately** and emit the cross-branch dependency failure
  verdict described below.
- Code, comments, and commit messages in **English**.
- No secrets in the repo, the diff, or the logs.
- Do **not** move project status, post status comments, close issues, or
  drop blocking edges. The orchestrator handles all bookkeeping.

# DONE

Once the issue's commits are in place and `pnpm verify` is green, output
exactly:

```
<result>ok</result>
```

If you cannot complete the issue (missing infrastructure, ambiguous
requirements, blocked by another open issue), output instead:

```
<result>failed: <one-line reason></result>
```

If the reason is a cross-branch dependency — you need code that lives on
another sandcastle issue branch and has not been merged into the base —
use this specific verdict so the orchestrator can identify it:

```
<result>failed: CROSS_BRANCH_DEPENDENCY: <what you need and from which issue/branch></result>
```

Do not output anything else after the tag.
