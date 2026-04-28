/**
 * Docker-backed bind-mount sandbox provider for `@ai-hero/sandcastle`.
 *
 * Why we ship our own provider instead of using
 * `@ai-hero/sandcastle/sandboxes/docker`: see the docblock in `./chown.ts`
 * for the macOS / VirtioFS / `chown -R` story. In short — heavy directories
 * are mounted as named volumes on Docker Desktop's Linux-native filesystem,
 * and the chown step is narrowed to skip the bind-mounted worktree.
 */
import { type StdioOptions, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  type BindMountCreateOptions,
  type BindMountSandboxHandle,
  type BindMountSandboxProvider,
  type ExecResult,
  type InteractiveExecOptions,
  createBindMountSandboxProvider,
} from "@ai-hero/sandcastle"

import { buildChownScript } from "./chown.ts"
import {
  DockerCommandError,
  SANDBOX_HOME,
  WORKSPACE_PATH,
  assertOk,
  registerForCleanup,
  runDocker,
  spawnDocker,
} from "./process.ts"
import type { VolumeMount } from "./volumes.ts"

/** Configuration for the {@link docker} provider. */
export interface DockerOptions {
  /** Image tag the sandbox container should be started from. */
  readonly imageName: string
  /**
   * Persistent named docker volumes overlaid on workspace paths. Use for any
   * directory that would otherwise grow large inside the bind-mounted
   * worktree (`node_modules/`, package-manager stores). Volumes survive
   * container removal — wipe them via `removeVolumes` when needed.
   */
  readonly volumes?: readonly VolumeMount[]
  /**
   * When set, container names become `<namePrefix>-<short-random>` instead
   * of the default `sandcastle-<uuid>`. Useful for tagging containers with
   * a run identifier so `docker ps` output is immediately traceable.
   */
  readonly namePrefix?: string
}

/**
 * Build a Sandcastle bind-mount provider backed by Docker. Caller supplies
 * the image tag and any persistent named volumes to overlay onto the
 * workspace; the provider itself stays project-agnostic.
 */
export function docker(options: DockerOptions): BindMountSandboxProvider {
  return createBindMountSandboxProvider({
    name: "docker",
    sandboxHomedir: SANDBOX_HOME,
    create: (createOptions) => createDockerSandbox(createOptions, options),
  })
}

// ---------- Container naming ------------------------------------------------

function buildContainerName(namePrefix: string | undefined): string {
  if (namePrefix) {
    return `${namePrefix}-${randomUUID().slice(0, 8)}`
  }
  return `sandcastle-${randomUUID()}`
}

// ---------- Sandbox creation -----------------------------------------------

async function createDockerSandbox(
  createOptions: BindMountCreateOptions,
  { imageName, volumes = [], namePrefix }: DockerOptions,
): Promise<BindMountSandboxHandle> {
  const containerName = buildContainerName(namePrefix)
  const worktreePath = resolveWorktreePath(createOptions)
  const uid = process.getuid?.() ?? 1000
  const gid = process.getgid?.() ?? 1000

  // `docker volume create` is idempotent — no-op if the volume already exists.
  await Promise.all(volumes.map((v) => runDocker(["volume", "create", v.volumeName])))

  await runDocker([
    "run",
    "-d",
    "--name",
    containerName,
    ...envFlags({ ...createOptions.env, HOME: SANDBOX_HOME }),
    ...bindMountFlags(createOptions.mounts),
    ...volumeFlags(volumes),
    "-w",
    worktreePath,
    "--user",
    `${uid}:${gid}`,
    imageName,
  ])

  const unregisterCleanup = registerForCleanup(containerName)

  try {
    await runDocker([
      "exec",
      "-u",
      "root",
      containerName,
      "sh",
      "-c",
      buildChownScript({
        uid,
        gid,
        volumePaths: volumes.map((v) => v.sandboxPath),
      }),
    ])
  } catch (error) {
    // Setup failed — tear the container down before propagating.
    await safeRemove(containerName, unregisterCleanup)
    throw error
  }

  return createHandle(containerName, worktreePath, unregisterCleanup)
}

/**
 * Find the sandbox-side path that corresponds to the host-side worktree.
 * Falls back to {@link WORKSPACE_PATH} when the mount list does not surface
 * the worktree explicitly (shouldn't happen in practice — guard exists for
 * forward compatibility with provider-config changes).
 */
