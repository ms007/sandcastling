import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import type { BindMountCreateOptions } from "@ai-hero/sandcastle"
import { __testing } from "../docker.ts"

const { buildContainerName, envFlags, bindMountFlags, volumeFlags, resolveWorktreePath } = __testing

const asCreateOptions = (
  worktreePath: string,
  mounts: { hostPath: string; sandboxPath: string; readonly: boolean }[],
): BindMountCreateOptions => ({ worktreePath, mounts }) as unknown as BindMountCreateOptions

describe("buildContainerName", () => {
  it("uses the namePrefix followed by an 8-char suffix when prefix is set", () => {
    const name = buildContainerName("01JTRZ5X0G")
    assert.match(name, /^01JTRZ5X0G-[0-9a-f]{8}$/)
  })

  it("falls back to sandcastle-<uuid> when no prefix is provided", () => {
    const name = buildContainerName(undefined)
    assert.match(name, /^sandcastle-[0-9a-f-]{36}$/)
  })

  it("produces unique names across calls with the same prefix", () => {
    const a = buildContainerName("run123")
    const b = buildContainerName("run123")
    assert.notEqual(a, b)
  })
})

describe("envFlags", () => {
  it("emits a -e KEY=VALUE pair for each entry", () => {
    assert.deepEqual(envFlags({ FOO: "bar", BAZ: "qux" }), ["-e", "FOO=bar", "-e", "BAZ=qux"])
  })

  it("returns an empty array for an empty record", () => {
    assert.deepEqual(envFlags({}), [])
  })

  it("preserves the value as-is, including spaces and equals signs", () => {
    assert.deepEqual(envFlags({ X: "a=b c" }), ["-e", "X=a=b c"])
  })

  it("preserves insertion order across many entries", () => {
    const flags = envFlags({ A: "1", B: "2", C: "3" })
    assert.deepEqual(flags, ["-e", "A=1", "-e", "B=2", "-e", "C=3"])
  })
})

describe("bindMountFlags", () => {
  it("emits a -v <host>:<sandbox> flag per mount", () => {
    const flags = bindMountFlags([
      { hostPath: "/host/a", sandboxPath: "/sandbox/a", readonly: false },
    ])
    assert.deepEqual(flags, ["-v", "/host/a:/sandbox/a"])
  })

  it("appends ':ro' for read-only mounts", () => {
    const flags = bindMountFlags([
      { hostPath: "/host/a", sandboxPath: "/sandbox/a", readonly: true },
    ])
    assert.deepEqual(flags, ["-v", "/host/a:/sandbox/a:ro"])
  })

  it("emits one -v pair per mount, in order", () => {
    const flags = bindMountFlags([
      { hostPath: "/h1", sandboxPath: "/s1", readonly: false },
      { hostPath: "/h2", sandboxPath: "/s2", readonly: true },
    ])
    assert.deepEqual(flags, ["-v", "/h1:/s1", "-v", "/h2:/s2:ro"])
  })

  it("returns an empty array for an empty mount list", () => {
    assert.deepEqual(bindMountFlags([]), [])
  })
})

describe("volumeFlags", () => {
  it("emits a -v <name>:<sandboxPath> flag per volume", () => {
    const flags = volumeFlags([
      { volumeName: "nm", sandboxPath: "/home/agent/workspace/node_modules" },
    ])
    assert.deepEqual(flags, ["-v", "nm:/home/agent/workspace/node_modules"])
  })

  it("emits a flag pair per volume in order", () => {
    const flags = volumeFlags([
      { volumeName: "a", sandboxPath: "/x" },
      { volumeName: "b", sandboxPath: "/y" },
    ])
    assert.deepEqual(flags, ["-v", "a:/x", "-v", "b:/y"])
  })

  it("returns an empty array for no volumes", () => {
    assert.deepEqual(volumeFlags([]), [])
  })
})

describe("resolveWorktreePath", () => {
  it("returns the sandboxPath of the mount whose hostPath matches the worktreePath", () => {
    const result = resolveWorktreePath(
      asCreateOptions("/host/repo", [
        { hostPath: "/elsewhere", sandboxPath: "/sandbox/x", readonly: false },
        {
          hostPath: "/host/repo",
          sandboxPath: "/home/agent/workspace",
          readonly: false,
        },
      ]),
    )
    assert.equal(result, "/home/agent/workspace")
  })

  it("falls back to WORKSPACE_PATH when no mount matches", () => {
    const result = resolveWorktreePath(
      asCreateOptions("/host/repo", [
        { hostPath: "/elsewhere", sandboxPath: "/sandbox/x", readonly: false },
      ]),
    )
    assert.equal(result, "/home/agent/workspace")
  })

  it("falls back to WORKSPACE_PATH when the mount list is empty", () => {
    const result = resolveWorktreePath(asCreateOptions("/host/repo", []))
    assert.equal(result, "/home/agent/workspace")
  })

  it("matches only on hostPath equality (no fuzzy/prefix matching)", () => {
    const result = resolveWorktreePath(
      asCreateOptions("/host/repo", [
        {
          hostPath: "/host/repo/sub",
          sandboxPath: "/sandbox/sub",
          readonly: false,
        },
      ]),
    )
    // The worktreePath is "/host/repo" but the only mount is "/host/repo/sub" —
    // no match, so we fall back to WORKSPACE_PATH.
    assert.equal(result, "/home/agent/workspace")
  })
})
