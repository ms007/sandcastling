import { ANSI_RESET, type OutputCapabilities, createStreamColorCycle } from "./palette.ts"

export interface PaneHandle {
  appendLine(line: string): void
  /**
   * Append a line that always stays rendered between the pane title and the
   * rolling content window. Use for stage headers / progress markers so the
   * user keeps seeing what is done and where they are even after the rolling
   * window has scrolled past.
   */
  appendSticky(line: string): void
  setTitle(title: string): void
  close(summary: string): void
}

export interface MultiplexingRenderer {
  openPane(streamKey: string, title: string): PaneHandle
}

const ANSI_ERASE_LINE = "\x1b[2K"
const ANSI_ERASE_BELOW = "\x1b[J"
const ANSI_COL1 = "\x1b[G"
const ANSI_HIDE_CURSOR = "\x1b[?25l"
const ANSI_SHOW_CURSOR = "\x1b[?25h"

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ESC-based ANSI sequences requires \x1b
const ANSI_SEQUENCE = /\x1b\[[0-9;?]*[a-zA-Z]/g

function visibleLength(line: string): number {
  return Array.from(line.replace(ANSI_SEQUENCE, "")).length
}

const PANE_COLORS = [
  "\x1b[36m", // cyan
  "\x1b[35m", // magenta
  "\x1b[33m", // yellow
  "\x1b[34m", // blue
  "\x1b[32m", // green
  "\x1b[91m", // bright red
]

const DEFAULT_WINDOW_SIZE = 5

function cursorUp(n: number): string {
  return n > 0 ? `\x1b[${n}A` : ""
}

export function createMultiplexingRenderer(
  out: { write(s: string): void },
  caps: OutputCapabilities,
  columns?: () => number | undefined,
): MultiplexingRenderer {
  if (caps.liveRedraw && caps.color) {
    return createTtyRenderer(out, caps, columns)
  }
  return createStreamRenderer(out, caps)
}

function createStreamRenderer(
  out: { write(s: string): void },
  caps: OutputCapabilities,
): MultiplexingRenderer {
  const cycle = createStreamColorCycle()
  const activePanes = new Set<string>()

  function prefixFor(streamKey: string): string {
    if (activePanes.size < 2) return ""
    if (caps.color) {
      const color = cycle.colorFor(streamKey)
      return `${color}[${streamKey}]${ANSI_RESET} `
    }
    return `[${streamKey}] `
  }

  return {
    openPane(streamKey: string, _title: string): PaneHandle {
      cycle.colorFor(streamKey)
      activePanes.add(streamKey)

      let closed = false

      function write(line: string): void {
        if (closed) return
        const prefix = prefixFor(streamKey)
        for (const physicalLine of line.split("\n")) {
          out.write(`${prefix}${physicalLine}\n`)
        }
      }

      return {
        appendLine: write,
        appendSticky: write,

        setTitle(_title: string): void {},

        close(_summary: string): void {
          if (closed) return
          closed = true
          activePanes.delete(streamKey)
          cycle.release(streamKey)
        },
      }
    },
  }
}

function createTtyRenderer(
  out: { write(s: string): void },
  caps: OutputCapabilities,
  columns?: () => number | undefined,
): MultiplexingRenderer {
  const colorMap = new Map<string, string>()
  let colorIndex = 0
  const panes: TtyPaneHandle[] = []
  let livePhysicalRows = 0
  const borderChar = caps.unicode ? "─" : "-"
  const foldMark = caps.unicode ? "✓" : "*"

  function physicalRowsFor(lines: readonly string[]): number {
    const cols = columns?.()
    if (cols === undefined || cols <= 0) return lines.length
    let total = 0
    for (const line of lines) {
      total += Math.max(1, Math.ceil(visibleLength(line) / cols))
    }
    return total
  }

  function assignColor(streamKey: string): string {
    const existing = colorMap.get(streamKey)
    if (existing !== undefined) return existing
    const color = PANE_COLORS[colorIndex % PANE_COLORS.length] as string
    colorIndex++
    colorMap.set(streamKey, color)
    return color
  }

  function renderTitle(title: string, color: string): string {
    return `${color}${borderChar}${borderChar}${borderChar} ${title} ${borderChar}${borderChar}${borderChar}${ANSI_RESET}`
  }

  function computeLiveContent(): string[] {
    const lines: string[] = []
    for (const pane of panes) {
      lines.push(renderTitle(pane.title, pane.color))
      for (const sticky of pane.getSticky()) {
        lines.push(`  ${sticky}`)
      }
      const window = pane.getWindow()
      for (const line of window) {
        lines.push(`  ${line}`)
      }
    }
    return lines
  }

  function redraw(): void {
    const content = computeLiveContent()
    const buf: string[] = []
    buf.push(ANSI_HIDE_CURSOR)
    if (livePhysicalRows > 0) {
      buf.push(cursorUp(livePhysicalRows))
      buf.push(ANSI_COL1)
    }
    for (const line of content) {
      buf.push(`${ANSI_ERASE_LINE}${line}\n`)
    }
    buf.push(ANSI_ERASE_BELOW)
    buf.push(ANSI_SHOW_CURSOR)
    livePhysicalRows = physicalRowsFor(content)
    out.write(buf.join(""))
  }

  function closePane(pane: TtyPaneHandle, summary: string): void {
    const idx = panes.indexOf(pane)
    if (idx === -1) return
    panes.splice(idx, 1)

    const remaining = computeLiveContent()
    const summaryLine = `${pane.color}${foldMark} ${summary}${ANSI_RESET}`

    const buf: string[] = []
    buf.push(ANSI_HIDE_CURSOR)
    if (livePhysicalRows > 0) {
      buf.push(cursorUp(livePhysicalRows))
      buf.push(ANSI_COL1)
    }
    buf.push(`${ANSI_ERASE_LINE}${summaryLine}\n`)
    for (const line of remaining) {
      buf.push(`${ANSI_ERASE_LINE}${line}\n`)
    }
    buf.push(ANSI_ERASE_BELOW)
    buf.push(ANSI_SHOW_CURSOR)
    livePhysicalRows = physicalRowsFor(remaining)
    out.write(buf.join(""))
  }

  return {
    openPane(streamKey: string, title: string): PaneHandle {
      const color = assignColor(streamKey)
      const pane = new TtyPaneHandle(title, color, redraw, closePane)
      panes.push(pane)
      redraw()
      return pane
    },
  }
}

class TtyPaneHandle implements PaneHandle {
  title: string
  readonly color: string
  private closed = false
  private readonly lines: string[] = []
  private readonly stickyLines: string[] = []
  private readonly onUpdate: () => void
  private readonly onClose: (pane: TtyPaneHandle, summary: string) => void

  constructor(
    title: string,
    color: string,
    onUpdate: () => void,
    onClose: (pane: TtyPaneHandle, summary: string) => void,
  ) {
    this.title = title
    this.color = color
    this.onUpdate = onUpdate
    this.onClose = onClose
  }

  getSticky(): readonly string[] {
    return this.stickyLines
  }

  getWindow(): readonly string[] {
    const start = Math.max(0, this.lines.length - DEFAULT_WINDOW_SIZE)
    return this.lines.slice(start)
  }

  appendLine(line: string): void {
    if (this.closed) return
    for (const physicalLine of line.split("\n")) {
      this.lines.push(physicalLine)
    }
    this.onUpdate()
  }

  appendSticky(line: string): void {
    if (this.closed) return
    for (const physicalLine of line.split("\n")) {
      this.stickyLines.push(physicalLine)
    }
    this.onUpdate()
  }

  setTitle(title: string): void {
    if (this.closed) return
    this.title = title
    this.onUpdate()
  }

  close(summary: string): void {
    if (this.closed) return
    this.closed = true
    this.onClose(this, summary)
  }
}
