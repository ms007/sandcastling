/**
 * Docker process runner with stream/stdin contract and signal-based
 * cleanup registry.
 *
 *   1. Path constants used by every other module (single source of truth).
 *   2. A spawn-based wrapper around `docker` invocations that honors
 *      Sandcastle's streaming contract (per-line stdout via `onLine`) and
 *      supports stdin piping.
 *   3. A process-wide cleanup registry so any number of sandboxes share a
 *      single set of `exit`/`SIGINT`/`SIGTERM` listeners — avoiding the
 *      `MaxListenersExceededWarning` that would otherwise appear when many
 *      sandboxes are created in the same process.
 */
import { type ChildProcess, type StdioOptions, execFileSync, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { ExecResult } from "@ai-hero/sandcastle"

/** Absolute path to the runtime user's home inside the sandbox container. */
export const SANDBOX_HOME = "/home/agent"
/** Absolute path to the bind-mounted worktree inside the sandbox container. */
export const WORKSPACE_PATH = `${SANDBOX_HOME}/workspace`

/** Thrown when the `docker` binary cannot be invoked (missing, permissions, …). */
export class DockerCommandError extends Error {
  constructor(operation: string, cause: Error) {
    super(`docker ${operation} failed: ${cause.message}`, { cause })
    this.name = "DockerCommandError"
  }
}

export interface SpawnDockerOptions {
  /** Payload piped to the child's stdin and then closed. */
  readonly stdin?: string | undefined
  /**
   * Per-line callback for streamed stdout. When set, stdout is collected and
   * delivered line-by-line, matching Sandcastle's streaming contract.
   */
  readonly onLine?: ((line: string) => void) | undefined
  /**
   * Discard child stdout instead of buffering it into the resolved result.
   * Set for control-plane invocations (`volume create`, `cp`, `rm`, `stop`)
   * whose stdout is never inspected.
   */
  readonly discardStdout?: boolean | undefined
}

/**
 * Spawn a `docker` invocation, returning a structured result.
 *
 * Always uses `spawn` (never the buffered `execFile`) so the streaming
 * contract from `BindMountSandboxHandle.exec` is honored.
 */
export function spawnDocker(
  args: readonly string[],
  options: SpawnDockerOptions = {},
): Promise<ExecResult> {
  const { stdin, onLine, discardStdout = false } = options
  const op = args[0] ?? "exec"
  const stdio: StdioOptions = [
    stdin !== undefined ? "pipe" : "ignore",
    discardStdout ? "ignore" : "pipe",
    "pipe",
  ]

  return new Promise((resolve, reject) => {
    const proc = spawn("docker", [...args], { stdio })
    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []

    if (!discardStdout && proc.stdout) {
      collectStdout(proc.stdout, stdoutChunks, onLine)
    }
    if (proc.stderr) {
      proc.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk.toString())
      })
    }

    proc.on("error", (error) => {
      reject(new DockerCommandError(op, error))
    })
    proc.on("close", (code) => {
      resolve({
        stdout: onLine ? stdoutChunks.join("\n") : stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        exitCode: code ?? 0,
      })
    })

    if (stdin !== undefined && proc.stdin) {
      proc.stdin.end(stdin)
    }
  })
}

/** Wire a child's stdout into a chunk buffer, optionally streaming line-by-line. */
function collectStdout(
  stream: NonNullable<ChildProcess["stdout"]>,
  chunks: string[],
  onLine: ((line: string) => void) | undefined,
): void {
  if (onLine) {
    const rl = createInterface({ input: stream })
    rl.on("line", (line) => {
      chunks.push(line)
      onLine(line)
    })
    return
  }
  stream.on("data", (chunk: Buffer) => {
    chunks.push(chunk.toString())
  })
}

/** Throw a descriptive error when a control-plane docker invocation failed. */
export function assertOk(result: ExecResult, op: string): void {
  if (result.exitCode === 0) return
  const detail = result.stderr.trim() || result.stdout.trim()
  throw new Error(`docker ${op} exited ${result.exitCode}: ${detail}`)
}

/**
 * Run a control-plane `docker` invocation and throw if it exits non-zero.
 * Stdout is discarded — use `spawnDocker` directly when output is needed.
 */
export async function runDocker(args: readonly string[]): Promise<void> {
  const op = args[0] ?? "exec"
  const result = await spawnDocker(args, { discardStdout: true })
  assertOk(result, op)
}

// ---------- Signal-based cleanup registry ----------------------------------

const containersToCleanup = new Set<string>()
let handlersInstalled = false

/** Force-remove every registered container. Best-effort; never throws. */
function cleanupAll(): void {
  for (const name of containersToCleanup) {
    try {
      execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" })
    } catch {
      /* best-effort — process is exiting */
    }
  }
}

function onFatalSignal(): void {
  cleanupAll()
  process.exit(1)
}

function ensureHandlersInstalled(): void {
  if (handlersInstalled) return
  process.on("exit", cleanupAll)
  process.on("SIGINT", onFatalSignal)
  process.on("SIGTERM", onFatalSignal)
  handlersInstalled = true
}

/**
 * Mark a container for force-removal on process exit / SIGINT / SIGTERM.
 *
 * Returns an `unregister()` function that the sandbox's `close()` MUST call
 * during a graceful shutdown — otherwise the cleanup hook will redundantly
 * `docker rm -f` an already-removed container at process exit.
 */
export function registerForCleanup(containerName: string): () => void {
  ensureHandlersInstalled()
  containersToCleanup.add(containerName)
  return () => {
    containersToCleanup.delete(containerName)
  }
}
