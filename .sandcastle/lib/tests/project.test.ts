import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import {
  type IssueNode,
  type ProjectContext,
  type ProjectItemNode,
  type ProjectV2Node,
  type RelatedIssueNode,
  type RelatedIssueWithSubsNode,
  __testing,
  buildProjectContext,
  buildRelatedIssuesReport,
  selectNextEligibleIssue,
} from "../project.ts"

const { isStatusField, hasStatusSchema, mapStatusOptions, readStatus, toRelatedIssue } = __testing

const STATUS_OPTIONS = [
  { id: "opt-todo", name: "Todo" },
  { id: "opt-in-progress", name: "In Progress" },
  { id: "opt-in-review", name: "In Review" },
  { id: "opt-done", name: "Done" },
]

const STATUS_FIELD = {
  id: "field-status",
  name: "Status",
  options: STATUS_OPTIONS,
}

const PROJECT_NODE: ProjectV2Node = {
  id: "proj-1",
  number: 4,
  title: "Sandcastle",
  fields: { nodes: [STATUS_FIELD] },
}

const CTX: ProjectContext = {
  owner: "octocat",
  repo: "demo",
  projectId: "proj-1",
  projectNumber: 4,
  projectTitle: "Sandcastle",
  statusFieldId: "field-status",
  statusOptions: {
    Todo: "opt-todo",
    "In Progress": "opt-in-progress",
    "In Review": "opt-in-review",
    Done: "opt-done",
  },
}

/** Construct a single GraphQL-shaped issue node with an optional project item. */
const makeIssue = (opts: {
  number: number
  title?: string
  body?: string
  blockedBy?: number
  sandcastleLabel?: boolean
  /** Pass `null` for "not on the project board". */
  statusOptionId: string | null
  itemId?: string
}): RelatedIssueNode => {
  const projectItems: { nodes: ProjectItemNode[] } =
    opts.statusOptionId === null
      ? { nodes: [] }
      : {
          nodes: [
            {
              id: opts.itemId ?? `item-${opts.number}`,
              project: { id: "proj-1" },
              fieldValues: {
                nodes: [
                  {
                    optionId: opts.statusOptionId,
                    field: { id: "field-status", name: "Status" },
                  },
                ],
              },
            },
          ],
        }
  return {
    id: `issue-${opts.number}`,
    number: opts.number,
    title: opts.title ?? `feat: ${opts.number}`,
    body: opts.body ?? "body text",
    labels: {
      nodes: opts.sandcastleLabel === false ? [] : [{ name: "sandcastle" }],
    },
    issueDependenciesSummary: { blockedBy: opts.blockedBy ?? 0 },
    projectItems,
  }
}

describe("isStatusField", () => {
  it("recognises an object named 'Status' with options[]", () => {
    assert.equal(isStatusField(STATUS_FIELD), true)
  })

  it("rejects an object with the wrong name", () => {
    assert.equal(isStatusField({ id: "x", name: "Other", options: [] }), false)
  })

  it("rejects an object lacking the options array", () => {
    assert.equal(
      isStatusField({ id: "x", name: "Status" } as unknown as {
        id: string
        name: string
        options: { id: string; name: string }[]
      }),
      false,
    )
  })

  it("rejects an empty object (degenerate case from GraphQL union)", () => {
    assert.equal(isStatusField({}), false)
  })
})

describe("hasStatusSchema", () => {
  it("accepts a project that has every required status option", () => {
    assert.equal(hasStatusSchema(PROJECT_NODE), true)
  })

  it("rejects a project missing one of Todo/In Progress/In Review/Done", () => {
    const incomplete = STATUS_OPTIONS.slice(0, 3)
    assert.equal(
      hasStatusSchema({
        id: "p",
        number: 1,
        title: "x",
        fields: { nodes: [{ id: "f", name: "Status", options: incomplete }] },
      }),
      false,
    )
  })

  it("rejects a project with no Status field at all", () => {
    assert.equal(
      hasStatusSchema({
        id: "p",
        number: 1,
        title: "x",
        fields: { nodes: [] },
      }),
      false,
    )
  })

  it("ignores extra status options beyond the four canonical ones", () => {
    const extra = [...STATUS_OPTIONS, { id: "opt-extra", name: "Backlog" }]
    assert.equal(
      hasStatusSchema({
        id: "p",
        number: 1,
        title: "x",
        fields: { nodes: [{ id: "f", name: "Status", options: extra }] },
      }),
      true,
    )
  })
})

