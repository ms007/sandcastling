import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import { workspaceVolumes } from "../volumes.ts"

describe("workspaceVolumes", () => {
  it("returns volume mounts for node_modules and .pnpm-store at WORKSPACE_PATH", () => {
    const mounts = workspaceVolumes({
      nodeModules: "my-nm",
      pnpmStore: "my-store",
    })
    assert.deepEqual(mounts, [
      {
        volumeName: "my-nm",
        sandboxPath: "/home/agent/workspace/node_modules",
      },
      {
        volumeName: "my-store",
        sandboxPath: "/home/agent/workspace/.pnpm-store",
      },
    ])
  })

  it("preserves the order: node_modules first, pnpm-store second", () => {
    const mounts = workspaceVolumes({ nodeModules: "a", pnpmStore: "b" })
    assert.equal(mounts[0]?.volumeName, "a")
    assert.equal(mounts[1]?.volumeName, "b")
  })

  it("returns a fresh array on every call (callers may mutate)", () => {
    const a = workspaceVolumes({ nodeModules: "x", pnpmStore: "y" })
    const b = workspaceVolumes({ nodeModules: "x", pnpmStore: "y" })
    assert.notEqual(a, b)
    assert.deepEqual(a, b)
  })
})

// Note: `removeVolumes` shells out to the docker binary. It is exercised end-to-end
// by `pnpm clean`; a hermetic unit test would require either
// dependency-injection of the spawn function or a temporary $PATH shim, both of
// which add more harness than they buy.
