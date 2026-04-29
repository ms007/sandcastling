import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import type { AgentProvider, AgentStreamEvent, SandboxProvider } from "@ai-hero/sandcastle"
import { WORKFLOW_TOKENS, __testing as configTesting, resolveConfig } from "../config.ts"
import { __testing } from "../stages.ts"

const { issuePromptArgs, buildMergerRunOptions, stageLogging } = __testing
const { validateStage, resolveContainerStage } = configTesting

const fakeAgent = { name: "fake-agent" } as unknown as AgentProvider
const fakeSandbox = { name: "fake-sandbox" } as unknown as SandboxProvider
const fakeSandboxFactory = () => fakeSandbox

describe("issuePromptArgs", () => {
  it("returns the prompt-template fields with an empty PRIOR_ATTEMPTS by default", () => {
    const args = issuePromptArgs({
      number: 42,
      title: "feat: foo",
      itemId: "PVTI_xyz",
      branch: "sandcastle/issue-42",
    })
    assert.deepEqual(args, {
      ISSUE_NUMBER: "42",
      ISSUE_TITLE: "feat: foo",
      BRANCH: "sandcastle/issue-42",
      PRIOR_ATTEMPTS: "",
    })
  })

  it("renders ISSUE_NUMBER as a string even though the source is a number", () => {
    const args = issuePromptArgs({
      number: 1,
      title: "t",
      itemId: "i",
      branch: "b",
    })
    assert.equal(typeof args.ISSUE_NUMBER, "string")
    assert.equal(args.ISSUE_NUMBER, "1")
  })

  it("threads the PRIOR_ATTEMPTS block through to the prompt args verbatim", () => {
    const block = "<prior-attempts>\nattempt 2\n</prior-attempts>"
    const args = issuePromptArgs({ number: 1, title: "t", itemId: "i", branch: "b" }, block)
    assert.equal(args.PRIOR_ATTEMPTS, block)
  })
})

