import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import { buildChownScript } from "../chown.ts"

describe("buildChownScript", () => {
  it("emits depth-0 home chown and overlay-fs recursion when no volumes are present", () => {
    const script = buildChownScript({ uid: 1000, gid: 1000, volumePaths: [] })

    assert.match(
      script,
      /find \/home\/agent -mindepth 1 -maxdepth 1 ! -name workspace -exec chown -R 1000:1000 \{\} \+/,
    )
    assert.match(script, /chown 1000:1000 \/home\/agent/)
    assert.ok(!script.includes("if ["), "no volume guards expected")
  })

  it("appends a guarded recursive chown for each volume mount", () => {
    const script = buildChownScript({
      uid: 1000,
      gid: 1000,
      volumePaths: ["/home/agent/workspace/node_modules", "/home/agent/workspace/.pnpm-store"],
    })

    assert.match(script, /chown 1000:1000 \/home\/agent\/workspace\/node_modules/)
    assert.match(script, /chown 1000:1000 \/home\/agent\/workspace\/\.pnpm-store/)
    // First-mount detection: stat-uid mismatch OR a non-uid file under the volume.
    assert.match(
      script,
      /\[ "\$\(stat -c %u \/home\/agent\/workspace\/node_modules\/\.\)" != "1000" \]/,
    )
    assert.match(script, /find \/home\/agent\/workspace\/node_modules -maxdepth 2 ! -uid 1000/)
    // Both volumes get their own conditional recursive chown.
    const guardCount = (script.match(/if \[ "\$\(stat -c %u/g) ?? []).length
    assert.equal(guardCount, 2)
  })

  it("threads non-default uid/gid through every segment", () => {
    const script = buildChownScript({
      uid: 501,
      gid: 20,
      volumePaths: ["/foo"],
    })
    assert.match(script, /chown -R 501:20/)
    assert.match(script, /chown 501:20 \/home\/agent/)
    assert.match(script, /chown 501:20 \/foo/)
    assert.match(script, /\[ "\$\(stat -c %u \/foo\/\.\)" != "501" \]/)
  })

  it("joins the overlay-find and home-chown segments with ' && ' so a failure short-circuits", () => {
    const script = buildChownScript({ uid: 1, gid: 1, volumePaths: [] })
    const segments = script.split(" && ")
    assert.equal(segments.length, 2)
    assert.match(segments[0] ?? "", /^find \/home\/agent /)
    assert.equal(segments[1], "chown 1:1 /home/agent")
  })

  it("places the home depth-0 chown after the overlay-fs find", () => {
    const script = buildChownScript({ uid: 1, gid: 1, volumePaths: [] })
    const findIndex = script.indexOf("find /home/agent")
    const chownHomeIndex = script.indexOf("chown 1:1 /home/agent")
    assert.ok(findIndex >= 0 && chownHomeIndex > findIndex)
  })
})
