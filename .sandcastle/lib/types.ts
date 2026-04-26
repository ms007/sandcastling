/**
 * Shared, neutral leaf types — referenced by both the workflow planner
 * (`./manager/`) and the agent-runner adapter (`./stages.ts`). Anything that
 * needs a name here must NOT depend on either of those modules; otherwise
 * the dependency direction is wrong and the type belongs closer to its sole
 * consumer.
 */

/**
 * The minimum identity needed to act on an issue: number, title, the
 * Project v2 item id (or `null` when the issue is not on the board), and
 * the conventional `sandcastle/issue-<n>` branch name. Produced from
 * `RelatedIssue` (project.ts) by `toIssueRef` in the orchestrator;
 * consumed by every workflow action and by every agent runner in
 * `stages.ts`.
 */
export interface IssueRef {
  readonly number: number
  readonly title: string
  readonly itemId: string | null
  readonly branch: string
}
