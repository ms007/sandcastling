/**
 * Project-specific sandbox configuration: builds the chown-narrow Docker
 * provider with our local image, named volumes for the JS workspace, and
 * the install hook that warms `node_modules/` after sandbox boot.
 */
import type { SandboxHooks } from "@ai-hero/sandcastle"
import { docker, workspaceVolumes } from "./lib/index.ts"

export const sandbox = docker({
  imageName: "sandcastle:latest",
  volumes: workspaceVolumes({
    nodeModules: "sandcastle-node-modules",
    pnpmStore: "sandcastle-pnpm-store",
  }),
})

export const sandboxHooks: SandboxHooks = {
  sandbox: {
    onSandboxReady: [{ command: "pnpm install --prefer-offline" }],
  },
}
