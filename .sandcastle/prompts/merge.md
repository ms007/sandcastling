# TASK

Merge the following issue branches into the current branch, one at
a time, in the order listed:

{{BRANCH_LIST}}

Each branch corresponds to one of these issues:

{{ISSUE_LIST}}

You are on a fresh worktree forked from {{BASE_LABEL}}. Merge each
listed branch into the current branch without switching branches. The
implementer + reviewer agents have already verified each branch in
isolation. Your job is to fold them together, resolve conflicts
intelligently, and confirm the result still passes `pnpm verify`.

# CONTEXT

{{PRIOR_ATTEMPTS}}

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

Do not merge branches in a different order than listed. If a branch is
genuinely impossible to merge, list it as failed in the result tag (see
DONE below) and continue with the next.

## 2. Final verification

After all branches are merged, run `pnpm verify` one last time. It must be
green.

# RULES

- Stay on the current branch. Do not switch, push, or open a PR.
- Code, comments, commit messages in **English**.
- The sandbox already ran `pnpm install --prefer-offline`. Do not
  reinstall.
- Do not touch `.sandcastle/` unless a merge conflict genuinely requires
  it.
- No secrets in the repo, the diff, or the logs.
- Do **not** close issues, move project status, or drop blocking edges.
  The orchestrator handles all bookkeeping after the merger run returns.

# DONE

When the merger run is finished, output exactly one result tag.

If every listed branch merged cleanly:

```
<result>ok merged=<branch-a>,<branch-b>,...</result>
```

If at least one branch failed to merge (the rest succeeded):

```
<result>failed merged=<branch-a> failedBranch=<branch-x> reason=<one-line reason></result>
```

Do not output anything else after the tag.