describe("mapStatusOptions", () => {
  it("indexes options by their canonical name", () => {
    assert.deepEqual(mapStatusOptions(STATUS_OPTIONS), {
      Todo: "opt-todo",
      "In Progress": "opt-in-progress",
      "In Review": "opt-in-review",
      Done: "opt-done",
    })
  })

  it("throws if a required name is missing", () => {
    const partial = STATUS_OPTIONS.slice(0, 3)
    assert.throws(() => mapStatusOptions(partial), /missing Status option "Done"/)
  })

  it("ignores non-canonical options when all four required ones are present", () => {
    const withExtra = [...STATUS_OPTIONS, { id: "opt-extra", name: "Backlog" }]
    const map = mapStatusOptions(withExtra)
    assert.equal(map.Todo, "opt-todo")
    // Extra option is not surfaced in the result.
    assert.equal((map as Record<string, string>).Backlog, undefined)
  })
})

describe("buildProjectContext", () => {
  it("builds the expected context from a valid project list", () => {
    const ctx = buildProjectContext("octocat", "demo", [PROJECT_NODE])
    assert.equal(ctx.owner, "octocat")
    assert.equal(ctx.repo, "demo")
    assert.equal(ctx.projectId, "proj-1")
    assert.equal(ctx.projectNumber, 4)
    assert.equal(ctx.projectTitle, "Sandcastle")
    assert.equal(ctx.statusFieldId, "field-status")
    assert.equal(ctx.statusOptions.Todo, "opt-todo")
    assert.equal(ctx.statusOptions.Done, "opt-done")
  })

  it("throws when no project carries the required schema", () => {
    assert.throws(
      () => buildProjectContext("octocat", "demo", []),
      /No Project v2 with a Status field/,
    )
  })

  it("throws when more than one project carries the required schema", () => {
    const second: ProjectV2Node = {
      ...PROJECT_NODE,
      id: "proj-2",
      number: 5,
      title: "Other",
    }
    assert.throws(
      () => buildProjectContext("octocat", "demo", [PROJECT_NODE, second]),
      /Multiple Project v2 with a matching Status schema/,
    )
  })

  it("ignores projects that lack the Status schema", () => {
    const incomplete: ProjectV2Node = {
      id: "proj-x",
      number: 9,
      title: "Wrong",
      fields: { nodes: [{ id: "f", name: "Other", options: [] } as never] },
    }
    const ctx = buildProjectContext("o", "r", [incomplete, PROJECT_NODE])
    assert.equal(ctx.projectId, "proj-1")
  })

  it("includes both project titles in the multi-match error message", () => {
    const second: ProjectV2Node = {
      ...PROJECT_NODE,
      id: "proj-2",
      number: 5,
      title: "Other",
    }
    assert.throws(
      () => buildProjectContext("o", "r", [PROJECT_NODE, second]),
      /#4 "Sandcastle".*#5 "Other"/,
    )
  })
})

describe("readStatus", () => {
  it("returns the canonical status name when the option matches", () => {
    const item: ProjectItemNode = {
      id: "i",
      project: { id: "proj-1" },
      fieldValues: {
        nodes: [
          {
            optionId: "opt-todo",
            field: { id: "field-status", name: "Status" },
          },
        ],
      },
    }
    assert.equal(readStatus(item, CTX), "Todo")
  })

  it("returns null when the option does not match any canonical status", () => {
    const item: ProjectItemNode = {
      id: "i",
      project: { id: "proj-1" },
      fieldValues: {
        nodes: [
          {
            optionId: "opt-unknown",
            field: { id: "field-status", name: "Status" },
          },
        ],
      },
    }
    assert.equal(readStatus(item, CTX), null)
  })

  it("returns null when the project item has no status value", () => {
    const item: ProjectItemNode = {
      id: "i",
      project: { id: "proj-1" },
      fieldValues: { nodes: [] },
    }
    assert.equal(readStatus(item, CTX), null)
  })

  it("returns null when the field-value belongs to a different field id", () => {
    const item: ProjectItemNode = {
      id: "i",
      project: { id: "proj-1" },
      fieldValues: {
        nodes: [
          {
            optionId: "opt-todo",
            field: { id: "different-field", name: "Other" },
          },
        ],
      },
    }
    assert.equal(readStatus(item, CTX), null)
  })
})

