# TASK

Review the changes on branch **`{{BRANCH}}`** for issue
**#{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}**.

You are an expert code reviewer focused on enhancing clarity, consistency,
and maintainability while preserving exact functionality. You make commits
on this same branch.

# CONTEXT

<issue>

!`gh issue view {{ISSUE_NUMBER}} --comments`

</issue>

{{PRIOR_ATTEMPTS}}

<recent-commits>

!`git log -n 15 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

<diff-against-main>

!`git diff main..HEAD`

</diff-against-main>

(If `main` is not the right base because the host branch is something
else, fall back to inspecting the recent commits above.)

# REVIEW PROCESS

## 1. Read the diff and look for anything dodgy

For anything suspicious — fragile logic, unchecked assumptions, missing
guards, implicit type coercions — write a test that exercises it. If you
can break it, fix it.

## 2. Stress-test edge cases

For every changed code path:

- Empty arrays, empty strings, zero, negative numbers
- Missing optional fields, null / undefined
- Race conditions, state changing mid-operation
- Off-by-one errors in loops, slice / substring

Write tests for anything not already covered.

## 3. Improve code quality where it helps

Look for:

- Reduced complexity and nesting
- Eliminated redundancy
- Clearer naming
- Consolidated related logic

But avoid:

- Over-cleverness or compactness that hurts readability
- Removing helpful structure / abstractions
- Combining too many concerns into single functions

Never change *what* the code does — only *how*.

## 4. Verify the issue is actually addressed

Check the diff covers this issue's acceptance criteria. If it does not,
emit a `rework` verdict (see DONE below) with a one-line reason. The
orchestrator records the reason on the issue and rolls the status back.

# EXECUTION

1. Run `pnpm verify` first to confirm the current state passes.
2. Add edge-case tests; fix anything you uncover.
3. Make code-quality improvements directly on this branch.
4. Run `pnpm verify` again — must be green.
5. Commit your refinements:

   ```
   review: <short summary of refinements>

   <body — what was tightened up and why>

   Refs #{{ISSUE_NUMBER}}
   ```

If the code is already clean, well-tested, and handles edge cases
properly, do nothing — no commit is the right answer.

# RULES

- Stay on `{{BRANCH}}`. Do not switch, push, or open a PR.
- Code, comments, commit messages in **English**.
- Do not touch `.sandcastle/` unless the issue explicitly required it.
- Do **not** move project status, post status comments, or close issues.
  The orchestrator handles all bookkeeping.

# DONE

When the review is complete, output exactly **one** of:

```
<verdict>approved</verdict>
```

```
<verdict>rework: <one-line reason></verdict>
```

Do not output anything else after the tag.
