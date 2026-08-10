import * as React from "react"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ensuringPromise, forkPromise } from "@/effect/promise"
import {
  ArrowLeftRight,
  CalendarDays,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleGauge,
  FileClock,
  FolderClock,
  KeyRound,
  ListFilter,
  Network,
  RadioTower,
  RefreshCw,
  Search,
  Server,
  TerminalSquare,
  UserRound,
  X,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import { WorkspaceSummaryCard } from "@/components/workspace-summary-card"
import {
  ServerPickerList,
  serverPickerOptionKey,
} from "@/components/server-picker-list"
import {
  activityLocalRangeToUtc,
  activityTypes,
  isActivitySource,
  isActivityType,
} from "@/lib/activity"
import type { ActivitySource, ActivityType } from "@/lib/activity"
import { activityQueryOptions } from "@/lib/query-options"
import { relayInstanceRouteId } from "@/lib/relay-fleet"
import type { ActivityData, ActivityEntry } from "@/server/activity"

export interface ActivityFilters {
  from?: string
  q?: string
  relay?: string
  server?: string
  source?: ActivitySource
  to?: string
  type?: ActivityType
  user?: string
}

interface ActivityPageProps {
  filters: ActivityFilters
  onFiltersChange: (change: Partial<ActivityFilters>) => void
}

const typeDetails: Record<
  ActivityType,
  { icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  server: { icon: Server, label: "Server" },
  power: { icon: CircleGauge, label: "Power" },
  console: { icon: TerminalSquare, label: "Console" },
  files: { icon: FolderClock, label: "Files" },
  network: { icon: Network, label: "Network" },
  access: { icon: KeyRound, label: "Access" },
  relay: { icon: RadioTower, label: "Relay" },
  updates: { icon: RefreshCw, label: "Updates" },
  system: { icon: FileClock, label: "System" },
}

const activityTime = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

const activityDay = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  month: "short",
  year: "numeric",
})

const activityShortDate = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
})

const activityCalendarMonth = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
})

const activityCalendarDay = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  weekday: "long",
  year: "numeric",
})

const activityCalendarWeekdays = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]

const minimumActivitySyncFeedbackMs = 500
const activityTableBottomPadding = 12

export const ActivityPage = React.memo(function ActivityPage({
  filters,
  onFiltersChange,
}: ActivityPageProps) {
  const { data } = useSuspenseQuery(
    activityQueryOptions(filters.from, filters.to)
  )

  const actors = React.useMemo(() => activityActors(data), [data])
  const entries = React.useMemo(
    () => filterActivity(data.entries, filters, filters.q ?? ""),
    [data.entries, filters]
  )
  const activeFilterCount = [
    filters.q,
    filters.type,
    filters.user,
    filters.relay,
    filters.server,
    filters.source,
    filters.from,
    filters.to,
  ].filter(Boolean).length

  return (
    <div className="mx-auto flex h-full min-h-[34rem] w-full max-w-[90rem] flex-col px-3 pt-3 pb-3 sm:px-5 sm:pt-5 sm:pb-5">
      <ActivityServerFilter
        data={data}
        filters={filters}
        onFiltersChange={onFiltersChange}
      />

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card/45 [contain:paint]">
        <ActivityFiltersToolbar
          actors={actors}
          data={data}
          filters={filters}
          activeFilterCount={activeFilterCount}
          onFiltersChange={onFiltersChange}
        />

        <ActivityStatus data={data} />
        <ActivityResults entries={entries} filtered={activeFilterCount > 0} />
      </section>
    </div>
  )
})

