/**
 * GitHub Projects v2 integration for the Sandcastle orchestrator.
 *
 * - `resolveProject` auto-discovers the single Project v2 linked to the host
 *   repo and caches its IDs (project, Status field, Status option IDs). It
 *   throws fast if no project is linked or the Status schema does not match
 *   the Todo / In Progress / In Review / Done convention used by the
 *   `to-issues` skill.
 * - `pickNextEligibleIssue` picks the oldest open `sandcastle`-labeled issue
 *   whose project Status is `Todo` and whose blockers are all resolved.
 * - `getRelatedIssues` resolves a seed issue plus its parent (PRD) and the
 *   parent's other sub-issues, annotated with `eligible`, dependency lists,
 *   and per-branch git state so the planner can decide which to schedule and
 *   recover stale runs.
 * - `moveStatus` updates a project item's Status to one of the four canonical
 *   names.
 *
 * All GraphQL is shelled out via `gh api graphql` so the orchestrator inherits
 * the user's existing `gh auth login` session — no PAT plumbing.
 */
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { type BranchInfo, issueBranchName, readBranchInfo } from "./git.ts"

const execFileP = promisify(execFile)

export const REQUIRED_STATUSES = ["Todo", "In Progress", "In Review", "Done"] as const

export type StatusName = (typeof REQUIRED_STATUSES)[number]

export interface ProjectContext {
  readonly owner: string
  readonly repo: string
  readonly projectId: string
  readonly projectNumber: number
  readonly projectTitle: string
  readonly statusFieldId: string
  readonly statusOptions: Readonly<Record<StatusName, string>>
}

export interface EligibleIssue {
  readonly number: number
  readonly title: string
  readonly body: string
  /** Issue node ID (for `addBlockedBy`-style mutations elsewhere). */
  readonly nodeId: string
  /** Project v2 item ID — needed for status mutations. */
  readonly itemId: string
}

/**
 * Snapshot of a single issue's project-board + dependency + branch state.
 * The planner consumes this — `eligible` is the simple gate, the rest gives
 * it enough information to reason about transitive unblocking and stale work.
 */
export interface RelatedIssue {
  readonly number: number
  readonly title: string
  /** `null` when the issue is not on the configured Project v2. */
  readonly itemId: string | null
  /** `null` when not on the board, or when its Status is outside our schema. */
  readonly status: StatusName | null
  /**
   * `true` iff: on the board, Status=Todo, has `sandcastle` label, and
   * `blockedBy.length === 0`. Branch state does NOT factor in — recovery
   * is the planner's call, not an automatic gate.
   */
  readonly eligible: boolean
  /** Issue numbers (in the same repo) that block this one. Empty when unblocked. */
  readonly blockedBy: readonly number[]
  /** Issue numbers (in the same repo) that are blocked by this one. */
  readonly blocking: readonly number[]
  readonly hasSandcastleLabel: boolean
  /** State of the conventional `sandcastle/issue-<n>` branch. */
  readonly branch: BranchInfo
}

/** Variant carrying the issue body (used for seed and parent only). */
export interface RelatedIssueWithBody extends RelatedIssue {
  readonly body: string
}

export interface RelatedIssuesReport {
  readonly seed: RelatedIssueWithBody
  readonly parent: RelatedIssueWithBody | null
  /** Sub-issues of `parent` other than the seed. Empty when no parent. */
  readonly siblings: readonly RelatedIssue[]
  /**
   * Sub-issues of the seed itself. Non-empty when the seed is a PRD whose
   * implementation slices live as child issues. The planner uses this to
   * auto-pivot from a PRD seed to its oldest eligible child.
   */
  readonly children: readonly RelatedIssue[]
}

/**
 * Looks up the conventional sandcastle branch state for an issue. Injected
 * into {@link getRelatedIssues} / {@link buildRelatedIssuesReport} so unit
 * tests can pass a stub instead of shelling out to git.
 */
export type BranchLookup = (issueNumber: number) => BranchInfo

