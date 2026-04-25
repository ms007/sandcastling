# TASK

Merge the following issue branches into the current branch (HEAD), one at
a time, in the order listed:

{{BRANCH_LIST}}

Each branch corresponds to one of these issues:

{{ISSUE_LIST}}

You are on the host's HEAD. The implementer + reviewer agents have already
verified each branch in isolation. Your job is to fold them together,
resolve conflicts intelligently, and confirm the result still passes
`pnpm verify`.

# CONTEXT

<recent-commits>

!`git log -n 15 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

<branches>

!`git branch -a`

</branches>

# WORKFLOW

## 1. Merge each branch sequentially

For each branch in the list above, in order:

1. Run `git merge <branch> --no-ff --no-edit`.
2. If there are merge conflicts, read both sides carefully and resolve
   them so the intent of **both** issues is preserved. Do not delete code
   just to silence a conflict — understand it first.
3. After resolving conflicts (if any), stage them and complete the merge:
   `git commit --no-edit`.
4. Run `pnpm verify`. If it fails, fix the breakage in a follow-up commit
   on HEAD before moving to the next branch. Do not proceed with a red
   tree.

Do not merge branches in a different order than listed. Do not skip a
branch unless it is genuinely impossible to merge — in that case, leave a
comment on its issue explaining why and continue with the next. A skipped
branch's issue stays open and **must not** be closed in step 3.

## 2. Final verification

After all branches are merged, run `pnpm verify` one last time. It must be
green.

## 3. Close issues

For each issue that was successfully merged, close it:

```bash
gh issue close <number> --comment "Merged via Sandcastle run."
```

Move its project status to `Done`:

```bash
bun .sandcastle/lib/project-cli.ts move-status <itemId> "Done"
```

Then drop every "blocked by this issue" edge so dependent issues become
eligible on the next planner run:

```bash
bun .sandcastle/lib/project-cli.ts unblock-dependents <number>
```

The issue list at the top carries the `itemId` for each entry.

If every child issue of a parent PRD is now closed, close the PRD too with
the same close + status-move + unblock-dependents triple. Do not close a
PRD that still has open children.

# RULES

- Stay on the host's HEAD branch. Do not switch, push, or open a PR.
- Code, comments, commit messages in **English**.
- The sandbox already ran `pnpm install --prefer-offline`. Do not
  reinstall.
- Do not touch `.sandcastle/` unless a merge conflict genuinely requires
  it.
- No secrets in the repo, the diff, or the logs.

# DONE

Once every mergeable branch is merged + `pnpm verify` is green + the
relevant issues are closed, output exactly:

```
<promise>COMPLETE</promise>
```