const ActivityFiltersToolbar = React.memo(function ActivityFiltersToolbar({
  activeFilterCount,
  actors,
  data,
  filters,
  onFiltersChange,
}: {
  activeFilterCount: number
  actors: Array<ActivityEntry["actor"]>
  data: ActivityData
  filters: ActivityFilters
  onFiltersChange: (change: Partial<ActivityFilters>) => void
}) {
  return (
    <div className="border-b bg-background/15 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ActivitySyncButton from={filters.from} to={filters.to} />
        <ActivitySearch
          key={filters.q ?? ""}
          initialValue={filters.q ?? ""}
          onFiltersChange={onFiltersChange}
        />

        <ActivitySelect
          ariaLabel="Filter activity by type"
          icon={<ListFilter />}
          value={filters.type ?? ""}
          onChange={(value) =>
            onFiltersChange({
              type: isActivityType(value) ? value : undefined,
            })
          }
        >
          <option value="">All types</option>
          {activityTypes.map((type) => (
            <option key={type} value={type}>
              {typeDetails[type].label}
            </option>
          ))}
        </ActivitySelect>

        <ActivitySelect
          ariaLabel="Filter activity by source"
          icon={<Bot />}
          value={filters.source ?? ""}
          onChange={(value) =>
            onFiltersChange({
              source: isActivitySource(value) ? value : undefined,
            })
          }
        >
          <option value="">All sources</option>
          <option value="web">Web</option>
          <option value="cli">CLI</option>
        </ActivitySelect>

        <ActivitySelect
          ariaLabel="Filter activity by user"
          icon={<UserRound />}
          value={filters.user ?? ""}
          onChange={(value) => onFiltersChange({ user: value || undefined })}
        >
          <option value="">All users</option>
          {actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name}
            </option>
          ))}
        </ActivitySelect>

        {data.relays.length > 1 ? (
          <ActivitySelect
            ariaLabel="Filter activity by Relay"
            icon={<RadioTower />}
            value={filters.relay ?? ""}
            onChange={(value) =>
              onFiltersChange({
                relay: value || undefined,
                server:
                  filters.server &&
                  data.servers.some(
                    (server) =>
                      server.id === filters.server &&
                      (!value || server.relayId === value)
                  )
                    ? filters.server
                    : undefined,
              })
            }
          >
            <option value="">All Relays</option>
            {data.relays.map((relay) => (
              <option key={relay.id} value={relay.id}>
                {relay.name}
              </option>
            ))}
          </ActivitySelect>
        ) : null}

        <ActivityDateRange
          from={filters.from}
          to={filters.to}
          onChange={(range) => onFiltersChange(range)}
        />

        {activeFilterCount > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              onFiltersChange({
                from: undefined,
                q: undefined,
                relay: undefined,
                server: undefined,
                source: undefined,
                to: undefined,
                type: undefined,
                user: undefined,
              })
            }
          >
            <X />
            Clear {activeFilterCount}
          </Button>
        ) : null}
      </div>
    </div>
  )
})

const ActivityServerFilter = React.memo(function ActivityServerFilter({
  data,
  filters,
  onFiltersChange,
}: {
  data: ActivityData
  filters: ActivityFilters
  onFiltersChange: (change: Partial<ActivityFilters>) => void
}) {
  const relayNameById = React.useMemo(
    () => new Map(data.relays.map((relay) => [relay.id, relay.name])),
    [data.relays]
  )
  const servers = React.useMemo(
    () =>
      data.servers.flatMap((server) => {
        if (filters.relay && server.relayId !== filters.relay) return []

        const relayName = relayNameById.get(server.relayId) ?? "Relay"
        return [
          {
            ...server,
            relayName,
          },
        ]
      }),
    [data.servers, filters.relay, relayNameById]
  )
  const selectedServer =
    servers.find((server) => server.id === filters.server) ?? null
  const selectedRelayName = filters.relay
    ? relayNameById.get(filters.relay)
    : undefined
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const selectedKeys = React.useMemo(
    () =>
      new Set(selectedServer ? [serverPickerOptionKey(selectedServer)] : []),
    [selectedServer]
  )
  const selectServer = React.useCallback(
    (server: (typeof servers)[number]) => {
      onFiltersChange({ server: server.id })
      setPickerOpen(false)
    },
    [onFiltersChange]
  )
  const selectionMetadata = selectedServer
    ? selectedServer.id
    : `${servers.length} accessible ${
        servers.length === 1 ? "instance" : "instances"
      }`

  return (
    <div className="mb-3">
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <WorkspaceSummaryCard
          action={
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
              >
                <ArrowLeftRight />
                {selectedServer ? "Change server" : "Choose server"}
              </Button>
            </PopoverTrigger>
          }
          icon={<Server className="size-5" />}
          title={selectedServer?.name ?? "All servers"}
          titleAccessory={
            <Badge variant="outline" className="font-mono text-[9px]">
              {selectedServer?.relayName ?? selectedRelayName ?? "All Relays"}
            </Badge>
          }
        >
          <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground/70">
            {selectionMetadata}
          </p>
        </WorkspaceSummaryCard>
        <PopoverContent
          align="end"
          className="w-[min(32rem,calc(100vw-2rem))] p-1.5"
        >
          <ServerPickerList
            allOption={{
              description: "Every accessible instance",
              label: "All servers",
              selected: selectedServer === null,
              onSelect: () => {
                onFiltersChange({ server: undefined })
                setPickerOpen(false)
              },
            }}
            selectedKeys={selectedKeys}
            servers={servers}
            onSelect={selectServer}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
})

const ActivitySyncButton = React.memo(function ActivitySyncButton({
  from,
  to,
}: {
  from?: string
  to?: string
}) {
  const { fetchStatus, refetch } = useQuery({
    ...activityQueryOptions(from, to),
    notifyOnChangeProps: ["fetchStatus"],
  })
  const [manualSyncing, setManualSyncing] = React.useState(false)
  const manualSyncingRef = React.useRef(false)
  const feedbackTimeoutRef = React.useRef<number>(undefined)
  const mountedRef = React.useRef(true)
  const syncing = manualSyncing || fetchStatus === "fetching"

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (feedbackTimeoutRef.current !== undefined) {
        window.clearTimeout(feedbackTimeoutRef.current)
      }
    }
  }, [])

  const syncActivity = React.useCallback(() => {
    if (manualSyncingRef.current) return
    manualSyncingRef.current = true
    setManualSyncing(true)
    const startedAt = performance.now()

    forkPromise(() =>
      ensuringPromise(refetch, () => {
        if (!mountedRef.current) return
        const elapsed = performance.now() - startedAt
        const remaining = Math.max(0, minimumActivitySyncFeedbackMs - elapsed)
        feedbackTimeoutRef.current = window.setTimeout(() => {
          manualSyncingRef.current = false
          setManualSyncing(false)
          feedbackTimeoutRef.current = undefined
        }, remaining)
      })
    )
  }, [refetch])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="Sync activity"
          aria-busy={syncing}
          disabled={syncing}
          onClick={syncActivity}
        >
          <RefreshCw className={syncing ? "animate-spin" : ""} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        Sync activity
      </TooltipContent>
    </Tooltip>
  )
})