// ---------- GraphQL response types (exported for test fixtures) ------------

export interface ProjectV2Node {
  readonly id: string
  readonly number: number
  readonly title: string
  readonly fields: {
    readonly nodes: readonly (StatusField | Record<string, never>)[]
  }
}

export interface StatusField {
  readonly id: string
  readonly name: string
  readonly options: readonly { readonly id: string; readonly name: string }[]
}

export interface IssueNode {
  readonly number: number
  readonly title: string
  readonly body: string
  readonly id: string
  readonly issueDependenciesSummary: { readonly blockedBy: number }
  readonly projectItems: { readonly nodes: readonly ProjectItemNode[] }
}

export interface RelatedIssueNode {
  readonly id: string
  readonly number: number
  readonly title: string
  readonly body: string
  readonly labels: { readonly nodes: readonly { readonly name: string }[] }
  readonly blockedBy: {
    readonly nodes: readonly { readonly number: number }[]
  }
  readonly blocking: { readonly nodes: readonly { readonly number: number }[] }
  readonly projectItems: { readonly nodes: readonly ProjectItemNode[] }
}

export interface RelatedIssueWithSubsNode extends RelatedIssueNode {
  readonly subIssues?: { readonly nodes: readonly RelatedIssueNode[] } | null
  readonly parent?: RelatedParentNode | null
}

export interface RelatedParentNode extends RelatedIssueNode {
  readonly subIssues: { readonly nodes: readonly RelatedIssueNode[] }
}

export interface ProjectItemNode {
  readonly id: string
  readonly project: { readonly id: string }
  readonly fieldValues: {
    readonly nodes: readonly (StatusFieldValue | Record<string, never> | null)[]
  }
}

export interface StatusFieldValue {
  readonly optionId: string
  readonly field: { readonly id: string; readonly name: string } | null
}

// ---------- Public API -----------------------------------------------------

/**
 * Asks `gh` for the current repository's `owner/name`. Used by every entry
 * point that needs to scope project/issue queries to the host repo.
 */
export async function detectRepo(): Promise<{ owner: string; repo: string }> {
  const { stdout } = await execFileP("gh", ["repo", "view", "--json", "owner,name"])
  const parsed = JSON.parse(stdout) as {
    owner: { login: string }
    name: string
  }
  return { owner: parsed.owner.login, repo: parsed.name }
}

export async function resolveProject(owner: string, repo: string): Promise<ProjectContext> {
  const data = await graphql<ResolveProjectResponse>(
    `
      query ($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
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
                    options {
                      id
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    `,
    { owner, repo },
  )

  const projects = data.repository?.projectsV2?.nodes ?? []
  return buildProjectContext(owner, repo, projects)
}

/**
 * Pure derivation of {@link ProjectContext} from a list of GraphQL project
 * nodes. Throws when zero or more than one project carries the canonical
 * Status schema — auto-discovery requires exactly one.
 */
export function buildProjectContext(
  owner: string,
  repo: string,
  projects: readonly ProjectV2Node[],
): ProjectContext {
  const candidates = projects.filter((p) => hasStatusSchema(p))

  if (candidates.length === 0) {
    throw new Error(
      `No Project v2 with a Status field (${REQUIRED_STATUSES.join(" / ")}) linked to ${owner}/${repo}. Link one before running the orchestrator.`,
    )
  }
  if (candidates.length > 1) {
    const titles = candidates.map((p) => `#${p.number} "${p.title}"`).join(", ")
    throw new Error(
      `Multiple Project v2 with a matching Status schema linked to ${owner}/${repo}: ${titles}. Auto-discovery requires exactly one.`,
    )
  }

  const project = candidates[0]
  if (!project) {
    // Defensive — `candidates.length === 0` is handled above; this guards
    // strict `noUncheckedIndexedAccess`.
    throw new Error("internal: candidate project disappeared after filter")
  }
  const statusField = project.fields.nodes.find((f): f is StatusField => isStatusField(f))
  if (!statusField) {
    // Defensive — `hasStatusSchema` already proved this exists.
    throw new Error("internal: status field disappeared after filter")
  }

  const statusOptions = mapStatusOptions(statusField.options)

  return {
    owner,
    repo,
    projectId: project.id,
    projectNumber: project.number,
    projectTitle: project.title,
    statusFieldId: statusField.id,
    statusOptions,
  }
}