describe("buildMergerRunOptions", () => {
  const baseRef = {
    sha: "abcdef1234567890abcdef1234567890abcdef12",
    refName: "main",
  }
  const mergeBranch = "sandcastle/tmp-merge/42-2026-04-26T12-00-00-000Z-deadbeef0123"
  const issues = [
    { number: 1, title: "feat: alpha", itemId: "PVTI_a", branch: "sandcastle/issue-1" },
    { number: 2, title: "fix: beta", itemId: "PVTI_b", branch: "sandcastle/issue-2" },
  ]

  const mergeConfig = {
    agent: fakeAgent,
    promptFile: "./.sandcastle/prompts/merge.md",
    promptArgs: {},
    sandbox: fakeSandbox,
  }

  const runId = "01JTEST_RUNID"

  it("uses a named-branch strategy forked from baseRef.sha", () => {
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config: mergeConfig,
      logDir: undefined,
      runId,
    })
    assert.deepEqual(opts.branchStrategy, {
      type: "branch",
      branch: mergeBranch,
      baseBranch: baseRef.sha,
    })
  })

  it("populates BASE_LABEL from the formatted baseRef", () => {
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config: mergeConfig,
      logDir: undefined,
      runId,
    })
    assert.equal(opts.promptArgs?.BASE_LABEL, "main (abcdef1)")
  })

  it("includes BRANCH_LIST and ISSUE_LIST in promptArgs", () => {
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config: mergeConfig,
      logDir: undefined,
      runId,
    })
    assert.equal(opts.promptArgs?.BRANCH_LIST, "- sandcastle/issue-1\n- sandcastle/issue-2")
    assert.equal(opts.promptArgs?.ISSUE_LIST, "- #1: feat: alpha\n- #2: fix: beta")
  })

  it("defaults PRIOR_ATTEMPTS to empty string", () => {
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config: mergeConfig,
      logDir: undefined,
      runId,
    })
    assert.equal(opts.promptArgs?.PRIOR_ATTEMPTS, "")
  })

  it("threads priorAttempts through", () => {
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      priorAttempts: "attempt #2 failed",
      config: mergeConfig,
      logDir: undefined,
      runId,
    })
    assert.equal(opts.promptArgs?.PRIOR_ATTEMPTS, "attempt #2 failed")
  })

  it("handles empty issues array (produces empty BRANCH_LIST and ISSUE_LIST)", () => {
    const opts = buildMergerRunOptions({
      issues: [],
      baseRef,
      mergeBranch,
      config: mergeConfig,
      logDir: undefined,
      runId,
    })
    assert.equal(opts.promptArgs?.BRANCH_LIST, "")
    assert.equal(opts.promptArgs?.ISSUE_LIST, "")
  })

  it("existing issue-list and branch-list assertions still pass with single issue", () => {
    const opts = buildMergerRunOptions({
      issues: [{ number: 99, title: "chore: cleanup", itemId: "X", branch: "sandcastle/issue-99" }],
      baseRef,
      mergeBranch,
      config: mergeConfig,
      logDir: undefined,
      runId,
    })
    assert.equal(opts.promptArgs?.BRANCH_LIST, "- sandcastle/issue-99")
    assert.equal(opts.promptArgs?.ISSUE_LIST, "- #99: chore: cleanup")
  })

  it("passes config.agent and config.sandbox into RunOptions", () => {
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config: mergeConfig,
      logDir: undefined,
      runId,
    })
    assert.equal(opts.agent, fakeAgent)
    assert.equal(opts.sandbox, fakeSandbox)
  })

  it("passes config.promptFile into RunOptions", () => {
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config: mergeConfig,
      logDir: undefined,
      runId,
    })
    assert.equal(opts.promptFile, "./.sandcastle/prompts/merge.md")
  })

  it("passes idleTimeoutSeconds and maxIterations when set", () => {
    const config = { ...mergeConfig, idleTimeoutSeconds: 300, maxIterations: 3 }
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config,
      logDir: undefined,
      runId,
    })
    assert.equal(opts.idleTimeoutSeconds, 300)
    assert.equal(opts.maxIterations, 3)
  })

  it("omits idleTimeoutSeconds and maxIterations when not set", () => {
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config: mergeConfig,
      logDir: undefined,
      runId,
    })
    assert.equal("idleTimeoutSeconds" in opts, false)
    assert.equal("maxIterations" in opts, false)
  })

  it("preserves user promptArgs alongside workflow-owned tokens", () => {
    const config = { ...mergeConfig, promptArgs: { CUSTOM: "value" } }
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config,
      logDir: undefined,
      runId,
    })
    assert.equal(opts.promptArgs?.CUSTOM, "value")
    assert.equal(opts.promptArgs?.BRANCH_LIST, "- sandcastle/issue-1\n- sandcastle/issue-2")
  })

  it("omits hooks from RunOptions when config.hooks is absent", () => {
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config: mergeConfig,
      logDir: undefined,
      runId,
    })
    assert.equal("hooks" in opts, false)
  })

  it("passes hooks when config.hooks is present", () => {
    const hooks = { sandbox: { onSandboxReady: [{ command: "echo hi" }] } } as const
    const config = { ...mergeConfig, hooks }
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config,
      logDir: undefined,
      runId,
    })
    assert.deepEqual(opts.hooks, hooks)
  })

  it("places stage log under <logDir>/<runId>/ when logDir is set", () => {
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config: mergeConfig,
      logDir: "/tmp/logs",
      runId,
    })
    assert.deepEqual(opts.logging, {
      type: "file",
      path: "/tmp/logs/01JTEST_RUNID/merger.log",
    })
  })

  it("falls back to stdout when logDir is undefined regardless of runId", () => {
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config: mergeConfig,
      logDir: undefined,
      runId,
    })
    assert.deepEqual(opts.logging, { type: "stdout" })
  })

  it("merger filename contains no timestamps or run ids when waveIndex is absent", () => {
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config: mergeConfig,
      logDir: "/logs",
      runId,
    })
    const logging = opts.logging as { type: "file"; path: string }
    assert.equal(logging.type, "file")
    assert.ok(
      logging.path.endsWith("/merger.log"),
      `expected path to end with /merger.log, got: ${logging.path}`,
    )
  })

  it("includes wave index in merger filename when waveIndex is provided", () => {
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config: mergeConfig,
      logDir: "/logs",
      runId,
      waveIndex: 0,
    })
    assert.deepEqual(opts.logging, {
      type: "file",
      path: "/logs/01JTEST_RUNID/merger-wave-0.log",
    })
  })

  it("different wave indices produce different log paths", () => {
    const wave0 = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config: mergeConfig,
      logDir: "/logs",
      runId,
      waveIndex: 0,
    })
    const wave1 = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config: mergeConfig,
      logDir: "/logs",
      runId,
      waveIndex: 1,
    })
    const log0 = wave0.logging as { type: "file"; path: string }
    const log1 = wave1.logging as { type: "file"; path: string }
    assert.notEqual(log0.path, log1.path)
    assert.equal(log0.path, "/logs/01JTEST_RUNID/merger-wave-0.log")
    assert.equal(log1.path, "/logs/01JTEST_RUNID/merger-wave-1.log")
  })
})

