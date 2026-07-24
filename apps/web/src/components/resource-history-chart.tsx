import * as React from "react"

import { Area, Line } from "@/components/dither-kit/area"
import { AreaChart, LineChart } from "@/components/dither-kit/area-chart"
import { useChartPart } from "@/components/dither-kit/chart-context"
import type { ChartConfig } from "@/components/dither-kit/chart-context"
import { Grid } from "@/components/dither-kit/grid"
import type { Rgb, Seed } from "@/components/dither-kit/palette"
import { Tooltip } from "@/components/dither-kit/tooltip"

const networkSentColor = "oklch(0.73 0.15 65)"

const NETWORK_SENT_SEED = seedFromOklch(0.73, 0.15, 65)
const NETWORK_RECEIVED_SEED = seedFromOklch(0.78, 0.11, 205)

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function oklchToRgb(L: number, C: number, h: number): Rgb {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l_ = L + 0.396_337_777_4 * a + 0.215_803_757_3 * b
  const m_ = L - 0.105_561_345_8 * a - 0.063_854_172_8 * b
  const s_ = L - 0.089_484_177_5 * a - 1.291_485_548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  const rLin = 4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s
  const gLin = -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s
  const bLin = -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s
  const toSrgb = (channel: number) => {
    const c =
      channel <= 0.003_130_8
        ? 12.92 * channel
        : 1.055 * channel ** (1 / 2.4) - 0.055
    return Math.round(clamp01(c) * 255)
  }
  return [toSrgb(rLin), toSrgb(gLin), toSrgb(bLin)]
}

function seedFromOklch(L: number, C: number, h: number): Seed {
  const fill = oklchToRgb(L, C, h)
  const line = oklchToRgb(Math.min(0.92, L + 0.08), C * 0.85, h)
  const star = oklchToRgb(Math.min(0.95, L + 0.14), C * 0.7, h)
  return { fill, line, star }
}

function seedFromCssColor(color: string): Seed {
  const match = color.match(
    /oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\)/i
  )
  if (match) {
    return seedFromOklch(Number(match[1]), Number(match[2]), Number(match[3]))
  }
  return seedFromOklch(0.72, 0.1, 200)
}

function HistoryXAxis() {
  const ctx = useChartPart("XAxis")
  if (!ctx.ready || ctx.dataLength === 0) return null

  const last = ctx.dataLength - 1
  const mid = Math.round(last / 2)
  const y = ctx.plot.height + 7

  return (
    <g className="fill-current font-mono text-[10px] text-muted-foreground">
      {[
        { index: 0, label: "-1m" },
        { index: mid, label: "-30s" },
        { index: last, label: "Now" },
      ].map(({ index, label }) => (
        <text
          key={`${index}-${label}`}
          x={ctx.xCenter(index) ?? 0}
          y={y}
          textAnchor="middle"
          dominantBaseline="hanging"
          fill="currentColor"
        >
          {label}
        </text>
      ))}
    </g>
  )
}

function numericOrZero(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

export function ResourceHistoryChart({
  data,
  resourceId,
  label,
  color,
  formatValue,
}: {
  data: Array<{
    timestamp: number
    value: number | null
    received: number | null
    sent: number | null
  }>
  resourceId: "cpu" | "memory" | "storage" | "network"
  label: string
  color: string
  domainStart: number
  domainEnd: number
  formatValue: (value: number) => string
}) {
  const chartConfig = React.useMemo<ChartConfig>(() => {
    if (resourceId === "network") {
      const config: ChartConfig = {
        received: { label: "Download", color: NETWORK_RECEIVED_SEED },
        sent: { label: "Upload", color: NETWORK_SENT_SEED },
      }
      return config
    }
    const config: ChartConfig = {
      value: { label, color: seedFromCssColor(color) },
    }
    return config
  }, [color, label, resourceId])

  const chartData = React.useMemo(
    () =>
      data.map((sample) => ({
        timestamp: sample.timestamp,
        value: numericOrZero(sample.value),
        received: numericOrZero(sample.received),
        sent: numericOrZero(sample.sent),
      })),
    [data]
  )

  const yDomain = React.useMemo((): [number, number] | undefined => {
    if (resourceId === "network") return undefined
    if (resourceId === "memory" || resourceId === "storage") return [0, 100]
    const peak = chartData.reduce(
      (max, sample) => Math.max(max, sample.value),
      0
    )
    return [0, Math.max(10, Math.ceil(peak * 1.15))]
  }, [chartData, resourceId])

  const margins = {
    top: resourceId === "network" ? 18 : 7,
    right: 16,
    bottom: 22,
    left: 16,
  }

  const chartClassName = "h-32 w-full"

  return (
    <div className="relative">
      {resourceId === "network" ? (
        <div className="pointer-events-none absolute top-0 right-3 z-10 flex items-center gap-3 font-mono text-[8px] tracking-[0.07em] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-px w-3" style={{ backgroundColor: color }} />↓
            DOWN
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="w-3 border-t border-dashed"
              style={{ borderColor: networkSentColor }}
            />
            ↑ UP
          </span>
        </div>
      ) : null}

      {resourceId === "network" ? (
        <LineChart
          data={chartData}
          config={chartConfig}
          animate={false}
          bloom="off"
          hovered
          margins={margins}
          className={chartClassName}
          yDomain={yDomain}
        >
          <Grid horizontal vertical={false} strokeDasharray="2 4" />
          <HistoryXAxis />
          <Tooltip
            valueFormatter={(value, name) =>
              `${name === "received" ? "↓" : "↑"} ${formatValue(value)}`
            }
          />
          <Line dataKey="received" />
          <Line dataKey="sent" strokeVariant="dashed" />
        </LineChart>
      ) : (
        <AreaChart
          data={chartData}
          config={chartConfig}
          animate={false}
          bloom="off"
          hovered
          margins={margins}
          className={chartClassName}
          yDomain={yDomain}
        >
          <Grid horizontal vertical={false} strokeDasharray="2 4" />
          <HistoryXAxis />
          <Tooltip valueFormatter={(value) => formatValue(value)} />
          <Area dataKey="value" variant="gradient" />
        </AreaChart>
      )}
    </div>
  )
}
