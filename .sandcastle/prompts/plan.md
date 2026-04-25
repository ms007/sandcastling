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

The output is JSON with `seed`, optional `parent`, `siblings[]`, and
`children[]`. Each entry carries an `eligible` flag and the `itemId` you
will need in step 3.

If the seed has a parent (PRD) and you need wider context, pull it too:

```bash
gh issue view <parent-number>
```

## 2. Decide the issue list

Apply this rule deterministically — do not paraphrase:

- **Seed is `eligible: true`** (a normal implementation issue):
  the issue list is exactly `[seed]`. Do **not** opportunistically add
  siblings, even if they look related. The user picked this issue for a
  reason; honour the scope.

- **Seed is `eligible: false` AND `children[]` contains at least one entry
  with `eligible: true`** (a PRD seed):
  the issue list is **every** child with `eligible: true`, in ascending
  issue-number order. Do not pivot recursively — even if a chosen child
  has its own children, you stop here.

- **Seed is `eligible: false` AND no eligible children**:
  do not emit `<plan>`. Explain in prose what's wrong and exit. The
  orchestrator treats the absence of `<plan>` as a planner failure.

For each issue you are about to include, pull its body and comments before
locking it in:

```bash
gh issue view <number> --comments
```

If any chosen issue is clearly blocked (open dependencies, missing
acceptance criteria, contradicting comments), drop it from the list and
note the reason in prose. Better to skip a borderline issue than to ship
broken code.

## 3. Claim every chosen issue

For **each** issue in the final list, run exactly:

```bash
bun .sandcastle/lib/project-cli.ts move-status <itemId> "In Progress"
```

Use the exact `itemId` from the `related` output. The command is
idempotent. Do **not** emit the plan tag until every item has been
claimed.

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
  Project v2 status mutations in step 3.
- Code, comments, and any commentary in **English**.
- If you cannot produce a valid issue list, do not emit `<plan>` — explain
  in prose and exit.
