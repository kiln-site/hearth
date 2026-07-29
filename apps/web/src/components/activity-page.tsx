import * as React from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  CalendarDays,
  ChevronDown,
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
  ShieldCheck,
  TerminalSquare,
  UserRound,
  X,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Calendar } from "@workspace/ui/components/calendar"
import { Input } from "@workspace/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"

import { activityTypes, isActivityType } from "@/lib/activity"
import type { ActivityType } from "@/lib/activity"
import { activityQueryOptions } from "@/lib/query-options"
import type { ActivityData, ActivityEntry } from "@/server/activity"

export interface ActivityFilters {
  from?: string
  q?: string
  relay?: string
  server?: string
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

const activityTimestamp = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "short",
  second: "2-digit",
  timeZone: "UTC",
})

const activityDay = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
})

export const ActivityPage = React.memo(function ActivityPage({
  filters,
  onFiltersChange,
}: ActivityPageProps) {
  const { data } = useSuspenseQuery(
    activityQueryOptions(filters.from, filters.to)
  )
  const [search, setSearch] = React.useState(filters.q ?? "")
  const deferredSearch = React.useDeferredValue(search)
  const searchTimer = React.useRef<number>(undefined)

  React.useEffect(() => {
    setSearch(filters.q ?? "")
  }, [filters.q])

  React.useEffect(
    () => () => {
      if (searchTimer.current !== undefined) {
        window.clearTimeout(searchTimer.current)
      }
    },
    []
  )

  const actors = React.useMemo(() => activityActors(data), [data])
  const entries = React.useMemo(
    () => filterActivity(data.entries, filters, deferredSearch),
    [data.entries, deferredSearch, filters]
  )
  const activeFilterCount = [
    filters.q,
    filters.type,
    filters.user,
    filters.relay,
    filters.server,
    filters.from,
    filters.to,
  ].filter(Boolean).length

  const updateSearch = React.useCallback(
    (value: string) => {
      setSearch(value)
      if (searchTimer.current !== undefined) {
        window.clearTimeout(searchTimer.current)
      }
      searchTimer.current = window.setTimeout(() => {
        onFiltersChange({ q: value.trim() || undefined })
      }, 180)
    },
    [onFiltersChange]
  )

  return (
    <div className="mx-auto flex h-[calc(100dvh-5.75rem)] min-h-[34rem] w-full max-w-[90rem] flex-col px-3 pb-3 sm:px-5 sm:pb-5">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card/45 [contain:paint]">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-background/35 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center border border-primary/25 bg-primary/8 text-primary">
              <ShieldCheck className="size-4" />
            </span>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold tracking-[-0.01em]">
                Audit trail
              </h1>
              <p className="truncate font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
                Permission-scoped · newest first · UTC
              </p>
            </div>
          </div>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {entries.length.toLocaleString()} of{" "}
            {data.entries.length.toLocaleString()} events
          </span>
        </header>

        <ActivityFiltersToolbar
          actors={actors}
          data={data}
          filters={filters}
          search={search}
          activeFilterCount={activeFilterCount}
          onFiltersChange={onFiltersChange}
          onSearchChange={updateSearch}
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
  search,
  onFiltersChange,
  onSearchChange,
}: {
  activeFilterCount: number
  actors: Array<ActivityEntry["actor"]>
  data: ActivityData
  filters: ActivityFilters
  search: string
  onFiltersChange: (change: Partial<ActivityFilters>) => void
  onSearchChange: (value: string) => void
}) {
  const relayNameById = React.useMemo(
    () => new Map(data.relays.map((relay) => [relay.id, relay.name])),
    [data.relays]
  )
  const servers = filters.relay
    ? data.servers.filter((server) => server.relayId === filters.relay)
    : data.servers

  return (
    <div className="border-b bg-background/15 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            placeholder="Search actions, people, servers…"
            aria-label="Search activity"
            className="pr-8 pl-9 text-base md:text-sm"
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear activity search"
              className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground"
              onClick={() => onSearchChange("")}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

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

        <ActivitySelect
          ariaLabel="Filter activity by server"
          icon={<Server />}
          value={filters.server ?? ""}
          onChange={(value) => onFiltersChange({ server: value || undefined })}
        >
          <option value="">All servers</option>
          {servers.map((server) => (
            <option key={`${server.relayId}:${server.id}`} value={server.id}>
              {server.name}
              {data.relays.length > 1
                ? ` · ${relayNameById.get(server.relayId) ?? "Relay"}`
                : ""}
            </option>
          ))}
        </ActivitySelect>

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

const ActivityDateRange = React.memo(function ActivityDateRange({
  from,
  to,
  onChange,
}: {
  from?: string
  to?: string
  onChange: (range: Pick<ActivityFilters, "from" | "to">) => void
}) {
  const isMobile = useIsMobile()
  const [open, setOpen] = React.useState(false)
  const [range, setRange] = React.useState<
    { from: Date | undefined; to?: Date } | undefined
  >(() => selectedDateRange(from, to))

  React.useEffect(() => {
    if (!open) setRange(selectedDateRange(from, to))
  }, [from, open, to])

  const apply = React.useCallback(() => {
    if (!range?.from || !range.to) return
    setOpen(false)
    onChange({
      from: formatDateValue(range.from),
      to: formatDateValue(range.to),
    })
  }, [onChange, range])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          data-empty={!from && !to}
          className="justify-start font-normal data-[empty=true]:text-muted-foreground"
        >
          <CalendarDays />
          <span className="max-w-44 truncate">{dateRangeLabel(from, to)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-auto max-w-[calc(100vw-1.5rem)] overflow-auto p-0"
      >
        <div className="flex flex-col sm:flex-row">
          <div className="grid shrink-0 grid-cols-3 gap-px border-b bg-border/70 p-px sm:w-32 sm:grid-cols-1 sm:border-r sm:border-b-0">
            {[7, 30, 90].map((days) => (
              <button
                key={days}
                type="button"
                className="bg-popover px-3 py-2 text-left font-mono text-[9px] tracking-[0.06em] text-muted-foreground uppercase hover:bg-accent hover:text-foreground"
                onClick={() => setRange(recentRange(days))}
              >
                {days} days
              </button>
            ))}
          </div>
          <Calendar
            mode="range"
            defaultMonth={range?.from}
            selected={range}
            onSelect={setRange}
            numberOfMonths={isMobile ? 1 : 2}
            disabled={{ after: new Date() }}
          />
        </div>
        <div className="flex items-center justify-between gap-3 border-t bg-background/30 p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setRange(undefined)
              setOpen(false)
              onChange({ from: undefined, to: undefined })
            }}
          >
            All time
          </Button>
          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-[9px] text-muted-foreground sm:inline">
              {range?.from && range.to
                ? `${formatShortDate(range.from)} → ${formatShortDate(range.to)}`
                : "Select a start and end"}
            </span>
            <Button
              type="button"
              size="sm"
              disabled={!range?.from || !range.to}
              onClick={apply}
            >
              Apply range
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
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
        className="absolute inset-x-0 top-0 z-10 grid h-8 grid-cols-[5.5rem_minmax(0,1fr)] items-center border-b bg-card/95 px-3 font-mono text-[8px] tracking-[0.12em] text-muted-foreground uppercase backdrop-blur md:grid-cols-[8.5rem_minmax(0,1fr)_10rem] lg:grid-cols-[9rem_minmax(0,1fr)_minmax(10rem,14rem)_minmax(9rem,12rem)]"
      >
        <span>Time · UTC</span>
        <span>Activity</span>
        <span className="hidden lg:block">Context</span>
        <span className="hidden md:block">User</span>
      </div>
      <div
        ref={parentRef}
        role="feed"
        aria-label="Activity history"
        className="absolute inset-0 overflow-y-auto overscroll-contain pt-8"
      >
        <div
          className="relative w-full"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
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
      className="absolute top-0 left-0 grid w-full grid-cols-[5.5rem_minmax(0,1fr)] items-center border-b border-border/65 px-3 py-2.5 transition-colors hover:bg-accent/18 md:grid-cols-[8.5rem_minmax(0,1fr)_10rem] lg:grid-cols-[9rem_minmax(0,1fr)_minmax(10rem,14rem)_minmax(9rem,12rem)]"
      style={{ transform: `translateY(${start}px)` }}
    >
      <time
        dateTime={date.toISOString()}
        className="pr-2 font-mono text-[9px] leading-4 text-muted-foreground"
      >
        <span className="block md:hidden">{activityDay.format(date)}</span>
        <span>{activityTimestamp.format(date).split(", ").at(-1)}</span>
        <span className="hidden md:block">
          {activityTimestamp.format(date).split(", ").at(0)}
        </span>
      </time>

      <div className="flex min-w-0 items-start gap-2.5 pr-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center border border-primary/18 bg-primary/7 text-primary/85">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground/95">
            {entry.label}
          </p>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[8px] tracking-[0.05em] text-muted-foreground uppercase">
            <span>{details.label}</span>
            <span aria-hidden="true">/</span>
            <span className="truncate lg:hidden">
              {entry.server?.name ?? entry.relay.name}
            </span>
            <span className="truncate md:hidden">· {entry.actor.name}</span>
          </div>
        </div>
      </div>

      <div className="hidden min-w-0 pr-3 lg:block">
        <p className="truncate text-[11px] font-medium">
          {entry.server?.name ?? entry.relay.name}
        </p>
        <p className="truncate font-mono text-[8px] text-muted-foreground">
          {entry.server ? entry.relay.name : "Relay-wide"}
        </p>
      </div>

      <div className="hidden min-w-0 md:block">
        <p className="truncate text-[11px] font-medium">{entry.actor.name}</p>
        <p className="truncate font-mono text-[8px] text-muted-foreground">
          {entry.actor.email ?? "service activity"}
        </p>
      </div>
    </article>
  )
})

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
    from: from ? parseDateValue(from) : undefined,
    ...(to ? { to: parseDateValue(to) } : {}),
  }
}

function parseDateValue(value: string): Date {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12)
}

function formatDateValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date)
}

function dateRangeLabel(from?: string, to?: string): string {
  if (!from && !to) return "All time"
  if (from && to) {
    return `${formatShortDate(parseDateValue(from))} – ${formatShortDate(parseDateValue(to))}`
  }
  return from
    ? `From ${formatShortDate(parseDateValue(from))}`
    : `Through ${formatShortDate(parseDateValue(to ?? ""))}`
}

function recentRange(days: number): { from: Date; to: Date } {
  const to = new Date()
  to.setHours(12, 0, 0, 0)
  const from = new Date(to)
  from.setDate(to.getDate() - (days - 1))
  return { from, to }
}
