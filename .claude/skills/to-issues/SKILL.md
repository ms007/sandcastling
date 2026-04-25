---
name: to-issues
description: Break a plan, spec, or PRD into independently-grabbable GitHub issues using tracer-bullet vertical slices. Use when the user wants to convert a plan into issues, create implementation tickets, or break work into pieces the Sandcastle orchestrator can pick up.
---

# Create Issues

Break a plan into independently-grabbable GitHub issues using vertical
slices (tracer bullets). Each slice is small, end-to-end, and can be
implemented and reviewed in isolation.

Relationships between issues (parent/child, blocked-by) are set via
GitHub's native **Issue Relationships** API — never via body text. This
keeps relationships queryable, visible in the GitHub UI, and free of drift.

## Process

### 1. Gather context

Work from whatever is already in conversation context. If the user passes a
GitHub issue number or URL as an argument, fetch it with
`gh issue view <number> --comments`.

### 2. Explore the codebase (optional)

If not already explored, read enough of the codebase to understand the
current state.

### 3. Draft vertical slices

Break the plan into **tracer bullet** issues. Each issue is a thin
vertical slice that cuts through ALL integration layers end-to-end — NOT a
horizontal slice of one layer.

Slices are either **HITL** or **sandcastle**:
- **HITL** slices require human interaction (architectural decision,
  design review, schema migration that needs eyes).
- **sandcastle** slices can be implemented and merged by the Sandcastle
  orchestrator (`pnpm sandcastle:run`) without human interaction.

Prefer `sandcastle` over `hitl` where possible.

**Quality check on slice cuts** (not a `blockedBy` edge): if two slices
will touch the same ≥2 files, they are probably the same slice or were cut
along the wrong axis. Re-cut rather than setting `blockedBy` — the
orchestrator's merger handles real git conflicts, but file-level overlap
is usually a horizontal slice masquerading as two tracer bullets.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests).
- A completed slice is demoable or verifiable on its own.
- Prefer many thin slices over few thick ones.
</vertical-slice-rules>

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Type**: HITL / sandcastle
- **Blocked by**: which other slices (if any) must complete first
- **User stories covered**: which user stories this addresses (if the
  source material has them)

When proposing `Blocked by` edges, treat slice B as blocked by slice A if
any of:
- B needs code, schema, or infrastructure that A introduces.
- B depends on an API or type shape that A establishes.
- B and A would touch the same module in incompatible ways (pure file
  overlap → re-cut instead, see §3).

Ask the user:
- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?
- Are the correct slices marked HITL vs sandcastle?

Iterate until the user approves the breakdown.

### 5. Resolve the Project v2 + verify labels (once per run)

Resolve the linked Project v2 with a `Status` single-select field
(`Todo` / `In Progress` / `In Review` / `Done`) and cache `PROJECT_ID`,
`STATUS_FIELD_ID`, and `TODO_OPTION_ID` for the rest of the run.

#### 5a. Discover the project linked to the current repo

```bash
gh api graphql -f query='
  query($owner:String!, $repo:String!) {
    repository(owner:$owner, name:$repo) {
      projectsV2(first: 10) {
        nodes {
          id
          number
          title
          fields(first: 30) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name }
              }
            }
          }
        }
      }
    }
  }' \
  -f owner="$(gh repo view --json owner --jq .owner.login)" \
  -f repo="$(gh repo view --json name --jq .name)"
```

#### 5b. Validate the schema

Among the returned projects, select the **single** one whose `Status`
single-select field has all four options: `Todo`, `In Progress`,
`In Review`, `Done`.

- **Zero matches** → abort with: *"No Project v2 with a Status field
  (Todo / In Progress / In Review / Done) is linked to this repo — link
  one before using `to-issues`."*
- **More than one match** → abort with: *"Multiple Project v2 with the
  expected Status schema are linked to this repo. Auto-discovery requires
  exactly one — please disambiguate manually."*

Do not silently create issues outside the project — that drift is exactly
what this step exists to prevent.

#### 5c. Cache for the rest of the run

