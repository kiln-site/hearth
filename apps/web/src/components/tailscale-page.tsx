import * as React from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import {
  Check,
  CircleAlert,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Save,
  Search,
  Server,
  ShieldCheck,
} from "lucide-react"
import type {
  RelayTailscaleOverview,
  RelayTailscaleSettings,
} from "@workspace/contracts"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

import { ServerTypeIcon } from "@/components/server-type-icon"
import type { FleetRelayInstance, RelayFleetSnapshot } from "@/lib/relay-fleet"
import type { PersistedRelay } from "@/lib/relay-registry"
import {
  queryKeys,
  relaysQueryOptions,
  relaySnapshotQueryOptions,
  relayTailscaleQueryOptions,
  replaceRelaySnapshotInstance,
} from "@/lib/query-options"
import { updateInstanceTailscale } from "@/server/bricks"
import { installRelayTailscale, updateRelayTailscale } from "@/server/relays"

export const TailscalePage = React.memo(function TailscalePage() {
  const { data: relays } = useSuspenseQuery(relaysQueryOptions())
  const availableRelays = React.useMemo(
    () => relays.filter((relay) => relay.enabled),
    [relays]
  )
  const [selectedRelayId, setSelectedRelayId] = React.useState(
    () => availableRelays[0]?.id ?? ""
  )
  const [selectedServerId, setSelectedServerId] = React.useState("")
  const selectedRelay =
    availableRelays.find((relay) => relay.id === selectedRelayId) ??
    availableRelays[0]

  const selectRelay = React.useCallback((relayId: string) => {
    setSelectedRelayId(relayId)
    setSelectedServerId("")
  }, [])
  const selectServer = React.useCallback((serverId: string) => {
    setSelectedServerId(serverId)
  }, [])

  if (!selectedRelay) {
    return (
      <main className="mx-auto w-full max-w-6xl px-3 pb-10 sm:px-5">
        <div className="rounded-xl border border-dashed bg-card/45 px-6 py-14 text-center">
          <Server className="mx-auto size-5 text-muted-foreground" />
          <h1 className="mt-3 font-heading text-lg font-semibold">
            No active nodes
          </h1>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-3 pb-10 sm:px-5">
      <div className="grid min-h-[36rem] overflow-hidden rounded-xl border border-border/70 bg-background/35 max-md:overflow-y-auto md:h-[min(42rem,calc(100dvh-12rem))] md:min-h-0 md:grid-cols-[10.5rem_minmax(0,1fr)_20rem] lg:grid-cols-[11.5rem_minmax(0,1fr)_21rem]">
        <RelaySelector
          relays={availableRelays}
          selectedRelay={selectedRelay}
          onSelect={selectRelay}
        />
        <ServerSelector
          relayId={selectedRelay.id}
          selectedServerId={selectedServerId}
          onSelect={selectServer}
        />
        <TailscaleServerDetails
          relayId={selectedRelay.id}
          serverId={selectedServerId}
        />
      </div>
    </main>
  )
})

const RelaySelector = React.memo(function RelaySelector({
  relays,
  selectedRelay,
  onSelect,
}: {
  relays: Array<PersistedRelay>
  selectedRelay: PersistedRelay
  onSelect: (relayId: string) => void
}) {
  return (
    <aside className="flex min-h-0 flex-col border-b border-border/60 md:border-r md:border-b-0">
      <p className="px-3 pt-3 pb-2 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
        Relays
      </p>
      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-y-auto md:pb-3">
        {relays.map((relay) => {
          const selected = relay.id === selectedRelay.id
          return (
            <button
              key={relay.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(relay.id)}
              className={cn(
                "relative shrink-0 rounded-md px-2.5 py-2 text-left text-xs transition-colors duration-150",
                selected
                  ? "bg-primary/12 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/55 hover:text-foreground"
              )}
            >
              {selected ? (
                <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary" />
              ) : null}
              <span className={cn("block truncate", selected && "pl-1.5")}>
                {relay.name}
              </span>
            </button>
          )
        })}
      </nav>
      <div className="mt-auto border-t border-border/60 p-2">
        <TailscaleSetupDialog relay={selectedRelay} />
      </div>
    </aside>
  )
})

const ServerSelector = React.memo(function ServerSelector({
  relayId,
  selectedServerId,
  onSelect,
}: {
  relayId: string
  selectedServerId: string
  onSelect: (serverId: string) => void
}) {
  const [query, setQuery] = React.useState("")
  const selectServers = React.useCallback(
    (snapshot: RelayFleetSnapshot): Array<TailscaleServerView> => {
      const selected: Array<TailscaleServerView> = []
      for (const instance of snapshot.instances) {
        if (instance.relayId === relayId) {
          selected.push(selectTailscaleServer(instance))
        }
      }
      return selected
    },
    [relayId]
  )
  const { data: servers = emptyTailscaleServers, status } = useQuery({
    ...relaySnapshotQueryOptions(),
    notifyOnChangeProps: ["data", "status"],
    select: selectServers,
  })
  const visibleServers = React.useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return servers
    return servers.filter((server) =>
      [
        server.name,
        server.id,
        server.shortId,
        server.game,
        server.implementation,
        server.version,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    )
  }, [query, servers])
  const effectiveServerId = servers.some(
    (server) => server.id === selectedServerId
  )
    ? selectedServerId
    : (servers[0]?.id ?? "")

  return (
    <section className="flex min-h-80 min-w-0 flex-col border-b border-border/60 md:min-h-0 md:border-r md:border-b-0">
      <div className="border-b border-border/60 p-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search servers…"
            aria-label="Search servers"
            className="h-9 pl-8 text-base md:text-sm"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {status === "pending" ? (
          <div className="grid h-full min-h-48 place-items-center">
            <LoaderCircle className="size-4 animate-spin text-primary" />
          </div>
        ) : visibleServers.length === 0 ? (
          <div className="grid h-full min-h-48 place-items-center px-4 py-8 text-center">
            <div>
              <Server className="mx-auto size-5 text-muted-foreground/45" />
              <p className="mt-2 text-xs text-muted-foreground">
                {query ? "No servers match your search" : "No servers"}
              </p>
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {visibleServers.map((server) => {
              const selected = server.id === effectiveServerId
              return (
                <li key={server.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelect(server.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors duration-150",
                      selected
                        ? "bg-primary/14 ring-1 ring-primary/35"
                        : "hover:bg-accent/55"
                    )}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border/70 bg-background/70 text-muted-foreground">
                      <ServerTypeIcon
                        implementation={server.implementation}
                        className="size-4"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold tracking-tight">
                        {server.name}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                        {server.shortId} · {server.implementation}
                      </span>
                    </span>
                    {server.tailscale.enabled ? (
                      <Badge
                        variant="outline"
                        className="h-5 shrink-0 border-chart-2/35 bg-chart-2/8 px-1.5 font-mono text-[9px] text-chart-2"
                      >
                        Connected
                      </Badge>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
})

const TailscaleServerDetails = React.memo(function TailscaleServerDetails({
  relayId,
  serverId,
}: {
  relayId: string
  serverId: string
}) {
  const selectServer = React.useCallback(
    (snapshot: RelayFleetSnapshot): TailscaleServerView | null => {
      const server =
        snapshot.instances.find(
          (instance) => instance.relayId === relayId && instance.id === serverId
        ) ?? snapshot.instances.find((instance) => instance.relayId === relayId)
      return server ? selectTailscaleServer(server) : null
    },
    [relayId, serverId]
  )
  const { data: server } = useQuery({
    ...relaySnapshotQueryOptions(),
    notifyOnChangeProps: ["data"],
    select: selectServer,
  })

  if (!server) {
    return (
      <aside className="flex min-h-96 flex-col md:min-h-0">
        <div className="grid min-h-48 flex-1 place-items-center p-6 text-center">
          <p className="text-xs text-muted-foreground">
            Select a server to manage its Tailnet connection.
          </p>
        </div>
      </aside>
    )
  }

  return <SelectedServerDetails key={server.id} server={server} />
})

const SelectedServerDetails = React.memo(function SelectedServerDetails({
  server,
}: {
  server: TailscaleServerView
}) {
  const { data: network } = useQuery({
    ...relayTailscaleQueryOptions(server.relayId),
    notifyOnChangeProps: ["data"],
    select: selectTailscaleNetwork,
  })
  const tailnetIp =
    server.tailscale.enabled && network?.connected
      ? (network.ipv4Address ?? network.ipv6Address ?? "Connected")
      : "—"

  return (
    <aside className="flex min-h-96 flex-col md:min-h-0">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-border/70 bg-background/70 text-muted-foreground">
            <ServerTypeIcon
              implementation={server.implementation}
              className="size-5"
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="truncate font-heading text-lg font-semibold tracking-[-0.03em]">
                {server.name}
              </h3>
              {server.tailscale.enabled ? (
                <Badge
                  variant="outline"
                  className="h-5 border-chart-2/35 bg-chart-2/8 px-1.5 text-[9px] text-chart-2"
                >
                  Connected
                </Badge>
              ) : null}
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {server.game} · {server.implementation}
            </p>
          </div>
        </div>

        <dl className="mt-4 space-y-2.5 border-t border-border/60 pt-4 text-xs">
          <DetailItem label="Relay" value={server.relayName} />
          <DetailItem label="Short ID" value={server.shortId} mono />
          <DetailItem
            label="Software"
            value={`${server.implementation} ${server.version}`}
          />
          <DetailItem
            label="State"
            value={formatServerState(server.observedState)}
          />
          <DetailItem label="Tailnet IP" value={tailnetIp} mono />
        </dl>
      </div>

      <div className="shrink-0 border-t border-border/60 p-4">
        {network ? (
          <ServerTailscaleEditor
            key={`${server.id}:${server.tailscale.enabled}:${server.tailscale.subdomain ?? ""}:${network.hostname}:${network.domain}`}
            network={network}
            server={server}
          />
        ) : (
          <div className="py-2 text-center">
            <ShieldCheck className="mx-auto size-5 text-muted-foreground/55" />
            <p className="mt-2 text-xs font-medium">
              Tailscale is not configured
            </p>
          </div>
        )}
      </div>
    </aside>
  )
})

function DetailItem({
  label,
  mono = false,
  value,
}: {
  label: string
  mono?: boolean
  value: string
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 truncate text-right font-medium",
          mono && "font-mono text-[11px]"
        )}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}

interface TailscaleServerView {
  brickId: string | undefined
  game: string
  id: string
  implementation: string
  managedByRelay: boolean
  name: string
  observedState: FleetRelayInstance["observedState"]
  relayId: string
  relayName: string
  shortId: string
  tailscale: FleetRelayInstance["tailscale"]
  version: string
}

function selectTailscaleServer(
  server: FleetRelayInstance
): TailscaleServerView {
  return {
    brickId: server.brickId,
    game: server.game,
    id: server.id,
    implementation: server.implementation,
    managedByRelay: server.managedByRelay,
    name: server.name,
    observedState: server.observedState,
    relayId: server.relayId,
    relayName: server.relayName,
    shortId: server.shortId,
    tailscale: server.tailscale,
    version: server.version,
  }
}

const emptyTailscaleServers: Array<TailscaleServerView> = []

interface TailscaleNetworkView {
  connected: boolean
  domain: string
  hostname: string
  ipv4Address: string | null
  ipv6Address: string | null
}

function selectTailscaleNetwork(
  overview: RelayTailscaleOverview
): TailscaleNetworkView | null {
  return overview.settings
    ? {
        connected: overview.status.connected,
        domain: overview.settings.domain,
        hostname: overview.settings.hostname,
        ipv4Address: overview.status.ipv4Address,
        ipv6Address: overview.status.ipv6Address,
      }
    : null
}

interface TailscaleEditorStore {
  getEnabled: () => boolean
  getError: () => string | null
  getPending: () => boolean
  getPrefix: () => string
  getRevision: () => number
  setEnabled: (enabled: boolean) => void
  setError: (error: string | null) => void
  setPending: (pending: boolean) => void
  setPrefix: (prefix: string) => void
  subscribe: (listener: () => void) => () => void
}

function createTailscaleEditorStore({
  enabled: initialEnabled,
  prefix: initialPrefix,
}: {
  enabled: boolean
  prefix: string
}): TailscaleEditorStore {
  let enabled = initialEnabled
  let error: string | null = null
  let pending = false
  let prefix = initialPrefix
  let revision = 0
  const listeners = new Set<() => void>()
  const publish = () => {
    for (const listener of listeners) listener()
  }
  return {
    getEnabled: () => enabled,
    getError: () => error,
    getPending: () => pending,
    getPrefix: () => prefix,
    getRevision: () => revision,
    setEnabled: (nextEnabled) => {
      if (enabled === nextEnabled) return
      enabled = nextEnabled
      error = null
      revision += 1
      publish()
    },
    setError: (nextError) => {
      if (error === nextError) return
      error = nextError
      publish()
    },
    setPending: (nextPending) => {
      if (pending === nextPending) return
      pending = nextPending
      publish()
    },
    setPrefix: (nextPrefix) => {
      if (prefix === nextPrefix) return
      prefix = nextPrefix
      error = null
      revision += 1
      publish()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const ServerTailscaleEditor = React.memo(function ServerTailscaleEditor({
  network,
  server,
}: {
  network: TailscaleNetworkView
  server: TailscaleServerView
}) {
  const hostnameNamespace = `${network.hostname}.`
  const savedSubdomain = server.tailscale.subdomain ?? ""
  const initialPrefix = savedSubdomain.startsWith(hostnameNamespace)
    ? savedSubdomain.slice(hostnameNamespace.length)
    : savedSubdomain || suggestedServerPrefix(server)
  const [store] = React.useState(() =>
    createTailscaleEditorStore({
      enabled: server.tailscale.enabled,
      prefix: initialPrefix,
    })
  )

  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
        Tailscale
      </p>
      <TailscaleConnectionField
        connected={network.connected}
        editable={server.managedByRelay}
        serverName={server.name}
        store={store}
      />
      <TailscaleHostnameField
        domain={network.domain}
        editable={server.managedByRelay}
        hostname={network.hostname}
        serverName={server.name}
        store={store}
      />
      <TailscaleEditorFeedback store={store} />
      <TailscaleSaveButton network={network} server={server} store={store} />
    </div>
  )
})

const TailscaleConnectionField = React.memo(function TailscaleConnectionField({
  connected,
  editable,
  serverName,
  store,
}: {
  connected: boolean
  editable: boolean
  serverName: string
  store: TailscaleEditorStore
}) {
  const enabled = React.useSyncExternalStore(
    store.subscribe,
    store.getEnabled,
    store.getEnabled
  )
  const pending = React.useSyncExternalStore(
    store.subscribe,
    store.getPending,
    store.getPending
  )
  const disabled = pending || !editable || (!enabled && !connected)

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-background/45 px-3 py-2.5">
      <span>
        <span className="block text-xs font-medium">
          {enabled ? "Connected" : "Disconnected"}
        </span>
        {!connected && !enabled ? (
          <span className="mt-0.5 block text-[9px] text-chart-4">
            Tailnet is offline
          </span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${enabled ? "Disconnect" : "Connect"} ${serverName} from Tailscale`}
        disabled={disabled}
        onClick={() => store.setEnabled(!enabled)}
        className={cn(
          "relative h-6 w-11 rounded-full border transition-[background-color,border-color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
          enabled
            ? "border-primary bg-primary"
            : "border-input bg-muted-foreground/20"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-[18px] rounded-full bg-background shadow-sm transition-transform",
            enabled ? "translate-x-5" : "translate-x-0"
          )}
        />
      </button>
    </div>
  )
})

const TailscaleHostnameField = React.memo(function TailscaleHostnameField({
  domain,
  editable,
  hostname,
  serverName,
  store,
}: {
  domain: string
  editable: boolean
  hostname: string
  serverName: string
  store: TailscaleEditorStore
}) {
  const enabled = React.useSyncExternalStore(
    store.subscribe,
    store.getEnabled,
    store.getEnabled
  )
  const pending = React.useSyncExternalStore(
    store.subscribe,
    store.getPending,
    store.getPending
  )

  return (
    <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
      <span>Hostname</span>
      <span className="flex min-w-0">
        <span className="grid h-8 max-w-24 shrink-0 place-items-center truncate rounded-l-md border border-r-0 bg-muted/35 px-2 font-mono text-[9px]">
          {hostname}.
        </span>
        <Input
          name="hostname"
          aria-label={`Hostname for ${serverName}`}
          defaultValue={store.getPrefix()}
          onChange={(event) => store.setPrefix(event.currentTarget.value)}
          disabled={!editable || pending || !enabled}
          placeholder="1.21.11.paper"
          className="h-8 min-w-20 rounded-none font-mono text-[10px]"
        />
        <span className="grid h-8 max-w-20 shrink-0 place-items-center truncate rounded-r-md border border-l-0 bg-muted/35 px-2 font-mono text-[9px]">
          .{domain}
        </span>
      </span>
    </label>
  )
})

const TailscaleEditorFeedback = React.memo(function TailscaleEditorFeedback({
  store,
}: {
  store: TailscaleEditorStore
}) {
  const error = React.useSyncExternalStore(
    store.subscribe,
    store.getError,
    store.getError
  )
  return error ? (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
      {error}
    </div>
  ) : null
})

const TailscaleSaveButton = React.memo(function TailscaleSaveButton({
  network,
  server,
  store,
}: {
  network: TailscaleNetworkView
  server: TailscaleServerView
  store: TailscaleEditorStore
}) {
  const queryClient = useQueryClient()
  const pending = React.useSyncExternalStore(
    store.subscribe,
    store.getPending,
    store.getPending
  )
  React.useSyncExternalStore(
    store.subscribe,
    store.getRevision,
    store.getRevision
  )
  const enabled = store.getEnabled()
  const normalizedPrefix = normalizeDnsValue(store.getPrefix())
  const fullSubdomain = `${network.hostname}.${normalizedPrefix}`
  const savedSubdomain = server.tailscale.subdomain ?? ""
  const changed =
    enabled !== server.tailscale.enabled ||
    (enabled && fullSubdomain !== savedSubdomain)
  const mutation = useMutation({
    mutationFn: updateInstanceTailscale,
    onSuccess: async (updated) => {
      queryClient.setQueryData<RelayFleetSnapshot>(
        queryKeys.relay.snapshot,
        (current) =>
          replaceRelaySnapshotInstance(current, {
            ...updated,
            name: server.name,
            relayId: server.relayId,
          })
      )
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [
            "relay",
            server.relayId,
            "instances",
            server.id,
            "startup",
          ],
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.relay.snapshot }),
      ])
    },
  })

  async function save() {
    if (
      pending ||
      !changed ||
      !server.managedByRelay ||
      (enabled && (!normalizedPrefix || !network.connected))
    ) {
      return
    }
    store.setError(null)
    store.setPending(true)
    try {
      await mutation.mutateAsync({
        data: {
          enabled,
          instanceId: server.id,
          relayId: server.relayId,
          subdomain: enabled ? fullSubdomain : undefined,
        },
      })
    } catch (cause) {
      store.setError(
        cause instanceof Error ? cause.message : "Could not update this server"
      )
    } finally {
      store.setPending(false)
    }
  }

  return (
    <Button
      type="button"
      className="w-full"
      disabled={
        pending ||
        !changed ||
        !server.managedByRelay ||
        (enabled && (!normalizedPrefix || !network.connected))
      }
      onClick={() => void save()}
    >
      {pending ? (
        <LoaderCircle className="animate-spin" />
      ) : changed ? (
        <Save />
      ) : (
        <Check />
      )}
      {pending ? "Saving…" : changed ? "Save changes" : "Saved"}
    </Button>
  )
})

const TailscaleSetupDialog = React.memo(function TailscaleSetupDialog({
  relay,
}: {
  relay: PersistedRelay
}) {
  const [open, setOpen] = React.useState(false)
  const { data: setup } = useQuery({
    ...relayTailscaleQueryOptions(relay.id),
    notifyOnChangeProps: ["data"],
    select: selectTailscaleSetupView,
  })
  const installed = setup?.installed ?? false

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors duration-150 hover:bg-accent/55 hover:text-foreground"
          />
        }
      >
        <KeyRound className="size-3.5 shrink-0 text-primary" />
        {installed ? "Manage Auth Key" : "Install Tailscale"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {installed ? "Manage Auth Key" : "Install Tailscale"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Configure Tailscale for {relay.name}.
          </DialogDescription>
        </DialogHeader>
        {setup ? (
          <TailscaleSetupForm
            key={open ? "open" : "closed"}
            relay={relay}
            setup={setup}
            onComplete={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
})

interface TailscaleSetupView {
  installed: boolean
  settings: RelayTailscaleSettings | null
}

function selectTailscaleSetupView(
  overview: RelayTailscaleOverview
): TailscaleSetupView {
  return {
    installed: overview.status.installed,
    settings: overview.settings,
  }
}

const TailscaleSetupForm = React.memo(function TailscaleSetupForm({
  relay,
  setup,
  onComplete,
}: {
  relay: PersistedRelay
  setup: TailscaleSetupView
  onComplete: () => void
}) {
  const queryClient = useQueryClient()
  const [error, setError] = React.useState<string | null>(null)
  const saveMutation = useMutation({
    mutationFn: updateRelayTailscale,
    onSuccess: async (next) => {
      queryClient.setQueryData(queryKeys.tailscale(relay.id), next)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.tailscale(relay.id),
      })
    },
  })
  const installMutation = useMutation({
    mutationFn: installRelayTailscale,
    onSuccess: async (next) => {
      queryClient.setQueryData(queryKeys.tailscale(relay.id), next)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.tailscale(relay.id),
      })
    },
  })
  const pending = saveMutation.isPending || installMutation.isPending

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setError(null)

    const form = new FormData(event.currentTarget)
    const domain = String(form.get("domain") ?? "")
    const hostname = String(form.get("hostname") ?? "")
    const authKey = String(form.get("authKey") ?? "").trim()
    const normalizedDomain = normalizeDnsValue(domain)
    const normalizedHostname = normalizeDnsValue(hostname)
    if (!normalizedDomain || !normalizedHostname) {
      setError("Enter a global domain and Relay hostname")
      return
    }
    if (!setup.installed && !authKey) {
      setError("Enter a Tailscale auth key")
      return
    }

    const configurationChanged =
      !setup.settings ||
      normalizedDomain !== setup.settings.domain ||
      normalizedHostname !== setup.settings.hostname
    try {
      if (configurationChanged) {
        await saveMutation.mutateAsync({
          data: {
            dnsPort: setup.settings?.dnsPort ?? 53,
            domain: normalizedDomain,
            hostname: normalizedHostname,
            proxyPort: setup.settings?.proxyPort ?? 25_565,
            relayId: relay.id,
          },
        })
      }
      if (authKey) {
        await installMutation.mutateAsync({
          data: { authKey, relayId: relay.id },
        })
      }
      onComplete()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update Tailscale"
      )
    }
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void submit(event)}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className="text-[10px] font-medium">Global domain</span>
          <Input
            name="domain"
            aria-label="Global Tailscale domain"
            defaultValue={setup.settings?.domain ?? "test"}
            disabled={pending}
            required
            placeholder="test"
            className="mt-2 font-mono"
          />
        </label>
        <label>
          <span className="text-[10px] font-medium">Relay hostname</span>
          <Input
            name="hostname"
            aria-label="Tailscale Relay hostname"
            defaultValue={
              setup.settings?.hostname ?? suggestedHostname(relay.name)
            }
            disabled={pending}
            required
            placeholder="kiln-node"
            className="mt-2 font-mono"
          />
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="tailscale-auth-key"
            className="text-[10px] font-medium"
          >
            One-time auth key
          </label>
          <a
            href="https://login.tailscale.com/admin/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[9px] text-primary hover:underline"
          >
            Create key
            <ExternalLink className="size-3" />
          </a>
        </div>
        <Input
          id="tailscale-auth-key"
          name="authKey"
          type="password"
          autoComplete="off"
          spellCheck={false}
          disabled={pending}
          required={!setup.installed}
          placeholder="tskey-auth-…"
          className="mt-2 font-mono"
        />
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </div>
      ) : null}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onComplete}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? (
            <LoaderCircle className="animate-spin" />
          ) : setup.installed ? (
            <Save />
          ) : (
            <KeyRound />
          )}
          {installMutation.isPending
            ? "Installing…"
            : saveMutation.isPending
              ? "Saving…"
              : setup.installed
                ? "Save"
                : "Install"}
        </Button>
      </DialogFooter>
    </form>
  )
})

function formatServerState(
  state: TailscaleServerView["observedState"]
): string {
  return state.charAt(0).toUpperCase() + state.slice(1)
}

function normalizeDnsValue(value: string): string {
  return value
    .trim()
    .replace(/^[.]+|[.]+$/gu, "")
    .toLowerCase()
}

function suggestedServerPrefix(server: TailscaleServerView): string {
  const version = normalizeDnsValue(
    server.version.replace(/[^a-z0-9.-]+/giu, "-")
  )
  const implementation = normalizeDnsValue(
    (server.brickId ?? server.implementation).replace(/[^a-z0-9.-]+/giu, "-")
  )
  return [version, implementation].filter(Boolean).join(".")
}

function suggestedHostname(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 58)
  return normalized ? `kiln-${normalized}`.slice(0, 63) : "kiln-node"
}