describe("toRelatedIssue", () => {
  it("marks an issue eligible only when on-board, Todo, sandcastle-labelled, and not blocked", () => {
    const r = toRelatedIssue(makeIssue({ number: 7, statusOptionId: "opt-todo" }), CTX)
    assert.equal(r.eligible, true)
    assert.equal(r.status, "Todo")
    assert.equal(r.itemId, "item-7")
    assert.equal(r.blockedByCount, 0)
    assert.equal(r.hasSandcastleLabel, true)
  })

  it("flags an In Review issue as not eligible", () => {
    const r = toRelatedIssue(makeIssue({ number: 7, statusOptionId: "opt-in-review" }), CTX)
    assert.equal(r.eligible, false)
    assert.equal(r.status, "In Review")
  })

  it("flags a blocked Todo issue as not eligible", () => {
    const r = toRelatedIssue(
      makeIssue({ number: 7, statusOptionId: "opt-todo", blockedBy: 1 }),
      CTX,
    )
    assert.equal(r.eligible, false)
    assert.equal(r.blockedByCount, 1)
  })

  it("flags an unlabelled Todo issue as not eligible", () => {
    const r = toRelatedIssue(
      makeIssue({
        number: 7,
        statusOptionId: "opt-todo",
        sandcastleLabel: false,
      }),
      CTX,
    )
    assert.equal(r.eligible, false)
    assert.equal(r.hasSandcastleLabel, false)
  })

  it("returns itemId=null and status=null when the issue is not on the configured project", () => {
    const r = toRelatedIssue(makeIssue({ number: 7, statusOptionId: null }), CTX)
    assert.equal(r.itemId, null)
    assert.equal(r.status, null)
    assert.equal(r.eligible, false)
  })

  it("preserves number and title from the source node", () => {
    const r = toRelatedIssue(
      makeIssue({
        number: 99,
        title: "feat: thing",
        statusOptionId: "opt-done",
      }),
      CTX,
    )
    assert.equal(r.number, 99)
    assert.equal(r.title, "feat: thing")
    assert.equal(r.status, "Done")
  })
})

describe("selectNextEligibleIssue", () => {
  it("returns the first issue that is on the project, in Todo, and unblocked", () => {
    const issues: IssueNode[] = [
      makeIssue({ number: 1, statusOptionId: "opt-todo", blockedBy: 1 }),
      makeIssue({ number: 2, statusOptionId: "opt-in-progress" }),
      makeIssue({ number: 3, statusOptionId: "opt-todo" }),
      makeIssue({ number: 4, statusOptionId: "opt-todo" }),
    ]
    const result = selectNextEligibleIssue(CTX, issues)
    assert.equal(result?.number, 3)
    assert.equal(result?.itemId, "item-3")
  })

  it("returns null when no candidate qualifies", () => {
    const issues: IssueNode[] = [
      makeIssue({ number: 1, statusOptionId: "opt-in-progress" }),
      makeIssue({ number: 2, statusOptionId: "opt-todo", blockedBy: 1 }),
    ]
    assert.equal(selectNextEligibleIssue(CTX, issues), null)
  })

  it("skips issues that are not on the configured project", () => {
    const issues: IssueNode[] = [
      makeIssue({ number: 1, statusOptionId: null }),
      makeIssue({ number: 2, statusOptionId: "opt-todo" }),
    ]
    assert.equal(selectNextEligibleIssue(CTX, issues)?.number, 2)
  })

  it("returns null for an empty list", () => {
    assert.equal(selectNextEligibleIssue(CTX, []), null)
  })

  it("populates EligibleIssue fields from the source node", () => {
    const r = selectNextEligibleIssue(CTX, [
      makeIssue({
        number: 7,
        title: "feat: x",
        body: "B",
        statusOptionId: "opt-todo",
      }),
    ])
    assert.deepEqual(r, {
      number: 7,
      title: "feat: x",
      body: "B",
      nodeId: "issue-7",
      itemId: "item-7",
    })
  })

  it("respects input order — first match wins, not lowest number", () => {
    const issues: IssueNode[] = [
      makeIssue({ number: 9, statusOptionId: "opt-todo" }),
      makeIssue({ number: 3, statusOptionId: "opt-todo" }),
    ]
    assert.equal(selectNextEligibleIssue(CTX, issues)?.number, 9)
  })
})

