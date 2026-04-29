import { ANSI_RESET, type OutputCapabilities, createStreamColorCycle } from "./palette.ts"

export interface PaneHandle {
  appendLine(line: string): void
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
): MultiplexingRenderer {
  if (caps.liveRedraw && caps.color) {
    return createTtyRenderer(out, caps)
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

      return {
        appendLine(line: string): void {
          if (closed) return
          const prefix = prefixFor(streamKey)
          for (const physicalLine of line.split("\n")) {
            out.write(`${prefix}${physicalLine}\n`)
          }
        },

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
): MultiplexingRenderer {
  const colorMap = new Map<string, string>()
  let colorIndex = 0
  const panes: TtyPaneHandle[] = []
  let liveLines = 0
  const borderChar = caps.unicode ? "─" : "-"
  const foldMark = caps.unicode ? "✓" : "*"

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
    if (liveLines > 0) {
      buf.push(cursorUp(liveLines))
      buf.push(ANSI_COL1)
    }
    for (const line of content) {
      buf.push(`${ANSI_ERASE_LINE}${line}\n`)
    }
    buf.push(ANSI_ERASE_BELOW)
    buf.push(ANSI_SHOW_CURSOR)
    liveLines = content.length
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
    if (liveLines > 0) {
      buf.push(cursorUp(liveLines))
      buf.push(ANSI_COL1)
    }
    buf.push(`${ANSI_ERASE_LINE}${summaryLine}\n`)
    for (const line of remaining) {
      buf.push(`${ANSI_ERASE_LINE}${line}\n`)
    }
    buf.push(ANSI_ERASE_BELOW)
    buf.push(ANSI_SHOW_CURSOR)
    liveLines = remaining.length
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
