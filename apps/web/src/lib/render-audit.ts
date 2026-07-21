import type { Options as ReactScanOptions } from "react-scan"

type ReactScanRenderHandler = NonNullable<ReactScanOptions["onRender"]>
type ReactScanRender = Parameters<ReactScanRenderHandler>[1][number]

interface RenderAuditEntry {
  component: string
  count: number
  didCommit: boolean
  phase: "mount" | "unmount" | "update" | "unknown"
  time: number
  unnecessary: boolean | null
}

interface ComponentRenderSummary {
  commits: number
  component: string
  events: number
  mounts: number
  time: number
  unmounts: number
  unnecessary: number
  updates: number
}

export interface HearthRenderAudit {
  clear: () => void
  snapshot: () => {
    active: boolean
    components: Array<ComponentRenderSummary>
    entries: Array<RenderAuditEntry>
  }
  start: () => void
  stop: () => ReturnType<HearthRenderAudit["snapshot"]>
}

declare global {
  interface Window {
    __hearthRenderAudit?: HearthRenderAudit
  }
}

function renderPhase(phase: ReactScanRender["phase"]): RenderAuditEntry["phase"] {
  if (phase === 1) return "mount"
  if (phase === 2) return "update"
  if (phase === 4) return "unmount"
  return "unknown"
}

export function createRenderAudit(): {
  audit: HearthRenderAudit
  onRender: ReactScanRenderHandler
} {
  let active = false
  let entries: Array<RenderAuditEntry> = []

  const snapshot = () => {
    const summaries = new Map<string, ComponentRenderSummary>()
    for (const entry of entries) {
      const summary = summaries.get(entry.component) ?? {
        commits: 0,
        component: entry.component,
        events: 0,
        mounts: 0,
        time: 0,
        unmounts: 0,
        unnecessary: 0,
        updates: 0,
      }
      summary.events += 1
      summary.commits += entry.didCommit ? 1 : 0
      summary.mounts += entry.phase === "mount" ? entry.count : 0
      summary.updates += entry.phase === "update" ? entry.count : 0
      summary.unmounts += entry.phase === "unmount" ? entry.count : 0
      summary.unnecessary += entry.unnecessary ? entry.count : 0
      summary.time += entry.time
      summaries.set(entry.component, summary)
    }

    return {
      active,
      components: [...summaries.values()].sort(
        (left, right) =>
          right.mounts + right.updates - (left.mounts + left.updates)
      ),
      entries: [...entries],
    }
  }

  const audit: HearthRenderAudit = {
    clear: () => {
      entries = []
    },
    snapshot,
    start: () => {
      entries = []
      active = true
    },
    stop: () => {
      active = false
      return snapshot()
    },
  }

  return {
    audit,
    onRender: (_fiber, renders) => {
      if (!active) return
      for (const render of renders) {
        entries.push({
          component: render.componentName ?? "(anonymous)",
          count: render.count,
          didCommit: render.didCommit,
          phase: renderPhase(render.phase),
          time: render.time ?? 0,
          unnecessary: render.unnecessary,
        })
      }
    },
  }
}