describe("buildRelatedIssuesReport", () => {
  it("populates seed/parent/siblings/children from the GraphQL response", () => {
    const seed: RelatedIssueWithSubsNode = {
      ...makeIssue({ number: 2, statusOptionId: "opt-todo" }),
      subIssues: { nodes: [] },
      parent: {
        ...makeIssue({
          number: 1,
          title: "PRD",
          body: "prd body",
          statusOptionId: "opt-in-progress",
        }),
        subIssues: {
          nodes: [
            makeIssue({ number: 2, title: "self", statusOptionId: "opt-todo" }),
            makeIssue({
              number: 3,
              title: "sibling",
              statusOptionId: "opt-todo",
            }),
          ],
        },
      },
    }
    const report = buildRelatedIssuesReport(CTX, 2, seed)
    assert.equal(report.seed.number, 2)
    assert.equal(report.parent?.number, 1)
    assert.equal(report.parent?.body, "prd body")
    assert.equal(report.siblings.length, 1)
    assert.equal(report.siblings[0]?.number, 3)
    assert.deepEqual(report.children, [])
  })

  it("returns parent=null and siblings=[] when the seed has no parent", () => {
    const seed: RelatedIssueWithSubsNode = {
      ...makeIssue({ number: 1, statusOptionId: "opt-todo" }),
      subIssues: {
        nodes: [makeIssue({ number: 2, title: "child", statusOptionId: "opt-todo" })],
      },
      parent: null,
    }
    const report = buildRelatedIssuesReport(CTX, 1, seed)
    assert.equal(report.parent, null)
    assert.deepEqual(report.siblings, [])
    assert.equal(report.children.length, 1)
    assert.equal(report.children[0]?.number, 2)
  })

  it("filters the seed itself out of siblings (parent.subIssues includes the seed)", () => {
    const seed: RelatedIssueWithSubsNode = {
      ...makeIssue({ number: 5, statusOptionId: "opt-todo" }),
      subIssues: { nodes: [] },
      parent: {
        ...makeIssue({ number: 1, statusOptionId: "opt-todo" }),
        subIssues: {
          nodes: [
            makeIssue({ number: 5, statusOptionId: "opt-todo" }),
            makeIssue({ number: 6, statusOptionId: "opt-todo" }),
          ],
        },
      },
    }
    const report = buildRelatedIssuesReport(CTX, 5, seed)
    const numbers = report.siblings.map((s) => s.number)
    assert.deepEqual(numbers, [6])
  })

  it("annotates seed.body so the planner can read the issue text", () => {
    const seed: RelatedIssueWithSubsNode = {
      ...makeIssue({
        number: 7,
        body: "seed body here",
        statusOptionId: "opt-todo",
      }),
      subIssues: { nodes: [] },
      parent: null,
    }
    const report = buildRelatedIssuesReport(CTX, 7, seed)
    assert.equal(report.seed.body, "seed body here")
  })

  it("returns empty children when subIssues is omitted (PRD with no decomposition)", () => {
    const seed: RelatedIssueWithSubsNode = {
      ...makeIssue({ number: 1, statusOptionId: "opt-todo" }),
      parent: null,
    }
    const report = buildRelatedIssuesReport(CTX, 1, seed)
    assert.deepEqual(report.children, [])
  })
})