export async function pickNextEligibleIssue(ctx: ProjectContext): Promise<EligibleIssue | null> {
  const data = await graphql<PickIssuesResponse>(
    `
      query ($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          issues(
            first: 50
            states: OPEN
            labels: ["sandcastle"]
            orderBy: { field: CREATED_AT, direction: ASC }
          ) {
            nodes {
              number
              title
              body
              id
              issueDependenciesSummary {
                blockedBy
              }
              projectItems(first: 10) {
                nodes {
                  id
                  project {
                    id
                  }
                  fieldValues(first: 30) {
                    nodes {
                      ... on ProjectV2ItemFieldSingleSelectValue {
                        optionId
                        field {
                          ... on ProjectV2SingleSelectField {
                            id
                            name
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `,
    { owner: ctx.owner, repo: ctx.repo },
  )

  const issues = data.repository?.issues?.nodes ?? []
  return selectNextEligibleIssue(ctx, issues)
}

/**
 * Pure picker: the first issue (input is in CREATED_AT-asc order) that is on
 * the configured project, in `Todo`, and unblocked. Returns `null` when no
 * candidate qualifies.
 */
export function selectNextEligibleIssue(
  ctx: ProjectContext,
  issues: readonly IssueNode[],
): EligibleIssue | null {
  for (const issue of issues) {
    if (issue.issueDependenciesSummary.blockedBy > 0) continue

    const projectItem = issue.projectItems.nodes.find((item) => item.project.id === ctx.projectId)
    if (!projectItem) continue
    if (readStatus(projectItem, ctx) !== "Todo") continue

    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      nodeId: issue.id,
      itemId: projectItem.id,
    }
  }

  return null
}

/**
 * Default branch lookup — reads the host's git for the conventional
 * `sandcastle/issue-<n>` branch relative to the given base SHA. The base
 * SHA defaults to current HEAD, which matches the planner's view since it
 * runs against the same worktree HEAD captured by main.ts.
 */
export const defaultBranchLookup =
  (baseSha: string): BranchLookup =>
  (issueNumber: number) =>
    readBranchInfo(baseSha, issueBranchName(issueNumber))

export async function getRelatedIssues(
  ctx: ProjectContext,
  seedNumber: number,
  branchLookup: BranchLookup,
): Promise<RelatedIssuesReport> {
  const data = await graphql<RelatedIssuesResponse>(
    `
      query ($owner: String!, $repo: String!, $issueNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $issueNumber) {
            ${ISSUE_FULL_FIELDS}
            ${SUB_ISSUES_FRAGMENT}
            parent {
              ${ISSUE_FULL_FIELDS}
              ${SUB_ISSUES_FRAGMENT}
            }
          }
        }
      }
    `,
    { owner: ctx.owner, repo: ctx.repo, issueNumber: seedNumber },
  )

  const issue = data.repository?.issue
  if (!issue) {
    throw new Error(`Issue #${seedNumber} not found in ${ctx.owner}/${ctx.repo}.`)
  }

  return buildRelatedIssuesReport(ctx, seedNumber, issue, branchLookup)
}

/**
 * Pure transform: shape a {@link RelatedIssueWithSubsNode} (raw GraphQL
 * payload) into the structured report the planner consumes. Filters the seed
 * out of `parent.subIssues` so the seed never appears in `siblings`.
 */