describe("resolveConfig", () => {
  const defaults = { tickCap: 50, attemptCap: 3 }
  const testRunId = "01JCONFIG_RUNID"

  const baseOptions = {
    seedIssue: 42,
    sandbox: fakeSandboxFactory,
    stages: {
      implement: { agent: fakeAgent, promptFile: "implement.md" },
      review: { agent: fakeAgent, promptFile: "review.md" },
      merge: { agent: fakeAgent, promptFile: "merge.md" },
    },
  }

  it("resolves a minimal valid config with defaults", () => {
    const resolved = resolveConfig(baseOptions, defaults, testRunId)
    assert.equal(resolved.seedIssue, 42)
    assert.equal(resolved.runId, testRunId)
    assert.equal(resolved.tickCap, 50)
    assert.equal(resolved.attemptCap, 3)
    assert.equal(resolved.logDir, undefined)
  })

  it("throws when seedIssue is not a positive integer", () => {
    assert.throws(
      () => resolveConfig({ ...baseOptions, seedIssue: 0 }, defaults, testRunId),
      /seedIssue/,
    )
    assert.throws(
      () => resolveConfig({ ...baseOptions, seedIssue: -1 }, defaults, testRunId),
      /seedIssue/,
    )
    assert.throws(
      () => resolveConfig({ ...baseOptions, seedIssue: 1.5 }, defaults, testRunId),
      /seedIssue/,
    )
    assert.throws(
      () =>
        resolveConfig(
          { ...baseOptions, seedIssue: Number.NaN } as typeof baseOptions,
          defaults,
          testRunId,
        ),
      /seedIssue/,
    )
    assert.throws(
      () =>
        resolveConfig(
          { ...baseOptions, seedIssue: Number.POSITIVE_INFINITY } as typeof baseOptions,
          defaults,
          testRunId,
        ),
      /seedIssue/,
    )
  })

  it("uses orchestrator-level sandbox as fallback for container stages", () => {
    const globalSandbox = { name: "global" } as unknown as SandboxProvider
    const resolved = resolveConfig(
      { ...baseOptions, sandbox: () => globalSandbox },
      defaults,
      testRunId,
    )
    assert.equal(resolved.stages.implement.sandbox, globalSandbox)
    assert.equal(resolved.stages.merge.sandbox, globalSandbox)
  })

  it("per-stage sandbox overrides the global sandbox", () => {
    const stageSandbox = { name: "stage" } as unknown as SandboxProvider
    const options = {
      ...baseOptions,
      stages: {
        ...baseOptions.stages,
        implement: { ...baseOptions.stages.implement, sandbox: stageSandbox },
      },
    }
    const resolved = resolveConfig(options, defaults, testRunId)
    assert.equal(resolved.stages.implement.sandbox, stageSandbox)
    assert.equal(resolved.stages.merge.sandbox, fakeSandbox)
  })

  it("per-stage hooks override the global hooks", () => {
    const globalHooks = { sandbox: { onSandboxReady: [{ command: "global" }] } } as const
    const stageHooks = { sandbox: { onSandboxReady: [{ command: "stage" }] } } as const
    const options = {
      ...baseOptions,
      hooks: globalHooks,
      stages: {
        ...baseOptions.stages,
        merge: { ...baseOptions.stages.merge, hooks: stageHooks },
      },
    }
    const resolved = resolveConfig(options, defaults, testRunId)
    assert.deepEqual(resolved.stages.implement.hooks, globalHooks)
    assert.deepEqual(resolved.stages.merge.hooks, stageHooks)
  })

  it("propagates user-provided tickCap and attemptCap", () => {
    const resolved = resolveConfig(
      { ...baseOptions, tickCap: 10, attemptCap: 5 },
      defaults,
      testRunId,
    )
    assert.equal(resolved.tickCap, 10)
    assert.equal(resolved.attemptCap, 5)
  })

  it("propagates user-provided logDir", () => {
    const resolved = resolveConfig({ ...baseOptions, logDir: "/tmp/logs" }, defaults, testRunId)
    assert.equal(resolved.logDir, "/tmp/logs")
  })

  it("calls the sandbox factory with the provided runId", () => {
    const received: string[] = []
    const spy = (runId: string) => {
      received.push(runId)
      return fakeSandbox
    }
    resolveConfig({ ...baseOptions, sandbox: spy }, defaults, "MY_RUN_ID")
    assert.deepEqual(received, ["MY_RUN_ID"])
  })
})

