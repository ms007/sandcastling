/**
 * Named-volume types and host-side helpers.
 *
 * Volumes live on Docker Desktop's Linux-native overlay/ext4 filesystem and
 * persist independently of any container. Recursive operations there are
 * one to two orders of magnitude faster than over a macOS VirtioFS
 * bind-mount, which is why we use them for `node_modules/` and
 * package-manager stores.
 */

import { WORKSPACE_PATH, spawnDocker } from "./process.ts"

/** A single named docker volume mounted at a fixed path inside the sandbox. */
export interface VolumeMount {
  /** Named docker volume; created on demand and persisted across runs. */
  readonly volumeName: string
  /** Absolute path inside the sandbox where the volume is mounted. */
  readonly sandboxPath: string
}

/** Names for the default JS-workspace volume pair. */
export interface WorkspaceVolumeNames {
  readonly nodeModules: string
  readonly pnpmStore: string
}

/** Subset of `console` used for warning emission — keeps the surface mockable. */
export type WarnLogger = Pick<Console, "warn">

/**
 * Standard volume layout for a JS workspace: `node_modules/` and `.pnpm-store/`
 * mounted at their conventional locations under the sandbox workspace.
 */
export function workspaceVolumes(names: WorkspaceVolumeNames): VolumeMount[] {
  return [
    {
      volumeName: names.nodeModules,
      sandboxPath: `${WORKSPACE_PATH}/node_modules`,
    },
    {
      volumeName: names.pnpmStore,
      sandboxPath: `${WORKSPACE_PATH}/.pnpm-store`,
    },
  ]
}

/**
 * Remove named docker volumes by name.
 *
 * Idempotent: missing volumes and volumes still in use by stopped containers
 * are reported via `logger.warn` and otherwise ignored. The promise resolves
 * once every removal attempt has settled — successes and warnings included.
 */
export async function removeVolumes(
  volumeNames: readonly string[],
  logger: WarnLogger = console,
): Promise<void> {
  await Promise.all(volumeNames.map((name) => removeVolume(name, logger)))
}

async function removeVolume(name: string, logger: WarnLogger): Promise<void> {
  const { exitCode, stderr } = await spawnDocker(["volume", "rm", name], {
    discardStdout: true,
  })
  if (exitCode !== 0) {
    logger.warn(`docker volume rm ${name} failed (non-fatal): ${stderr.trim()}`)
  }
}