export function buildRelatedIssuesReport(
  ctx: ProjectContext,
  seedNumber: number,
  issue: RelatedIssueWithSubsNode,
  branchLookup: BranchLookup,
): RelatedIssuesReport {
  const parent = issue.parent ?? null
  const siblings = (parent?.subIssues?.nodes ?? []).filter((s) => s.number !== seedNumber)
  const children = issue.subIssues?.nodes ?? []

  return {
    seed: toRelatedIssueWithBody(issue, ctx, branchLookup),
    parent: parent ? toRelatedIssueWithBody(parent, ctx, branchLookup) : null,
    siblings: siblings.map((s) => toRelatedIssue(s, ctx, branchLookup)),
    children: children.map((c) => toRelatedIssue(c, ctx, branchLookup)),
  }
}

/**
 * Removes every "blocked by #issueNumber" dependency. Called when
 * `issueNumber` lands in Done — its merge has shipped, so it is no longer
 * holding anything up. Issues that were also blocked by *other* unfinished
 * issues stay blocked (we only drop the edge to the freshly-Done one).
 *
 * Returns the issue numbers whose blocker was removed, in GraphQL order.
 * An empty array means there was nothing blocked by this issue.
 */
export async function unblockDependents(
  ctx: ProjectContext,
  issueNumber: number,
): Promise<readonly number[]> {
  const data = await graphql<UnblockDependentsResponse>(
    `
      query ($owner: String!, $repo: String!, $issueNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $issueNumber) {
            id
            blocking(first: 50) {
              nodes {
                id
                number
              }
            }
          }
        }
      }
    `,
    { owner: ctx.owner, repo: ctx.repo, issueNumber },
  )

  const issue = data.repository?.issue
  if (!issue) {
    throw new Error(`Issue #${issueNumber} not found in ${ctx.owner}/${ctx.repo}.`)
  }

  const dependents = issue.blocking.nodes
  for (const dep of dependents) {
    await graphql<unknown>(
      `
        mutation ($issueId: ID!, $blockingIssueId: ID!) {
          removeBlockedBy(
            input: { issueId: $issueId, blockingIssueId: $blockingIssueId }
          ) {
            issue {
              id
            }
          }
        }
      `,
      { issueId: dep.id, blockingIssueId: issue.id },
    )
  }

  return dependents.map((d) => d.number)
}

export async function moveStatus(
  ctx: ProjectContext,
  itemId: string,
  status: StatusName,
): Promise<void> {
  const optionId = ctx.statusOptions[status]
  await graphql<unknown>(
    `
      mutation ($project: ID!, $item: ID!, $field: ID!, $option: String!) {
        updateProjectV2ItemFieldValue(
          input: {
            projectId: $project
            itemId: $item
            fieldId: $field
            value: { singleSelectOptionId: $option }
          }
        ) {
          projectV2Item {
            id
          }
        }
      }
    `,
    {
      project: ctx.projectId,
      item: itemId,
      field: ctx.statusFieldId,
      option: optionId,
    },
  )
}

// ---------- Internals ------------------------------------------------------

interface ResolveProjectResponse {
  repository: {
    projectsV2: {
      nodes: ProjectV2Node[]
    } | null
  } | null
}

interface PickIssuesResponse {
  repository: {
    issues: {
      nodes: IssueNode[]
    } | null
  } | null
}

interface UnblockDependentsResponse {
  repository: {
    issue: {
      id: string
      blocking: {
        nodes: readonly { id: string; number: number }[]
      }
    } | null
  } | null
}

const RELATED_ISSUE_META_FIELDS = `
  id
  number
  title
  labels(first: 20) { nodes { name } }
  blockedBy(first: 50) { nodes { number } }
  blocking(first: 50) { nodes { number } }
  projectItems(first: 10) {
    nodes {
      id
      project { id }
      fieldValues(first: 30) {
        nodes {
          ... on ProjectV2ItemFieldSingleSelectValue {
            optionId
            field {
              ... on ProjectV2SingleSelectField {
                id
                name
              }
            }
          }
        }
      }
    }
  }
`

const ISSUE_FULL_FIELDS = `
  body
  ${RELATED_ISSUE_META_FIELDS}
`