function ActivitySelect({
  ariaLabel,
  children,
  icon,
  onChange,
  value,
}: {
  ariaLabel: string
  children: React.ReactNode
  icon: React.ReactNode
  onChange: (value: string) => void
  value: string
}) {
  return (
    <label className="relative inline-flex h-8 min-w-0 items-center border border-input/90 bg-input/20 text-xs text-foreground/90 transition-colors hover:border-primary/35 hover:bg-accent/70">
      <span className="pointer-events-none ml-2 text-muted-foreground [&_svg]:size-3.5">
        {icon}
      </span>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="h-full min-w-0 appearance-none bg-transparent py-0 pr-7 pl-1.5 outline-none"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 size-3 text-muted-foreground" />
    </label>
  )
}

const ActivitySearch = React.memo(function ActivitySearch({
  initialValue,
  onFiltersChange,
}: {
  initialValue: string
  onFiltersChange: (change: Partial<ActivityFilters>) => void
}) {
  const [value, setValue] = React.useState(initialValue)
  const searchTimer = React.useRef<number>(undefined)

  React.useEffect(
    () => () => {
      if (searchTimer.current !== undefined) {
        window.clearTimeout(searchTimer.current)
      }
    },
    []
  )

  const update = React.useCallback(
    (nextValue: string) => {
      setValue(nextValue)
      if (searchTimer.current !== undefined) {
        window.clearTimeout(searchTimer.current)
      }
      searchTimer.current = window.setTimeout(() => {
        onFiltersChange({ q: nextValue.trim() || undefined })
      }, 180)
    },
    [onFiltersChange]
  )

  return (
    <div className="relative min-w-[14rem] flex-1 sm:max-w-md">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(event) => update(event.currentTarget.value)}
        placeholder="Search actions, people, servers…"
        aria-label="Search activity"
        className="pr-8 pl-9 text-base md:text-sm"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear activity search"
          className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground"
          onClick={() => update("")}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
})

type ActivityDateRangeValue = { from: Date | undefined; to?: Date } | undefined
type ActivityDateBoundary = "from" | "to"

