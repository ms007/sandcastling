# TASK

Plan a Sandcastle bundle starting from issue **#{{ISSUE_NUMBER}}**.

A *bundle* is the set of issues that will be implemented together on **one
branch**, in **one sandbox**, by **one implementer agent**. You decide which
related issues belong with the seed.

## 1. Read the seed and its relations

<seed-issue>

!`gh issue view {{ISSUE_NUMBER}} --comments`

</seed-issue>

Pull the project-board snapshot for the seed and its siblings yourself — it
tells you which siblings are eligible to bundle:

```bash
bun .sandcastle/lib/project-cli.ts related {{ISSUE_NUMBER}}
```

The output is JSON with `seed`, optional `parent`, `siblings[]`, and
`children[]`. Each sibling and child carries an `eligible` flag and an
`itemId` you will need in step 4.

If the seed has a parent (PRD), pull it for wider context:

```bash
gh issue view <parent-number>
```

For each `eligible: true` sibling in the `related` output that you are
seriously considering, pull its body and comments before deciding:

```bash
gh issue view <number> --comments
```

## 1a. Treat a PRD seed as a pointer to its first eligible child

A PRD (the umbrella issue) is itself almost never `eligible` — it has no
`sandcastle` label and is not on the board. Its child implementation
slices are. If **both** of the following hold:

- The seed is `eligible: false`.
- `children[]` contains at least one entry with `eligible: true`.

then treat the **first** eligible child (lowest issue number) as the
*effective seed* for steps 2–5. The remaining `eligible: true` children
play the role of siblings for the bundling decision in step 2.

Use the data already in `children[]` — it carries `number`, `title`,
`itemId`, `eligible`, etc. **Do not** call `related` a second time, and do
not pivot recursively (even if the chosen child itself had children, you
stop here).

For step 3, the original PRD seed is the parent of every chosen bundle
item, so the branch name is `sandcastle/prd-<original-seed-number>`.

If the seed is `eligible: false` and `children[]` has no eligible entry,
do **not** pivot — fall through to the failure rule at the bottom of this
file.

## 2. Decide the bundle

Include the seed plus zero or more siblings. Bundles of size 1 are normal
and good — do not pad.

Include a sibling **only if all** of these hold:

- It is `eligible: true` in the `related` output (on the project board, has
  the `sandcastle` label, Status=Todo, no unresolved blockers).
- It is *tightly* coupled to the seed: same module, shared types, the test
  for one would naturally live in the same file as the implementation of
  the other, or one would create merge conflicts with the other if
  implemented separately.

Exclude a sibling if **any** of these hold:

- It would be substantial enough to deserve its own run.
- It touches a different area of the codebase.
- It depends on the seed having merged before it can be implemented (let it
  follow as a separate, later run).

When in doubt, exclude. Smaller bundles are safer.

## 3. Choose the branch name

Apply this rule deterministically — do not paraphrase:

- If **all** chosen bundle items share the same `parent` issue (the same PRD)
  AND the parent's number is known: `sandcastle/prd-<parent-number>`.
- Otherwise: `sandcastle/issue-<seed-number>`.

## 4. Claim every chosen item

For **each** issue in your final bundle, run exactly:

```bash
bun .sandcastle/lib/project-cli.ts move-status <itemId> "In Progress"
```

Use the exact `itemId` from the `related` output. The command is idempotent
— re-running on an already-moved item is safe.

Do **not** emit the plan tag until every item has been claimed.

## 5. Emit the plan

Output the plan as the **last** thing you produce, on its own block, with
exactly this shape:

```
<plan>
{
  "bundle": [
    {"number": <n>, "title": "<title>", "itemId": "<itemId>"}
  ],
  "branch": "<branch-name>"
}
</plan>
```

`bundle` MUST contain at least the seed and MAY contain more. JSON only —
double quotes everywhere, no trailing commas.

# RULES

- Read-only mode for code: do **not** edit files, do **not** create commits,
  do **not** switch branches. Your only writes are the GitHub Project v2
  status mutations in step 4.
- Code, comments, and any commentary in **English**.
- If the seed itself is not eligible (e.g. blocked, missing label, not on
  the board) **and** the auto-pivot in step 1a does not apply (no eligible
  children), do not emit `<plan>` — explain in prose what's wrong and exit.
  The orchestrator will treat the absence of `<plan>` as a planner failure
  and skip the rest of the run.
