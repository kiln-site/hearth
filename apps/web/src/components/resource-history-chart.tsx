import { Area, AreaChart, CartesianGrid, Line, XAxis, YAxis } from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@workspace/ui/components/chart"
import type { ChartConfig } from "@workspace/ui/components/chart"

export function ResourceHistoryChart({
  data,
  resourceId,
  label,
  color,
  domainStart,
  domainEnd,
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
  const sentColor = "oklch(0.73 0.15 65)"
  const chartConfig: ChartConfig =
    resourceId === "network"
      ? {
          received: { label: "Download", color },
          sent: { label: "Upload", color: sentColor },
        }
      : {
          value: { label, color },
        }
  const gradientId = `resource-history-${resourceId}`
  const yDomain =
    resourceId === "network"
      ? ([0, "auto"] as const)
      : resourceId === "cpu"
        ? ([
            0,
            (maximum: number) => Math.max(10, Math.ceil(maximum * 1.15)),
          ] as const)
        : ([0, 100] as const)

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
              style={{ borderColor: sentColor }}
            />
            ↑ UP
          </span>
        </div>
      ) : null}
      <ChartContainer
        config={chartConfig}
        className="aspect-auto h-32 w-full"
        initialDimension={{ width: 292, height: 128 }}
      >
        <AreaChart
          accessibilityLayer
          data={data}
          margin={{
            top: resourceId === "network" ? 18 : 7,
            right: 16,
            bottom: 0,
            left: 16,
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="4%"
                stopColor="var(--color-value)"
                stopOpacity={0.42}
              />
              <stop
                offset="96%"
                stopColor="var(--color-value)"
                stopOpacity={0.025}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            strokeDasharray="2 4"
            stroke="var(--border)"
            strokeOpacity={0.55}
          />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={[domainStart, domainEnd]}
            ticks={[domainStart, domainEnd - 30_000, domainEnd]}
            tickLine={false}
            axisLine={false}
            tickMargin={7}
            tickFormatter={(timestamp: number) =>
              timestamp === domainStart
                ? "-1m"
                : timestamp === domainEnd
                  ? "Now"
                  : `${Math.round((timestamp - domainEnd) / 1_000)}s`
            }
            interval={0}
            minTickGap={8}
          />
          <YAxis hide domain={yDomain} />
          <ChartTooltip
            cursor={{
              stroke: color,
              strokeOpacity: 0.3,
              strokeWidth: 1,
            }}
            content={
              <ChartTooltipContent
                hideLabel
                hideIndicator
                className="min-w-24 border-border/80 bg-popover px-2 py-1.5 shadow-xl"
                formatter={(value, name) => (
                  <span className="flex w-full items-center justify-between gap-3 font-mono text-[10px] font-medium tabular-nums">
                    {resourceId === "network" ? (
                      <span
                        className="text-[8px] tracking-[0.06em]"
                        style={{
                          color: name === "received" ? color : sentColor,
                        }}
                      >
                        {name === "received" ? "↓ DOWN" : "↑ UP"}
                      </span>
                    ) : null}
                    <span className="text-foreground">
                      {formatValue(Number(value))}
                    </span>
                  </span>
                )}
              />
            }
          />
          {resourceId === "network" ? (
            <>
              <Line
                dataKey="received"
                type="monotone"
                stroke="var(--color-received)"
                strokeWidth={1.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
                activeDot={{ r: 2.5, strokeWidth: 0 }}
              />
              <Line
                dataKey="sent"
                type="monotone"
                stroke="var(--color-sent)"
                strokeWidth={1.5}
                strokeDasharray="3 2"
                dot={false}
                connectNulls
                isAnimationActive={false}
                activeDot={{ r: 2.5, strokeWidth: 0 }}
              />
            </>
          ) : (
            <Area
              dataKey="value"
              type="monotone"
              stroke="var(--color-value)"
              strokeWidth={1.5}
              fill={`url(#${gradientId})`}
              connectNulls
              isAnimationActive={false}
              activeDot={{ r: 2.5, strokeWidth: 0 }}
            />
          )}
        </AreaChart>
      </ChartContainer>
    </div>
  )
}