const ActivityDateRange = React.memo(function ActivityDateRange({
  from,
  to,
  onChange,
}: {
  from?: string
  to?: string
  onChange: (range: Pick<ActivityFilters, "from" | "to">) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [range, setRange] = React.useState<ActivityDateRangeValue>(() =>
    selectedDateRange(from, to)
  )
  const [activeBoundary, setActiveBoundary] =
    React.useState<ActivityDateBoundary>("from")
  const maximumDate = React.useMemo(() => {
    const date = new Date()
    date.setHours(23, 59, 59, 999)
    return date
  }, [])
  const maximumWeekStart = React.useMemo(
    () => startOfLocalWeek(startOfLocalMonth(maximumDate)),
    [maximumDate]
  )
  const [visibleWeekStart, setVisibleWeekStart] = React.useState(() =>
    dateRangeDisplayWeek(selectedDateRange(from, to), maximumDate)
  )
  const calendarElement = React.useRef<HTMLDivElement>(null)
  const weekWheel = React.useRef<{ delta: number; resetTimer?: number }>({
    delta: 0,
  })

  const shiftWeeks = React.useCallback(
    (offset: number) => {
      setVisibleWeekStart((current) => {
        const next = addLocalDays(current, offset * 7)
        return next > maximumWeekStart ? maximumWeekStart : next
      })
    },
    [maximumWeekStart]
  )

  const handleCalendarWheel = React.useCallback(
    (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY === 0) return

      event.preventDefault()
      const wheel = weekWheel.current
      if (wheel.resetTimer) window.clearTimeout(wheel.resetTimer)
      wheel.resetTimer = window.setTimeout(() => {
        wheel.delta = 0
        wheel.resetTimer = undefined
      }, 120)

      const multiplier =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1
      wheel.delta += event.deltaY * multiplier
      if (Math.abs(wheel.delta) < 8) return

      shiftWeeks(wheel.delta > 0 ? 1 : -1)
      wheel.delta = 0
    },
    [shiftWeeks]
  )

  const setCalendarRef = React.useCallback(
    (calendar: HTMLDivElement | null) => {
      calendarElement.current?.removeEventListener("wheel", handleCalendarWheel)
      calendarElement.current = calendar
      calendar?.addEventListener("wheel", handleCalendarWheel, {
        passive: false,
      })
    },
    [handleCalendarWheel]
  )

  const shiftMonths = React.useCallback(
    (offset: number) => {
      setVisibleWeekStart((current) => {
        const visibleDays = localCalendarDays(current, 42)
        const month = mostVisibleMonth(visibleDays)
        const nextMonth = new Date(
          month.getFullYear(),
          month.getMonth() + offset
        )
        const next = startOfLocalWeek(nextMonth)
        return next > maximumWeekStart ? maximumWeekStart : next
      })
    },
    [maximumWeekStart]
  )

  React.useEffect(() => {
    const wheel = weekWheel.current
    return () => {
      if (wheel.resetTimer) {
        window.clearTimeout(wheel.resetTimer)
      }
    }
  }, [])

  const updateOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        const nextRange = selectedDateRange(from, to)
        setRange(nextRange)
        setActiveBoundary("from")
        setVisibleWeekStart(dateRangeDisplayWeek(nextRange, maximumDate))
      }
      setOpen(nextOpen)
    },
    [from, maximumDate, to]
  )

  const commitRange = React.useCallback(
    (nextRange: ActivityDateRangeValue) => {
      setRange(nextRange)
      if (nextRange?.from && nextRange.to) {
        onChange(activityLocalRangeToUtc(nextRange.from, nextRange.to))
      }
    },
    [onChange]
  )

  const selectDay = React.useCallback(
    (date: Date) => {
      if (activeBoundary === "from") {
        if (!range?.to) {
          setRange({ from: date })
          setActiveBoundary("to")
          return
        }
        if (isLocalDayAfter(date, range.to)) {
          commitRange({ from: range.to, to: date })
          setActiveBoundary("to")
          return
        }
        commitRange({ from: date, to: range.to })
        return
      }

      if (!range?.from) {
        setRange({ from: undefined, to: date })
        setActiveBoundary("from")
        return
      }
      if (isLocalDayBefore(date, range.from)) {
        commitRange({ from: date, to: range.from })
        setActiveBoundary("from")
        return
      }
      commitRange({ from: range.from, to: date })
    },
    [activeBoundary, commitRange, range]
  )

  const selectRecentRange = React.useCallback(
    (days: number) => {
      const nextRange = recentRange(days)
      commitRange(nextRange)
      setVisibleWeekStart(dateRangeDisplayWeek(nextRange, maximumDate))
    },
    [commitRange, maximumDate]
  )

  const reset = React.useCallback(() => {
    setRange(undefined)
    setActiveBoundary("from")
    setVisibleWeekStart(dateRangeDisplayWeek(undefined, maximumDate))
    onChange({ from: undefined, to: undefined })
  }, [maximumDate, onChange])

  return (
    <Popover open={open} onOpenChange={updateOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          data-empty={!from && !to}
          className="justify-start font-normal data-[empty=true]:text-muted-foreground"
        >
          <CalendarDays />
          <span className="max-w-44 truncate" suppressHydrationWarning>
            {dateRangeLabel(from, to)}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[17rem] max-w-[calc(100vw-1.5rem)] overflow-hidden p-0"
      >
        <div className="grid grid-cols-2 border-b bg-background/20">
          <ActivityDateBoundaryButton
            boundary="from"
            active={activeBoundary === "from"}
            date={range?.from}
            onSelect={setActiveBoundary}
          />
          <ActivityDateBoundaryButton
            boundary="to"
            active={activeBoundary === "to"}
            date={range?.to}
            onSelect={setActiveBoundary}
          />
        </div>

        <ActivityWeekCalendar
          calendarRef={setCalendarRef}
          maximumDate={maximumDate}
          range={range}
          visibleWeekStart={visibleWeekStart}
          onSelectDay={selectDay}
          onShiftMonths={shiftMonths}
        />

        <div className="flex items-center gap-1.5 border-t bg-background/30 p-2">
          {[7, 30, 90].map((days) => (
            <Button
              key={days}
              type="button"
              variant="outline"
              size="xs"
              aria-pressed={dateRangeMatchesRecent(range, days)}
              className="font-mono text-[9px] tracking-[0.04em] aria-pressed:border-primary/30 aria-pressed:bg-primary/10 aria-pressed:text-primary"
              onClick={() => selectRecentRange(days)}
            >
              {days} days
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto text-muted-foreground"
            onClick={reset}
          >
            Reset
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
})

const ActivityDateBoundaryButton = React.memo(
  function ActivityDateBoundaryButton({
    active,
    boundary,
    date,
    onSelect,
  }: {
    active: boolean
    boundary: ActivityDateBoundary
    date?: Date
    onSelect: (boundary: ActivityDateBoundary) => void
  }) {
    const label = boundary === "from" ? "Start" : "End"
    return (
      <button
        type="button"
        aria-pressed={active}
        className="relative min-w-0 border-l border-border/65 px-3 py-2.5 text-left first:border-l-0 hover:bg-accent/35"
        onClick={() => onSelect(boundary)}
      >
        <span className="block font-mono text-[8px] tracking-[0.08em] text-muted-foreground uppercase">
          {label}
        </span>
        <span className="mt-1 block truncate text-xs font-medium text-foreground">
          {date ? formatShortDate(date) : "Choose date"}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-x-3 bottom-0 h-px bg-primary transition-opacity",
            active ? "opacity-100" : "opacity-0"
          )}
        />
      </button>
    )
  }
)

const ActivityWeekCalendar = React.memo(function ActivityWeekCalendar({
  calendarRef,
  maximumDate,
  range,
  visibleWeekStart,
  onSelectDay,
  onShiftMonths,
}: {
  calendarRef: React.RefCallback<HTMLDivElement>
  maximumDate: Date
  range: ActivityDateRangeValue
  visibleWeekStart: Date
  onSelectDay: (date: Date) => void
  onShiftMonths: (offset: number) => void
}) {
  const days = React.useMemo(
    () => localCalendarDays(visibleWeekStart, 42),
    [visibleWeekStart]
  )
  const displayMonth = React.useMemo(() => mostVisibleMonth(days), [days])
  const maximumWeekStart = React.useMemo(
    () => startOfLocalWeek(startOfLocalMonth(maximumDate)),
    [maximumDate]
  )
  const today = React.useMemo(() => new Date(), [])

  return (
    <div
      ref={calendarRef}
      role="group"
      className="touch-pan-y overscroll-contain px-2 pt-1.5 pb-2 sm:pt-2 sm:pb-2.5"
      aria-label="Date range calendar. Scroll to move by week."
    >
      <div className="flex h-7 items-center justify-between sm:h-8">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Show previous month"
          onClick={() => onShiftMonths(-1)}
        >
          <ChevronLeft />
        </Button>
        <span
          role="status"
          aria-live="polite"
          className="font-mono text-[11px] font-semibold tracking-[0.04em]"
        >
          {activityCalendarMonth.format(displayMonth)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Show next month"
          disabled={visibleWeekStart >= maximumWeekStart}
          onClick={() => onShiftMonths(1)}
        >
          <ChevronRight />
        </Button>
      </div>

      <div
        aria-hidden="true"
        className="mt-1 mb-1.5 grid grid-cols-7 text-center"
      >
        {activityCalendarWeekdays.map((weekday) => (
          <span
            key={weekday}
            className="font-mono text-[9px] font-medium tracking-[0.08em] text-muted-foreground"
          >
            {weekday}
          </span>
        ))}
      </div>

      <div
        role="grid"
        aria-label={activityCalendarMonth.format(displayMonth)}
        className="grid grid-cols-7 gap-y-0.5 overflow-hidden sm:gap-y-1"
      >
        {days.map((date) => {
          const disabled = isLocalDayAfter(date, maximumDate)
          const selectedStart = isSameLocalDay(date, range?.from)
          const selectedEnd = isSameLocalDay(date, range?.to)
          const selectedMiddle = isLocalDayWithinRange(date, range)
          const outside =
            date.getMonth() !== displayMonth.getMonth() ||
            date.getFullYear() !== displayMonth.getFullYear()
          const isToday = isSameLocalDay(date, today)
          return (
            <button
              key={date.getTime()}
              type="button"
              role="gridcell"
              aria-label={activityCalendarDay.format(date)}
              aria-selected={selectedStart || selectedEnd || selectedMiddle}
              disabled={disabled}
              className={cn(
                "relative isolate grid h-7 min-w-0 place-items-center border border-transparent font-mono text-[10px] font-medium transition-colors outline-none focus-visible:z-10 focus-visible:border-ring/75 focus-visible:ring-2 focus-visible:ring-ring/40 sm:h-8",
                "hover:bg-accent/70 hover:text-foreground",
                outside && "text-muted-foreground/35",
                isToday && "border-primary/45",
                selectedMiddle && "bg-primary/10 text-foreground",
                (selectedStart || selectedEnd) &&
                  "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                disabled &&
                  "pointer-events-none text-muted-foreground/20 opacity-50"
              )}
              onClick={() => onSelectDay(date)}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
})

function ActivityStatus({ data }: { data: ActivityData }) {
  const unavailable = data.relays.filter((relay) => relay.unavailable)
  if (unavailable.length === 0 && data.truncatedRelayIds.length === 0) {
    return null
  }
  return (
    <div
      role="status"
      className="border-b border-primary/15 bg-primary/6 px-3 py-2 font-mono text-[9px] leading-relaxed text-muted-foreground"
    >
      {unavailable.length > 0
        ? `Could not reach ${unavailable.map((relay) => relay.name).join(", ")}. `
        : ""}
      {data.truncatedRelayIds.length > 0
        ? "A Relay reached the 2,000-event range limit; narrow the date range for complete results."
        : ""}
    </div>
  )
}

function ActivityResults({
  entries,
  filtered,
}: {
  entries: Array<ActivityEntry>
  filtered: boolean
}) {
  const parentRef = React.useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    estimateSize: () => 64,
    getScrollElement: () => parentRef.current,
    getItemKey: (index) => entries[index]?.id ?? index,
    overscan: 14,
  })

  if (entries.length === 0) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-8 text-center">
        <div>
          <span className="mx-auto mb-3 grid size-10 place-items-center border border-border bg-muted/35 text-muted-foreground">
            <FileClock className="size-4" />
          </span>
          <p className="text-sm font-medium">
            {filtered ? "No activity matches these filters" : "No activity yet"}
          </p>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
            {filtered
              ? "Clear a filter or choose a wider date range."
              : "Tracked Relay actions will appear here as they happen."}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 z-10 grid h-8 grid-cols-[5.5rem_minmax(0,1fr)] items-center border-b bg-card/95 px-3 font-mono text-[8px] tracking-[0.12em] text-muted-foreground uppercase backdrop-blur md:grid-cols-[7rem_minmax(8rem,11rem)_minmax(8rem,10rem)_minmax(12rem,1fr)] lg:grid-cols-[8rem_minmax(10rem,14rem)_minmax(9rem,12rem)_minmax(15rem,1fr)]"
      >
        <span>Time</span>
        <span className="hidden md:block">Where</span>
        <span className="hidden md:block">User</span>
        <span>Action</span>
      </div>
      <div
        ref={parentRef}
        role="feed"
        aria-label="Activity history"
        className="absolute inset-0 overflow-y-auto overscroll-contain pt-8"
      >
        <div
          className="relative w-full"
          style={{
            height: `${
              rowVirtualizer.getTotalSize() + activityTableBottomPadding
            }px`,
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const entry = entries[virtualRow.index]
            if (!entry) return null
            return (
              <ActivityRow
                key={entry.id}
                entry={entry}
                index={virtualRow.index}
                measureElement={rowVirtualizer.measureElement}
                start={virtualRow.start}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

const ActivityRow = React.memo(function ActivityRow({
  entry,
  index,
  measureElement,
  start,
}: {
  entry: ActivityEntry
  index: number
  measureElement: (node: Element | null) => void
  start: number
}) {
  const details = typeDetails[entry.type]
  const Icon = details.icon
  const date = new Date(entry.occurredAt)

  return (
    <article
      ref={measureElement}
      data-index={index}
      className="absolute top-0 left-0 grid w-full grid-cols-[5.5rem_minmax(0,1fr)] items-center border-b border-border/65 px-3 py-2.5 transition-colors hover:bg-accent/18 md:grid-cols-[7rem_minmax(8rem,11rem)_minmax(8rem,10rem)_minmax(12rem,1fr)] lg:grid-cols-[8rem_minmax(10rem,14rem)_minmax(9rem,12rem)_minmax(15rem,1fr)]"
      style={{ transform: `translateY(${start}px)` }}
    >
      <time
        dateTime={date.toISOString()}
        className="pr-2 font-mono text-[9px] leading-4 text-muted-foreground"
      >
        <span className="block md:hidden" suppressHydrationWarning>
          {activityDay.format(date)}
        </span>
        <span suppressHydrationWarning>{activityTime.format(date)}</span>
        <span className="hidden md:block" suppressHydrationWarning>
          {activityDay.format(date)}
        </span>
      </time>

      <div className="hidden min-w-0 pr-3 md:block">
        <ActivityWhereLink entry={entry} />
        <p className="truncate font-mono text-[8px] text-muted-foreground">
          {entry.server ? entry.relay.name : "Relay-wide"}
        </p>
      </div>

      <div className="hidden min-w-0 pr-3 md:block">
        <p className="truncate text-[11px] font-medium">{entry.actor.name}</p>
        <p className="truncate font-mono text-[8px] text-muted-foreground">
          {entry.source === "cli" ? "CLI · " : ""}
          {entry.actor.email ?? "service activity"}
        </p>
      </div>

      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center border border-primary/18 bg-primary/7 text-primary/85">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground/95">
            {entry.label}
          </p>
          <p className="mt-1 truncate font-mono text-[8px] text-primary/80">
            <span className="tracking-[0.06em] uppercase">{details.label}</span>
            {entry.permission ? (
              <>
                <span aria-hidden="true" className="px-1 text-muted-foreground">
                  /
                </span>
                <code className="text-muted-foreground">
                  {entry.permission}
                </code>
              </>
            ) : null}
          </p>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-[8px] tracking-[0.05em] text-muted-foreground uppercase md:hidden">
            <ActivityWhereLink entry={entry} compact />
            <span aria-hidden="true">·</span>
            <span className="truncate">{entry.actor.name}</span>
          </div>
        </div>
      </div>
    </article>
  )
})

function ActivityWhereLink({
  compact = false,
  entry,
}: {
  compact?: boolean
  entry: ActivityEntry
}) {
  const className = compact
    ? "min-w-0 truncate text-muted-foreground hover:text-primary"
    : "block truncate text-[11px] font-medium hover:text-primary"

  if (entry.server) {
    return (
      <Link
        to="/server/$serverId/console"
        params={{
          serverId: relayInstanceRouteId(
            entry.relay.id,
            entry.server.id.slice(0, 8)
          ),
        }}
        preload="intent"
        className={className}
        aria-label={`Open ${entry.server.name}`}
      >
        {entry.server.name}
      </Link>
    )
  }

  return (
    <Link
      to="/infra/servers"
      search={{ search: entry.relay.name }}
      preload="intent"
      className={className}
      aria-label={`View servers on ${entry.relay.name}`}
    >
      {entry.relay.name}
    </Link>
  )
}

function activityActors(data: ActivityData): Array<ActivityEntry["actor"]> {
  return [
    ...new Map(
      data.entries.map((entry) => [entry.actor.id, entry.actor])
    ).values(),
  ].sort((left, right) => left.name.localeCompare(right.name))
}

function filterActivity(
  entries: Array<ActivityEntry>,
  filters: ActivityFilters,
  query: string
): Array<ActivityEntry> {
  const normalized = query.trim().toLowerCase()
  return entries.filter((entry) => {
    if (filters.type && entry.type !== filters.type) return false
    if (filters.user && entry.actor.id !== filters.user) return false
    if (filters.relay && entry.relay.id !== filters.relay) return false
    if (filters.server && entry.server?.id !== filters.server) return false
    if (filters.source && entry.source !== filters.source) return false
    if (!normalized) return true
    return [
      entry.label,
      entry.rawEvent,
      entry.actor.name,
      entry.actor.email,
      entry.relay.name,
      entry.server?.name,
      entry.server?.id,
    ].some((value) => value?.toLowerCase().includes(normalized))
  })
}

function selectedDateRange(
  from?: string,
  to?: string
): { from: Date | undefined; to?: Date } | undefined {
  if (!from && !to) return undefined
  return {
    from: from ? new Date(from) : undefined,
    ...(to ? { to: new Date(to) } : {}),
  }
}

function startOfLocalMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth())
}

function startOfLocalWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  start.setDate(start.getDate() - start.getDay())
  return start
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function dateRangeDisplayWeek(
  range: ActivityDateRangeValue,
  fallback: Date
): Date {
  return startOfLocalWeek(
    startOfLocalMonth(range?.to ?? range?.from ?? fallback)
  )
}

function localCalendarDays(start: Date, count: number): Array<Date> {
  return Array.from({ length: count }, (_, index) => addLocalDays(start, index))
}

function mostVisibleMonth(days: Array<Date>): Date {
  const middle = days[Math.floor(days.length / 2)] ?? new Date()
  const middleMonth = startOfLocalMonth(middle)
  const counts = new Map<number, { count: number; month: Date }>()

  for (const day of days) {
    const month = startOfLocalMonth(day)
    const key = month.getFullYear() * 12 + month.getMonth()
    const current = counts.get(key)
    counts.set(key, { count: (current?.count ?? 0) + 1, month })
  }

  let visible = { count: 0, month: middleMonth }
  for (const candidate of counts.values()) {
    const candidateIsMiddle = isSameLocalMonth(candidate.month, middleMonth)
    const visibleIsMiddle = isSameLocalMonth(visible.month, middleMonth)
    if (
      candidate.count > visible.count ||
      (candidate.count === visible.count &&
        candidateIsMiddle &&
        !visibleIsMiddle)
    ) {
      visible = candidate
    }
  }
  return visible.month
}

function dateRangeMatchesRecent(
  range: { from: Date | undefined; to?: Date } | undefined,
  days: number
): boolean {
  if (!range?.from || !range.to) return false
  const recent = recentRange(days)
  return (
    isSameLocalDay(range.from, recent.from) &&
    isSameLocalDay(range.to, recent.to)
  )
}

function isSameLocalDay(left: Date, right?: Date): boolean {
  if (!right) return false
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function isSameLocalMonth(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth()
  )
}

function localDayValue(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function isLocalDayAfter(left: Date, right: Date): boolean {
  return localDayValue(left) > localDayValue(right)
}

function isLocalDayBefore(left: Date, right: Date): boolean {
  return localDayValue(left) < localDayValue(right)
}

function isLocalDayWithinRange(
  date: Date,
  range: ActivityDateRangeValue
): boolean {
  if (!range?.from || !range.to) return false
  const value = localDayValue(date)
  return value > localDayValue(range.from) && value < localDayValue(range.to)
}

function formatShortDate(date: Date): string {
  return activityShortDate.format(date)
}

function dateRangeLabel(from?: string, to?: string): string {
  if (!from && !to) return "All time"
  if (from && to) {
    return `${formatShortDate(new Date(from))} – ${formatShortDate(new Date(to))}`
  }
  return from
    ? `From ${formatShortDate(new Date(from))}`
    : `Through ${formatShortDate(new Date(to ?? ""))}`
}

function recentRange(days: number): { from: Date; to: Date } {
  const to = new Date()
  to.setHours(12, 0, 0, 0)
  const from = new Date(to)
  from.setDate(to.getDate() - (days - 1))
  return { from, to }
}
