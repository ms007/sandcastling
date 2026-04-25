# TASK

Plan the Sandcastle run starting from issue **#{{ISSUE_NUMBER}}**.

A *run* implements one or more eligible issues. Each issue gets its **own
branch** off HEAD and is implemented + reviewed in its own sandbox. A final
merger step folds everything back into HEAD. Your job here is to pick the
issues and assign branch names — nothing else.

## 1. Read the seed and its relations

<seed-issue>

!`gh issue view {{ISSUE_NUMBER}} --comments`

</seed-issue>

Pull the project-board snapshot for the seed:

```bash
bun .sandcastle/lib/project-cli.ts related {{ISSUE_NUMBER}}
```

The output is JSON shaped as `{ seed, parent, siblings[], children[] }`.
Each issue carries:

- `eligible` — `true` iff on the board, Status=Todo, has `sandcastle` label,
  and `blockedBy.length === 0`. The simple gate.
- `status` — `Todo | "In Progress" | "In Review" | Done | null`.
- `blockedBy: number[]` — issue numbers blocking this one (1-hop).
- `blocking: number[]` — issue numbers blocked by this one (1-hop).
- `branch` — state of the conventional `sandcastle/issue-<n>` branch:
  `{ name, exists, aheadOfBase, headSha, commits: [{sha, subject}] }`.
  `commits` is newest-first, capped at 20.
- `itemId` — needed for status mutations in step 3.

If the seed has a parent (PRD) and you need wider context, pull it too:

```bash
gh issue view <parent-number>
```

## 2. Decide the issue list

Apply these rules deterministically — do not paraphrase. Check them in order
and stop at the first that matches.

### Rule A — Seed is `eligible: true` (a normal implementation issue)

The issue list is exactly `[seed]`. Do **not** opportunistically add
siblings, even if they look related. The user picked this issue for a
reason; honour the scope.

### Rule B — Seed is `eligible: false` AND at least one child has `eligible: true` (a PRD seed)

The issue list is **every** child with `eligible: true`, in ascending
issue-number order. Do not pivot recursively — even if a chosen child has
its own children, you stop here.

### Rule C — Recovery: a child is stuck `In Review` with a non-empty branch

A previous run may have crashed mid-flight, leaving a child at `In Review`
with its branch already implemented but never merged. Detect it:

> Some child has `status === "In Review"` AND `branch.exists === true` AND
> `branch.aheadOfBase > 0`. (Optionally, that child also appears in other
> children's `blockedBy` — that's a strong signal it's the bottleneck.)

When this matches and Rule B did **not** match (no eligible siblings to do
in parallel), recover the stuck child:

1. Reset its status back to `In Progress` so the orchestrator can resume:
   ```bash
   bun .sandcastle/lib/project-cli.ts move-status <itemId> "In Progress"
   ```
2. Re-run `bun .sandcastle/lib/project-cli.ts related {{ISSUE_NUMBER}}` to
   get a fresh snapshot. The child is **still not eligible** (status is now
   "In Progress", not "Todo"), but include it in the issue list anyway —
   the implementer is idempotent and will pick up from existing commits.
3. Treat that child as the issue list (a single-entry list, ascending
   issue-number order if you somehow recovered more than one).

Do not enter Rule C if the child's branch does not exist or has no commits
ahead — that's not a recoverable state, that's a fresh failure.

### Rule D — Nothing usable

Seed is `eligible: false`, no children are eligible, and no child matches
the Rule C recovery shape. Do **not** emit `<plan>`. Explain in prose what
you saw (cite the relevant `status`, `blockedBy`, `branch.exists`,
`branch.aheadOfBase` values) and exit. The orchestrator treats the absence
of `<plan>` as a planner failure.

### Per-issue sanity check

For each issue you are about to include, pull its body and comments before
locking it in:

```bash
gh issue view <number> --comments
```

If a chosen issue is clearly broken (open dependencies the report doesn't
reflect, missing acceptance criteria, contradicting comments), drop it from
the list and note the reason in prose. Better to skip a borderline issue
than to ship broken code.

## 3. Claim every chosen issue

For **each** issue in the final list, run exactly:

```bash
bun .sandcastle/lib/project-cli.ts move-status <itemId> "In Progress"
```

Use the exact `itemId` from the `related` output. The command is
idempotent. Do **not** emit the plan tag until every item has been claimed.

## 4. Emit the plan

Output the plan as the **last** thing you produce, on its own block, with
exactly this shape:

```
<plan>
{
  "issues": [
    {
      "number": <n>,
      "title": "<title>",
      "itemId": "<itemId>",
      "branch": "sandcastle/issue-<n>"
    }
  ]
}
</plan>
```

`issues` MUST contain at least one entry. The branch name is always
`sandcastle/issue-<n>` — one branch per issue, no exceptions. JSON only,
double quotes everywhere, no trailing commas.

# RULES

- Read-only mode for code: do **not** edit files, do **not** create
  commits, do **not** switch branches. Your only writes are the GitHub
  Project v2 status mutations in step 3 (and Rule C's recovery
  `move-status`).
- Code, comments, and any commentary in **English**.
- If you cannot produce a valid issue list, do not emit `<plan>` — explain
  in prose and exit.