Capture and reuse:
- `PROJECT_ID` (e.g. `PVT_kwH...`)
- `STATUS_FIELD_ID` (e.g. `PVTSSF_lAH...`)
- `TODO_OPTION_ID`

Option IDs are not stable across schema edits — always resolve at runtime,
never hardcode.

Also ensure the two routing labels exist (idempotent):

```bash
gh label create sandcastle --color "9cdcff" --description "Automatable slice for Sandcastle orchestrator" 2>/dev/null || true
gh label create hitl       --color "E4E669" --description "Requires human interaction before merging" 2>/dev/null || true
```

Every sandcastle slice MUST have the `sandcastle` label applied at
creation. Every HITL slice MUST have the `hitl` label. The orchestrator
routes purely on these labels; a missing label means the slice is skipped.

### 6. Create the GitHub issues

For each approved slice in **dependency order** (blockers first, so blocker
node IDs are known when creating dependents):

#### 6a. Create the issue

Apply the routing label based on the slice type:

```bash
# sandcastle slice (orchestrator can implement it):
gh issue create --title "<slice title>" --label "sandcastle" --body "<body from template below>"

# HITL slice (requires human review / decision):
gh issue create --title "<slice title>" --label "hitl" --body "<body from template below>"
```

Additional type labels (`bug`, `chore`, etc.) may be added alongside, but
the routing label is mandatory.

Capture the returned issue URL and extract the number.

#### 6b. Fetch the node ID

```bash
gh issue view <number> --json id --jq .id
```

Node IDs (not issue numbers) are required by GraphQL relationship
mutations.

#### 6c. Add to Project v2 with Status = Todo

```bash
# Add as project item
gh api graphql -f query='
  mutation($project:ID!, $content:ID!) {
    addProjectV2ItemById(input:{ projectId:$project, contentId:$content }) {
      item { id }
    }
  }' -f project="$PROJECT_ID" -f content="<SLICE_NODE_ID>"
```

Capture the returned item ID, then set Status = Todo:

```bash
gh api graphql -f query='
  mutation($project:ID!, $item:ID!, $field:ID!, $option:String!) {
    updateProjectV2ItemFieldValue(input:{
      projectId:$project, itemId:$item, fieldId:$field,
      value:{ singleSelectOptionId:$option }
    }) {
      projectV2Item { id }
    }
  }' \
  -f project="$PROJECT_ID" -f item="<ITEM_ID>" \
  -f field="$STATUS_FIELD_ID" -f option="$TODO_OPTION_ID"
```

This ensures every new issue appears on the board in the `Todo` column
immediately, instead of waiting for the orchestrator's selector to add it
lazily.

#### 6d. Link to parent PRD (if the source is a GitHub issue)

If the source material is a PRD issue, link this slice as a sub-issue of
that PRD:

```bash
gh api graphql \
  -f query='mutation($p:ID!, $c:ID!) { addSubIssue(input:{ issueId:$p, subIssueId:$c }) { issue { number } } }' \
  -f p="<PRD_NODE_ID>" -f c="<SLICE_NODE_ID>"
```

The PRD's node ID should be fetched once at the start of the run and
cached for all subsequent slices.

#### 6e. Mark blockers (if any)

For each blocker slice the user identified in step 4:

```bash
gh api graphql \
  -f query='mutation($i:ID!, $b:ID!) { addBlockedBy(input:{ issueId:$i, blockingIssueId:$b }) { issue { number } } }' \
  -f i="<THIS_SLICE_NODE_ID>" -f b="<BLOCKER_NODE_ID>"
```

Repeat for each blocker.

## Issue body template

```
## What to build
A concise description of this vertical slice. Describe the end-to-end
behavior, not layer-by-layer implementation.

## Acceptance criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3
```

## Rules

- Do **not** include `## Parent` or `## Blocked by` sections in the body —
  those relationships live in native GitHub fields now.
- Do **not** close or modify the parent issue.
- Do **not** create issues outside the resolved Project v2. If resolution
  fails, abort.
- Every slice gets exactly one routing label (`sandcastle` or `hitl`).