function resolveWorktreePath(createOptions: BindMountCreateOptions): string {
  const matched = createOptions.mounts.find((m) => m.hostPath === createOptions.worktreePath)
  return matched?.sandboxPath ?? WORKSPACE_PATH
}

/**
 * Best-effort `docker rm -f`. Only deregisters from the signal-handler set
 * on a successful removal; otherwise the handler still mops up at exit.
 */
async function safeRemove(containerName: string, unregisterCleanup: () => void): Promise<void> {
  const rm = await spawnDocker(["rm", "-f", containerName], {
    discardStdout: true,
  })
  if (rm.exitCode === 0) unregisterCleanup()
}

// ---------- Handle ---------------------------------------------------------

function createHandle(
  containerName: string,
  worktreePath: string,
  unregisterCleanup: () => void,
): BindMountSandboxHandle {
  return {
    worktreePath,
    exec: (command, opts) => execIn(containerName, command, opts),
    interactiveExec: (args, opts) => interactiveExecIn(containerName, args, opts),
    copyFileIn: (hostPath, sandboxPath) => cp(hostPath, `${containerName}:${sandboxPath}`),
    copyFileOut: (sandboxPath, hostPath) => cp(`${containerName}:${sandboxPath}`, hostPath),
    close: async () => {
      unregisterCleanup()
      // The container may already be gone (signal handler), so we ignore the
      // result — best-effort teardown.
      await spawnDocker(["rm", "-f", containerName], { discardStdout: true })
    },
  }
}

interface ExecOptions {
  readonly onLine?: (line: string) => void
  readonly cwd?: string
  readonly sudo?: boolean
  readonly stdin?: string
}

function execIn(
  containerName: string,
  command: string,
  opts: ExecOptions = {},
): Promise<ExecResult> {
  const effective = opts.sudo ? `sudo ${command}` : command
  // `-i` is required so stdin reaches the child. Always set it; harmless
  // when no stdin is piped, essential when sandcastle pipes a prompt.
  const args = [
    "exec",
    "-i",
    ...(opts.cwd ? ["-w", opts.cwd] : []),
    containerName,
    "sh",
    "-c",
    effective,
  ]
  return spawnDocker(args, { stdin: opts.stdin, onLine: opts.onLine })
}

function interactiveExecIn(
  containerName: string,
  command: readonly string[],
  opts: InteractiveExecOptions,
): Promise<{ exitCode: number }> {
  const isTty = "isTTY" in opts.stdin && opts.stdin.isTTY === true
  const args = [
    "exec",
    isTty ? "-it" : "-i",
    ...(opts.cwd ? ["-w", opts.cwd] : []),
    containerName,
    ...command,
  ]

  // The interactive streams are typed as NodeJS.ReadableStream/WritableStream
  // interfaces, but the runtime objects are concrete Stream instances that
  // `spawn`'s stdio accepts. One boundary cast keeps the call site readable.
  const stdio = [opts.stdin, opts.stdout, opts.stderr] as unknown as StdioOptions

  return new Promise((resolve, reject) => {
    const proc = spawn("docker", args, { stdio })
    proc.on("error", (error: Error) => {
      reject(new DockerCommandError("exec (interactive)", error))
    })
    proc.on("close", (code: number | null) => {
      resolve({ exitCode: code ?? 0 })
    })
  })
}

async function cp(source: string, dest: string): Promise<void> {
  const result = await spawnDocker(["cp", source, dest], {
    discardStdout: true,
  })
  assertOk(result, "cp")
}

// ---------- CLI flag builders ---------------------------------------------

function envFlags(env: Readonly<Record<string, string>>): string[] {
  return Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`])
}

function bindMountFlags(mounts: BindMountCreateOptions["mounts"]): string[] {
  return mounts.flatMap((m) => {
    const spec = `${m.hostPath}:${m.sandboxPath}${m.readonly ? ":ro" : ""}`
    return ["-v", spec]
  })
}

function volumeFlags(volumes: readonly VolumeMount[]): string[] {
  return volumes.flatMap((v) => ["-v", `${v.volumeName}:${v.sandboxPath}`])
}

/** Test seam — internal helpers exposed for unit tests. Not a public API. */
export const __testing = {
  buildContainerName,
  envFlags,
  bindMountFlags,
  volumeFlags,
  resolveWorktreePath,
}
