/**
 * Project-specific sandbox configuration: builds the chown-narrow Docker
 * provider with our local image, named volumes for the JS workspace, and
 * the install hook that warms `node_modules/` after sandbox boot.
 */
import type { SandboxHooks } from "@ai-hero/sandcastle"
import type { SandboxFactory } from "./lib/config.ts"
import { docker, workspaceVolumes } from "./sandboxes/docker/index.ts"

export const sandbox: SandboxFactory = (runId) =>
  docker({
    imageName: "sandcastle:latest",
    namePrefix: runId,
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
