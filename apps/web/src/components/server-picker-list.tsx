import * as React from "react"
import {
  Check,
  Database,
  LoaderCircle,
  Network,
  Search,
  Server,
} from "lucide-react"

import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

export interface ServerPickerOption {
  description?: string
  disabled?: boolean
  id: string
  kind?: "database" | "relay" | "server"
  name: string
  relayId: string
  relayName: string
}

interface ServerPickerAllOption {
  description: string
  label: string
  onSelect: () => void
  selected: boolean
}

export const serverPickerOptionKey = (server: ServerPickerOption) =>
  server.kind
    ? `${server.kind}:${server.relayId}:${server.id}`
    : `${server.relayId}:${server.id}`

export const ServerPickerList = React.memo(function ServerPickerList({
  allOption,
  ariaLabel = "Accessible servers",
  emptyMessage = "No accessible servers found.",
  multiple,
  onSelect,
  pendingKey,
  searchPlaceholder = "Search by name, Relay, or ID",
  selectedKeys,
  servers,
}: {
  allOption?: ServerPickerAllOption
  ariaLabel?: string
  emptyMessage?: string
  multiple?: boolean
  onSelect: (server: ServerPickerOption) => void
  pendingKey?: string
  searchPlaceholder?: string
  selectedKeys: ReadonlySet<string>
  servers: ReadonlyArray<ServerPickerOption>
}) {
  const [query, setQuery] = React.useState("")
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleServers = React.useMemo(
    () =>
      normalizedQuery
        ? servers.filter((server) =>
            `${server.name} ${server.id} ${server.relayName}`
              .toLocaleLowerCase()
              .includes(normalizedQuery)
          )
        : servers,
    [normalizedQuery, servers]
  )

  return (
    <>
      <div className="relative mb-1.5">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          aria-label={`Search ${ariaLabel.toLocaleLowerCase()}`}
          className="h-8 pl-8"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <div
        role="listbox"
        aria-label={ariaLabel}
        aria-multiselectable={(multiple ?? !allOption) ? true : undefined}
        className="no-scrollbar max-h-72 space-y-0.5 overflow-y-auto overscroll-contain"
      >
        {allOption && normalizedQuery.length === 0 ? (
          <ServerPickerRow
            description={allOption.description}
            name={allOption.label}
            selected={allOption.selected}
            onSelect={allOption.onSelect}
          />
        ) : null}

        {visibleServers.map((server) => {
          const key = serverPickerOptionKey(server)
          return (
            <ServerPickerRow
              key={key}
              description={
                server.description ?? `${server.relayName} · ${server.id}`
              }
              disabled={server.disabled || pendingKey !== undefined}
              kind={server.kind}
              name={server.name}
              pending={pendingKey === key}
              selected={selectedKeys.has(key)}
              onSelect={() => onSelect(server)}
            />
          )
        })}

        {visibleServers.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {emptyMessage}
          </p>
        ) : null}
      </div>
    </>
  )
})

const ServerPickerRow = React.memo(function ServerPickerRow({
  description,
  disabled = false,
  kind = "server",
  name,
  onSelect,
  pending = false,
  selected,
}: {
  description: string
  disabled?: boolean
  kind?: "database" | "relay" | "server"
  name: string
  onSelect: () => void
  pending?: boolean
  selected: boolean
}) {
  return (
    <button
      type="button"
      role="option"
      aria-busy={pending}
      aria-selected={selected}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "bg-primary/14 ring-1 ring-primary/35" : "hover:bg-accent/55"
      )}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border/70 bg-background/70 text-muted-foreground">
        {kind === "relay" ? (
          <Network className="size-4" />
        ) : kind === "database" ? (
          <Database className="size-4" />
        ) : (
          <Server className="size-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold tracking-tight">
          {name}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {description}
        </span>
      </span>
      {pending ? (
        <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" />
      ) : selected ? (
        <Check className="size-4 shrink-0 text-primary" />
      ) : null}
    </button>
  )
})
