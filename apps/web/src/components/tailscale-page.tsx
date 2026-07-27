import * as React from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import {
  Check,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Save,
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
  const selectedRelay =
    availableRelays.find((relay) => relay.id === selectedRelayId) ??
    availableRelays[0]

  if (!selectedRelay) {
    return (
      <main className="mx-auto w-full max-w-7xl px-3 pb-10 sm:px-5">
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
    <main className="mx-auto w-full max-w-7xl px-3 pb-10 sm:px-5">
      <TailscaleRelayWorkspace
        key={selectedRelay.id}
        relays={availableRelays}
        selectedRelay={selectedRelay}
        onSelectRelay={setSelectedRelayId}
      />
    </main>
  )
})

const TailscaleRelayWorkspace = React.memo(function TailscaleRelayWorkspace({
  relays,
  selectedRelay,
  onSelectRelay,
}: {
  relays: Array<PersistedRelay>
  selectedRelay: PersistedRelay
  onSelectRelay: (relayId: string) => void
}) {
  const overviewQuery = useQuery({
    ...relayTailscaleQueryOptions(selectedRelay.id),
    notifyOnChangeProps: ["error", "status"],
  })

  if (overviewQuery.status === "pending") {
    return (
      <div className="grid min-h-72 place-items-center rounded-xl border bg-card/45">
        <LoaderCircle className="size-5 animate-spin text-primary" />
      </div>
    )
  }

  if (overviewQuery.status === "error") {
    return (
      <div className="rounded-xl border border-chart-4/25 bg-chart-4/5 px-5 py-8 text-center">
        <CircleAlert className="mx-auto size-5 text-chart-4" />
        <p className="mt-3 text-sm font-semibold">
          Tailscale status unavailable
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
          {overviewQuery.error?.message ??
            "This Relay did not return its Tailscale status."}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => void overviewQuery.refetch()}
        >
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <TailscaleSetupDialog relay={selectedRelay} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(220px,0.38fr)_minmax(0,0.62fr)]">
        <RelayRail
          relays={relays}
          selectedRelay={selectedRelay}
          onSelectRelay={onSelectRelay}
        />
        <ServerDirectory relay={selectedRelay} />
      </div>
    </div>
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
          <Button
            type="button"
            variant={installed ? "outline" : "default"}
            size="sm"
          />
        }
      >
        <KeyRound />
        {installed ? "Manage Auth Key" : "Install"}
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

const RelayRail = React.memo(function RelayRail({
  relays,
  selectedRelay,
  onSelectRelay,
}: {
  relays: Array<PersistedRelay>
  selectedRelay: PersistedRelay
  onSelectRelay: (relayId: string) => void
}) {
  return (
    <aside className="overflow-hidden rounded-xl border bg-card/45">
      <div className="border-b bg-background/25 px-4 py-3">
        <p className="font-mono text-[8px] tracking-[0.16em] text-muted-foreground uppercase">
          Relay nodes
        </p>
        <p className="mt-1 text-xs font-medium">{relays.length} configured</p>
      </div>

      <div className="p-2">
        {relays.map((relay) => (
          <RelayRailItem
            key={relay.id}
            relay={relay}
            selected={relay.id === selectedRelay.id}
            onSelect={onSelectRelay}
          />
        ))}
      </div>

      <SelectedNodeDetails relayId={selectedRelay.id} />
    </aside>
  )
})

interface RelayRailSnapshot {
  connected: boolean
  serverCount: number
}

const RelayRailItem = React.memo(function RelayRailItem({
  relay,
  selected,
  onSelect,
}: {
  relay: PersistedRelay
  selected: boolean
  onSelect: (relayId: string) => void
}) {
  const selectRelaySnapshot = React.useCallback(
    (snapshot: RelayFleetSnapshot): RelayRailSnapshot => ({
      connected:
        snapshot.nodes.find((node) => node.relayId === relay.id)
          ?.relayStatus === "connected",
      serverCount: snapshot.instances.filter(
        (instance) => instance.relayId === relay.id
      ).length,
    }),
    [relay.id]
  )
  const { data = disconnectedRelayRailSnapshot } = useQuery({
    ...relaySnapshotQueryOptions(),
    notifyOnChangeProps: ["data"],
    select: selectRelaySnapshot,
  })

  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
        selected
          ? "border-primary/30 bg-primary/8"
          : "border-transparent hover:border-border hover:bg-background/55"
      }`}
      onClick={() => onSelect(relay.id)}
    >
      <span
        className={`grid size-8 shrink-0 place-items-center rounded-md border ${
          selected ? "border-primary/25 bg-primary/10" : "bg-background"
        }`}
      >
        <Server
          className={`size-3.5 ${
            selected ? "text-primary" : "text-muted-foreground"
          }`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{relay.name}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground">
          <span
            className={`size-1.5 rounded-full ${
              data.connected ? "bg-chart-2" : "bg-muted-foreground/35"
            }`}
          />
          {data.serverCount} server{data.serverCount === 1 ? "" : "s"}
        </span>
      </span>
      <ChevronRight
        className={`size-3.5 ${
          selected
            ? "text-primary"
            : "text-muted-foreground/35 group-hover:text-muted-foreground"
        }`}
      />
    </button>
  )
})

const disconnectedRelayRailSnapshot: RelayRailSnapshot = {
  connected: false,
  serverCount: 0,
}

interface SelectedNodeTailscaleView {
  connected: boolean
  coreDns: string
  dnsAddress: string
  hostname: string
  installed: boolean
  settingsConfigured: boolean
}

function selectSelectedNodeTailscale(
  overview: RelayTailscaleOverview
): SelectedNodeTailscaleView {
  return {
    connected: overview.status.connected,
    coreDns: overview.status.coreDnsRunning
      ? `Listening on ${overview.status.dnsAddress}`
      : "Stopped",
    dnsAddress: overview.status.dnsAddress ?? "Not connected",
    hostname: overview.settings?.hostname ?? "Not configured",
    installed: overview.status.installed,
    settingsConfigured: overview.settings !== null,
  }
}

const SelectedNodeDetails = React.memo(function SelectedNodeDetails({
  relayId,
}: {
  relayId: string
}) {
  const selectRelayOnline = React.useCallback(
    (snapshot: RelayFleetSnapshot) =>
      snapshot.nodes.find((node) => node.relayId === relayId)?.relayStatus ===
      "connected",
    [relayId]
  )
  const { data: relayOnline = false } = useQuery({
    ...relaySnapshotQueryOptions(),
    notifyOnChangeProps: ["data"],
    select: selectRelayOnline,
  })
  const { data: tailscale } = useQuery({
    ...relayTailscaleQueryOptions(relayId),
    notifyOnChangeProps: ["data"],
    select: selectSelectedNodeTailscale,
  })
  if (!tailscale) return null

  return (
    <div className="border-t bg-background/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-medium">Selected node</p>
        <StatusBadge
          connected={tailscale.connected}
          installed={tailscale.installed}
          settingsConfigured={tailscale.settingsConfigured}
          compact
        />
      </div>
      <dl className="mt-3 space-y-2.5">
        <NodeDetail label="Relay hostname" value={tailscale.hostname} />
        <NodeDetail label="Tailnet IP" value={tailscale.dnsAddress} />
        <NodeDetail label="CoreDNS" value={tailscale.coreDns} />
        <NodeDetail
          label="Relay"
          value={relayOnline ? "Online" : "Unreachable"}
        />
      </dl>
    </div>
  )
})

function NodeDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-[9px] text-muted-foreground">{label}</dt>
      <dd className="max-w-[65%] truncate text-right font-mono text-[9px] font-medium">
        {value}
      </dd>
    </div>
  )
}

const ServerDirectory = React.memo(function ServerDirectory({
  relay,
}: {
  relay: PersistedRelay
}) {
  const selectServers = React.useCallback(
    (snapshot: RelayFleetSnapshot): Array<TailscaleServerView> => {
      const selected: Array<TailscaleServerView> = []
      for (const instance of snapshot.instances) {
        if (instance.relayId === relay.id) {
          selected.push(selectTailscaleServer(instance))
        }
      }
      return selected
    },
    [relay.id]
  )
  const serversQuery = useQuery({
    ...relaySnapshotQueryOptions(),
    notifyOnChangeProps: ["data", "status"],
    select: selectServers,
  })
  const servers = serversQuery.data ?? emptyTailscaleServers
  const connectedCount = servers.filter(
    (server) => server.tailscale.enabled
  ).length

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border bg-card/45">
      <div className="flex flex-col gap-2 border-b bg-background/25 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-[8px] tracking-[0.16em] text-muted-foreground uppercase">
            Servers on {relay.name}
          </p>
          <h2 className="mt-1 text-sm font-semibold">Tailnet publishing</h2>
        </div>
        <Badge variant="outline" className="w-fit font-mono text-[9px]">
          {connectedCount}/{servers.length} SELECTED
        </Badge>
      </div>

      {serversQuery.status === "pending" ? (
        <div className="grid min-h-48 place-items-center">
          <LoaderCircle className="size-4 animate-spin text-primary" />
        </div>
      ) : servers.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <Server className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold">No servers on this Relay</p>
        </div>
      ) : (
        <TailscaleServerTableBoundary relayId={relay.id} servers={servers} />
      )}
    </section>
  )
})

interface TailscaleServerView {
  brickId: string | undefined
  id: string
  implementation: string
  managedByRelay: boolean
  name: string
  observedState: FleetRelayInstance["observedState"]
  relayId: string
  tailscale: FleetRelayInstance["tailscale"]
  version: string
}

function selectTailscaleServer(
  server: FleetRelayInstance
): TailscaleServerView {
  return {
    brickId: server.brickId,
    id: server.id,
    implementation: server.implementation,
    managedByRelay: server.managedByRelay,
    name: server.name,
    observedState: server.observedState,
    relayId: server.relayId,
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

const TailscaleServerTableBoundary = React.memo(
  function TailscaleServerTableBoundary({
    relayId,
    servers,
  }: {
    relayId: string
    servers: Array<TailscaleServerView>
  }) {
    const { data: network } = useQuery({
      ...relayTailscaleQueryOptions(relayId),
      notifyOnChangeProps: ["data"],
      select: selectTailscaleNetwork,
    })

    if (!network) {
      return (
        <div className="px-6 py-14 text-center">
          <ShieldCheck className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold">
            Configure Tailscale first
          </p>
        </div>
      )
    }

    return (
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b bg-muted/10 font-mono text-[8px] tracking-[0.12em] text-muted-foreground uppercase">
              <th className="w-14 px-4 py-2.5 font-medium">Use</th>
              <th className="px-3 py-2.5 font-medium">Server</th>
              <th className="w-[44%] px-3 py-2.5 font-medium">Hostname</th>
              <th className="px-3 py-2.5 font-medium">Tailnet IP</th>
              <th className="w-20 px-4 py-2.5 text-right font-medium">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {servers.map((server) => (
              <ServerTailscaleRow
                key={`${server.id}:${server.tailscale.enabled}:${server.tailscale.subdomain ?? ""}:${network.hostname}`}
                network={network}
                server={server}
              />
            ))}
          </tbody>
        </table>
      </div>
    )
  }
)

interface TailscaleRowStore {
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

function createTailscaleRowStore({
  enabled: initialEnabled,
  prefix: initialPrefix,
}: {
  enabled: boolean
  prefix: string
}): TailscaleRowStore {
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

const ServerTailscaleRow = React.memo(function ServerTailscaleRow({
  server,
  network,
}: {
  server: TailscaleServerView
  network: TailscaleNetworkView
}) {
  const hostnameNamespace = `${network.hostname}.`
  const savedSubdomain = server.tailscale.subdomain ?? ""
  const initialPrefix = savedSubdomain.startsWith(hostnameNamespace)
    ? savedSubdomain.slice(hostnameNamespace.length)
    : savedSubdomain || suggestedServerPrefix(server)
  const [store] = React.useState(() =>
    createTailscaleRowStore({
      enabled: server.tailscale.enabled,
      prefix: initialPrefix,
    })
  )

  const tailnetAddress =
    server.tailscale.enabled && network.connected
      ? (network.ipv4Address ?? network.ipv6Address ?? "Connected")
      : "—"

  return (
    <tr className="border-b last:border-b-0">
      <TailscaleEnabledCell
        canEnable={network.connected}
        managedByRelay={server.managedByRelay}
        serverName={server.name}
        store={store}
      />
      <TailscaleServerIdentityCell server={server} />
      <TailscaleHostnameCell
        domain={network.domain}
        hostname={network.hostname}
        managedByRelay={server.managedByRelay}
        serverName={server.name}
        store={store}
      />
      <td className="px-3 py-3 align-top">
        <span
          className={`inline-flex h-8 items-center font-mono text-[10px] ${
            tailnetAddress === "—" ? "text-muted-foreground" : "text-foreground"
          }`}
        >
          {tailnetAddress}
        </span>
      </td>
      <TailscaleActionCell network={network} server={server} store={store} />
    </tr>
  )
})

const TailscaleEnabledCell = React.memo(function TailscaleEnabledCell({
  canEnable,
  managedByRelay,
  serverName,
  store,
}: {
  canEnable: boolean
  managedByRelay: boolean
  serverName: string
  store: TailscaleRowStore
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
    <td className="px-4 py-3 align-top">
      <input
        type="checkbox"
        aria-label={`Publish ${serverName} on Tailscale`}
        checked={enabled}
        disabled={pending || !managedByRelay || (!enabled && !canEnable)}
        onChange={(event) => store.setEnabled(event.target.checked)}
        className="mt-1 accent-primary"
      />
    </td>
  )
})

const TailscaleServerIdentityCell = React.memo(
  function TailscaleServerIdentityCell({
    server,
  }: {
    server: TailscaleServerView
  }) {
    return (
      <td className="px-3 py-3 align-top">
        <div className="max-w-44">
          <p className="truncate text-xs font-medium">{server.name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground">
            <span
              className={`size-1.5 rounded-full ${
                server.observedState === "running"
                  ? "bg-chart-2"
                  : "bg-muted-foreground/35"
              }`}
            />
            {server.version} · {server.implementation}
          </p>
          {!server.managedByRelay ? (
            <p className="mt-1 text-[8px] text-chart-4">Imported · read only</p>
          ) : null}
        </div>
      </td>
    )
  }
)

const TailscaleHostnameCell = React.memo(function TailscaleHostnameCell({
  domain,
  hostname,
  managedByRelay,
  serverName,
  store,
}: {
  domain: string
  hostname: string
  managedByRelay: boolean
  serverName: string
  store: TailscaleRowStore
}) {
  const enabled = React.useSyncExternalStore(
    store.subscribe,
    store.getEnabled,
    store.getEnabled
  )
  const error = React.useSyncExternalStore(
    store.subscribe,
    store.getError,
    store.getError
  )
  const pending = React.useSyncExternalStore(
    store.subscribe,
    store.getPending,
    store.getPending
  )
  const prefix = React.useSyncExternalStore(
    store.subscribe,
    store.getPrefix,
    store.getPrefix
  )
  return (
    <td className="px-3 py-3 align-top">
      <div className="flex min-w-80">
        <span className="grid h-8 max-w-28 shrink-0 place-items-center truncate rounded-l-md border border-r-0 bg-muted/35 px-2 font-mono text-[9px] text-muted-foreground">
          {hostname}.
        </span>
        <Input
          aria-label={`Hostname prefix for ${serverName}`}
          value={prefix}
          onChange={(event) => store.setPrefix(event.target.value)}
          disabled={!managedByRelay || pending || !enabled}
          placeholder="1.21.11.paper"
          className="h-8 min-w-24 rounded-none font-mono text-[10px]"
        />
        <span className="grid h-8 max-w-24 shrink-0 place-items-center truncate rounded-r-md border border-l-0 bg-muted/35 px-2 font-mono text-[9px] text-muted-foreground">
          .{domain}
        </span>
      </div>
      {error ? (
        <p className="mt-1.5 max-w-md text-[9px] leading-4 text-destructive">
          {error}
        </p>
      ) : null}
    </td>
  )
})

const TailscaleActionCell = React.memo(function TailscaleActionCell({
  network,
  server,
  store,
}: {
  network: TailscaleNetworkView
  server: TailscaleServerView
  store: TailscaleRowStore
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

  async function apply() {
    if (
      pending ||
      !changed ||
      !server.managedByRelay ||
      (enabled && !normalizedPrefix)
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
    <td className="px-4 py-3 text-right align-top">
      <Button
        type="button"
        variant={changed ? "default" : "ghost"}
        size="sm"
        className="h-8"
        disabled={
          pending ||
          !changed ||
          !server.managedByRelay ||
          (enabled && !normalizedPrefix)
        }
        onClick={() => void apply()}
      >
        {pending ? (
          <LoaderCircle className="animate-spin" />
        ) : changed ? (
          <Save />
        ) : (
          <Check />
        )}
        <span className="sr-only">
          {pending
            ? `Applying ${server.name}`
            : changed
              ? `Apply changes to ${server.name}`
              : `${server.name} is saved`}
        </span>
      </Button>
    </td>
  )
})

function StatusBadge({
  connected,
  installed,
  settingsConfigured,
  compact = false,
}: {
  connected: boolean
  installed: boolean
  settingsConfigured: boolean
  compact?: boolean
}) {
  const label = connected
    ? "CONNECTED"
    : installed
      ? "ATTENTION"
      : settingsConfigured
        ? "CONFIGURED"
        : "NOT SET"
  const tone = connected
    ? "border-chart-2/35 text-chart-2"
    : installed
      ? "border-chart-4/35 text-chart-4"
      : ""
  return (
    <Badge
      variant="outline"
      className={`font-mono ${compact ? "px-1.5 text-[8px]" : "text-[9px]"} ${tone}`}
    >
      {label}
    </Badge>
  )
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
