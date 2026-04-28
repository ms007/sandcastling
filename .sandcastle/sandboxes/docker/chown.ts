/**
 * Pure builder for the `sh -c` script that prepares ownership inside a
 * freshly-started container.
 *
 * Why custom: the upstream Docker provider runs `chown -R agent:agent
 * /home/agent`, which on macOS recurses through the bind-mounted worktree
 * over VirtioFS. Once the worktree contains a populated `node_modules/`
 * (~400 MB, 100k+ files), the chown alone exceeds the 120 s
 * `CONTAINER_START_TIMEOUT_MS` and `createSandbox` rejects with
 * `ContainerStartTimeoutError`.
 *
 * Strategy:
 *   - `/home/agent/workspace` is bind-mounted from the host; ownership is
 *     inherited so it is skipped entirely.
 *   - Every other top-level home entry (`~/.local`, `~/.cache`, …) lives on
 *     the overlay filesystem and is chowned recursively (small, fast).
 *   - `/home/agent` itself is chowned at depth 0 so the runtime user can
 *     create new dotfiles.
 *   - Each volume mount point is chowned at depth 0 unconditionally; a deep
 *     recursive chown only runs on the **first** mount of a fresh volume,
 *     detected by checking that the top-level entries belong to the runtime
 *     user. On warm reuse this is a no-op.
 */

import { SANDBOX_HOME, WORKSPACE_PATH } from "./process.ts"

// `find ! -name <basename>` needs a basename, not an absolute path.
const WORKSPACE_BASENAME = WORKSPACE_PATH.slice(SANDBOX_HOME.length + 1)

export interface ChownScriptOptions {
  readonly uid: number
  readonly gid: number
  /** Absolute paths inside the sandbox where named volumes are mounted. */
  readonly volumePaths: readonly string[]
}

export function buildChownScript({ uid, gid, volumePaths }: ChownScriptOptions): string {
  const owner = `${uid}:${gid}`
  const segments = [
    // Recursive chown of overlay-fs home entries, skipping the workspace bind-mount.
    `find ${SANDBOX_HOME} -mindepth 1 -maxdepth 1 ! -name ${WORKSPACE_BASENAME} -exec chown -R ${owner} {} +`,
    // Depth-0 chown of $HOME so new dotfiles can be created.
    `chown ${owner} ${SANDBOX_HOME}`,
    ...volumePaths.map((path) => volumeChownSegment(path, uid, owner)),
  ]
  return segments.join(" && ")
}

/**
 * Volume mount-point chown:
 *   - Depth-0 chown is always cheap; do it unconditionally.
 *   - Recursive chown only runs on first-mount detection (root still owns
 *     entries inside the volume).
 */
function volumeChownSegment(path: string, uid: number, owner: string): string {
  const isFreshlyMounted =
    `[ "$(stat -c %u ${path}/.)" != "${uid}" ] || ` +
    `[ -n "$(find ${path} -maxdepth 2 ! -uid ${uid} -print -quit 2>/dev/null)" ]`
  return `chown ${owner} ${path}; if ${isFreshlyMounted}; then chown -R ${owner} ${path}; fi`
}
