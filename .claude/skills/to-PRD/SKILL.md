---
name: to-PRD
description: Turn the current conversation context into a PRD and submit it as a GitHub issue. Use when the user wants to capture the discussed work as a Product Requirements Document for later breakdown into implementation issues.
---

# Create PRD

Synthesize the current conversation context and codebase understanding into
a Product Requirements Document, then submit it as a GitHub issue. Do **not**
interview the user — work from what is already in context.

The PRD will be the parent of one or more implementation issues created
later by `to-issues`. Parent/child links use GitHub's native sub-issue
relationships, not body text.

## Process

### 1. Explore the repo (if not already done)

Read enough of the codebase to ground the PRD in the current state.

### 2. Sketch the major modules

Identify the modules you would need to build or modify. Actively look for
opportunities to extract **deep modules** — modules that encapsulate a lot
of functionality behind a simple, testable interface that rarely changes.
Prefer deep over shallow.

Check with the user that:
- The proposed modules match their expectations.
- Which modules they want tests written for.

### 3. Submit the PRD as a GitHub issue

Use the template below for the body:

```bash
gh issue create --title "PRD: <short feature name>" --body "$(cat <<'EOF'
## Problem Statement
The problem the user is facing, from the user's perspective.

## Solution
The solution to the problem, from the user's perspective.

## User Stories
A long, numbered list of user stories in the format:

1. As an <actor>, I want a <feature>, so that <benefit>

Example:
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better-informed decisions about my spending.

Cover all aspects of the feature.

## Implementation Decisions
Decisions made during the discussion. Include any of:
- Modules that will be built or modified
- Interfaces of those modules
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets — they age fast.

## Testing Decisions
Include:
- A description of what makes a good test (test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (similar test types in the codebase)

## Out of Scope
What is explicitly not part of this PRD.

## Further Notes
Anything else worth recording.
EOF
)"
```

The PRD will be identified as a parent later via native sub-issue
relationships set by `to-issues` — no `parent` label needed.

## Rules

- Do **not** add the PRD to the Project v2 yet — that happens automatically
  when `to-issues` creates child slices and links them. The PRD itself can
  remain off-board (it is metadata, not actionable work).
- Do **not** add the `sandcastle` or `hitl` label to the PRD. Those are
  routing labels for implementation slices only; a PRD is never picked up
  by the orchestrator.
- Do **not** include code snippets, file paths, or line numbers — they will
  drift.
- After submission, return the issue URL and number to the user.