const SUB_ISSUES_FRAGMENT = `
  subIssues(first: 50) {
    nodes {
      ${RELATED_ISSUE_META_FIELDS}
    }
  }
`

interface RelatedIssuesResponse {
  repository: {
    issue: RelatedIssueWithSubsNode | null
  } | null
}

function toRelatedIssue(
  node: RelatedIssueNode,
  ctx: ProjectContext,
  branchLookup: BranchLookup,
): RelatedIssue {
  const item = node.projectItems.nodes.find((n) => n.project.id === ctx.projectId)
  const status = item ? readStatus(item, ctx) : null
  const blockedBy = node.blockedBy.nodes.map((n) => n.number)
  const blocking = node.blocking.nodes.map((n) => n.number)
  const hasSandcastleLabel = node.labels.nodes.some((l) => l.name === "sandcastle")
  return {
    number: node.number,
    title: node.title,
    itemId: item?.id ?? null,
    status,
    eligible: item != null && status === "Todo" && hasSandcastleLabel && blockedBy.length === 0,
    blockedBy,
    blocking,
    hasSandcastleLabel,
    branch: branchLookup(node.number),
  }
}

function toRelatedIssueWithBody(
  node: RelatedIssueNode,
  ctx: ProjectContext,
  branchLookup: BranchLookup,
): RelatedIssueWithBody {
  return { ...toRelatedIssue(node, ctx, branchLookup), body: node.body }
}

function readStatus(item: ProjectItemNode, ctx: ProjectContext): StatusName | null {
  const value = item.fieldValues.nodes.find(
    (v): v is StatusFieldValue => v != null && "field" in v && v.field?.id === ctx.statusFieldId,
  )
  if (!value) return null
  for (const name of REQUIRED_STATUSES) {
    if (ctx.statusOptions[name] === value.optionId) return name
  }
  return null
}

function isStatusField(f: StatusField | Record<string, never>): f is StatusField {
  return "name" in f && "options" in f && f.name === "Status" && Array.isArray(f.options)
}

function hasStatusSchema(project: ProjectV2Node): boolean {
  const statusField = project.fields.nodes.find(isStatusField)
  if (!statusField) return false
  const optionNames = new Set(statusField.options.map((o) => o.name))
  return REQUIRED_STATUSES.every((name) => optionNames.has(name))
}

function mapStatusOptions(
  options: readonly { id: string; name: string }[],
): Record<StatusName, string> {
  const byName = new Map(options.map((o) => [o.name, o.id]))
  const out: Partial<Record<StatusName, string>> = {}
  for (const name of REQUIRED_STATUSES) {
    const id = byName.get(name)
    if (!id) {
      throw new Error(`internal: missing Status option "${name}" after schema check`)
    }
    out[name] = id
  }
  return out as Record<StatusName, string>
}

async function graphql<T>(query: string, variables: Record<string, string | number>): Promise<T> {
  const args = ["api", "graphql", "-f", `query=${query}`]
  for (const [k, v] of Object.entries(variables)) {
    // `-F` sends typed (number/bool); `-f` sends string. GraphQL `Int!`
    // variables fail with `-f` because gh quotes the value.
    args.push(typeof v === "number" ? "-F" : "-f", `${k}=${v}`)
  }
  const { stdout } = await execFileP("gh", args, {
    maxBuffer: 10 * 1024 * 1024,
  })
  const parsed = JSON.parse(stdout) as { data?: T; errors?: unknown }
  if (parsed.errors) {
    throw new Error(`gh api graphql errors: ${JSON.stringify(parsed.errors)}`)
  }
  if (!parsed.data) {
    throw new Error("gh api graphql returned no data")
  }
  return parsed.data
}

/** Test seam — internal helpers exposed for unit tests. Not a public API. */
export const __testing = {
  isStatusField,
  hasStatusSchema,
  mapStatusOptions,
  readStatus,
  toRelatedIssue,
  toRelatedIssueWithBody,
}