describe("validateStage", () => {
  it("rejects promptArgs that collide with implement workflow tokens", () => {
    for (const token of WORKFLOW_TOKENS.implement) {
      assert.throws(
        () =>
          validateStage(
            "implement",
            { agent: fakeAgent, promptFile: "f.md", promptArgs: { [token]: "x" } },
            WORKFLOW_TOKENS.implement,
          ),
        new RegExp(`"${token}" collides`),
      )
    }
  })

  it("rejects promptArgs that collide with merge workflow tokens", () => {
    for (const token of WORKFLOW_TOKENS.merge) {
      assert.throws(
        () =>
          validateStage(
            "merge",
            { agent: fakeAgent, promptFile: "f.md", promptArgs: { [token]: "x" } },
            WORKFLOW_TOKENS.merge,
          ),
        new RegExp(`"${token}" collides`),
      )
    }
  })

  it("allows non-colliding user promptArgs", () => {
    const result = validateStage(
      "implement",
      { agent: fakeAgent, promptFile: "f.md", promptArgs: { CUSTOM: "val" } },
      WORKFLOW_TOKENS.implement,
    )
    assert.deepEqual(result.promptArgs, { CUSTOM: "val" })
  })

  it("defaults promptArgs to empty object", () => {
    const result = validateStage(
      "review",
      { agent: fakeAgent, promptFile: "f.md" },
      WORKFLOW_TOKENS.review,
    )
    assert.deepEqual(result.promptArgs, {})
  })

  it("preserves idleTimeoutSeconds and maxIterations when set", () => {
    const result = validateStage(
      "implement",
      { agent: fakeAgent, promptFile: "f.md", idleTimeoutSeconds: 120, maxIterations: 5 },
      WORKFLOW_TOKENS.implement,
    )
    assert.equal(result.idleTimeoutSeconds, 120)
    assert.equal(result.maxIterations, 5)
  })

  it("omits idleTimeoutSeconds and maxIterations when not set", () => {
    const result = validateStage(
      "implement",
      { agent: fakeAgent, promptFile: "f.md" },
      WORKFLOW_TOKENS.implement,
    )
    assert.equal("idleTimeoutSeconds" in result, false)
    assert.equal("maxIterations" in result, false)
  })

  it("throws when agent is missing", () => {
    assert.throws(
      () =>
        validateStage(
          "implement",
          { agent: undefined as unknown as AgentProvider, promptFile: "f.md" },
          WORKFLOW_TOKENS.implement,
        ),
      /stages\.implement\.agent is required/,
    )
  })

  it("throws when promptFile is empty", () => {
    assert.throws(
      () => validateStage("review", { agent: fakeAgent, promptFile: "" }, WORKFLOW_TOKENS.review),
      /stages\.review\.promptFile is required/,
    )
  })
})

describe("resolveContainerStage", () => {
  it("falls back to global sandbox when per-stage sandbox is absent", () => {
    const result = resolveContainerStage(
      "implement",
      { agent: fakeAgent, promptFile: "f.md" },
      fakeSandbox,
      undefined,
      WORKFLOW_TOKENS.implement,
    )
    assert.equal(result.sandbox, fakeSandbox)
  })

  it("per-stage sandbox wins over global", () => {
    const stageSandbox = { name: "stage" } as unknown as SandboxProvider
    const result = resolveContainerStage(
      "implement",
      { agent: fakeAgent, promptFile: "f.md", sandbox: stageSandbox },
      fakeSandbox,
      undefined,
      WORKFLOW_TOKENS.implement,
    )
    assert.equal(result.sandbox, stageSandbox)
  })

  it("per-stage hooks win over global hooks", () => {
    const globalHooks = { sandbox: { onSandboxReady: [{ command: "g" }] } } as const
    const stageHooks = { sandbox: { onSandboxReady: [{ command: "s" }] } } as const
    const result = resolveContainerStage(
      "merge",
      { agent: fakeAgent, promptFile: "f.md", hooks: stageHooks },
      fakeSandbox,
      globalHooks,
      WORKFLOW_TOKENS.merge,
    )
    assert.deepEqual(result.hooks, stageHooks)
  })

  it("omits hooks when neither per-stage nor global is provided", () => {
    const result = resolveContainerStage(
      "implement",
      { agent: fakeAgent, promptFile: "f.md" },
      fakeSandbox,
      undefined,
      WORKFLOW_TOKENS.implement,
    )
    assert.equal("hooks" in result, false)
  })
})

describe("stageLogging — agent-stream callback plumbing", () => {
  it("attaches onAgentStreamEvent to file logging when callback is provided", () => {
    const cb = () => {}
    const logging = stageLogging("/tmp/logs", "RUN_1", "test-file", cb)
    assert.equal(logging.type, "file")
    assert.equal((logging as { onAgentStreamEvent?: unknown }).onAgentStreamEvent, cb)
  })

  it("omits onAgentStreamEvent from file logging when callback is undefined", () => {
    const logging = stageLogging("/tmp/logs", "RUN_1", "test-file")
    assert.equal(logging.type, "file")
    assert.equal("onAgentStreamEvent" in logging, false)
  })

  it("returns stdout logging without callback regardless", () => {
    const cb = () => {}
    const logging = stageLogging(undefined, "RUN_1", "test-file", cb)
    assert.equal(logging.type, "stdout")
    assert.equal("onAgentStreamEvent" in logging, false)
  })

  it("passes events through callback in order", () => {
    const received: AgentStreamEvent[] = []
    const cb = (event: AgentStreamEvent) => received.push(event)
    const logging = stageLogging("/tmp/logs", "RUN_1", "test-file", cb)

    const events: AgentStreamEvent[] = [
      { type: "text", message: "Hello", iteration: 1, timestamp: new Date("2026-01-01") },
      {
        type: "toolCall",
        name: "Read",
        formattedArgs: "file.ts",
        iteration: 1,
        timestamp: new Date("2026-01-01"),
      },
      { type: "text", message: "Done", iteration: 2, timestamp: new Date("2026-01-01") },
    ]

    const fire = (logging as { onAgentStreamEvent: (e: AgentStreamEvent) => void })
      .onAgentStreamEvent
    for (const event of events) fire(event)

    assert.equal(received.length, 3)
    assert.equal(received[0]?.type, "text")
    assert.equal(received[0]?.message, "Hello")
    assert.equal(received[1]?.type, "toolCall")
    assert.equal(received[1]?.name, "Read")
    assert.equal(received[2]?.type, "text")
    assert.equal(received[2]?.message, "Done")
  })
})

describe("buildMergerRunOptions — agent-stream callback", () => {
  const baseRef = { sha: "abcdef1234567890abcdef1234567890abcdef12", refName: "main" }
  const mergeBranch = "sandcastle/tmp-merge/42"
  const issues = [{ number: 1, title: "alpha", itemId: "A", branch: "sandcastle/issue-1" }]
  const mergeConfig = {
    agent: fakeAgent,
    promptFile: ".sandcastle/prompts/merge.md",
    promptArgs: {},
    sandbox: fakeSandbox,
  }
  const runId = "01JTEST"

  it("attaches onAgentStreamEvent when callback is provided", () => {
    const cb = () => {}
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config: mergeConfig,
      logDir: "/tmp/logs",
      runId,
      onAgentStreamEvent: cb,
    })
    const logging = opts.logging as { type: "file"; onAgentStreamEvent?: unknown }
    assert.equal(logging.type, "file")
    assert.equal(logging.onAgentStreamEvent, cb)
  })

  it("omits onAgentStreamEvent when callback is not provided", () => {
    const opts = buildMergerRunOptions({
      issues,
      baseRef,
      mergeBranch,
      config: mergeConfig,
      logDir: "/tmp/logs",
      runId,
    })
    assert.equal("onAgentStreamEvent" in (opts.logging ?? {}), false)
  })
})
