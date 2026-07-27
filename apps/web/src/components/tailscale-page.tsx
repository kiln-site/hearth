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
import type { RelayTailscaleOverview } from "@workspace/contracts"

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

import type {
  FleetRelayInstance,
  FleetRelayNode,
  RelayFleetSnapshot,
} from "@/lib/relay-fleet"
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
  const snapshotQuery = useQuery(relaySnapshotQueryOptions())
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
        snapshot={snapshotQuery.data}
        snapshotPending={snapshotQuery.isPending}
        onSelectRelay={setSelectedRelayId}
      />
    </main>
  )
})

const TailscaleRelayWorkspace = React.memo(function TailscaleRelayWorkspace({
  relays,
  selectedRelay,
  snapshot,
  snapshotPending,
  onSelectRelay,
}: {
  relays: Array<PersistedRelay>
  selectedRelay: PersistedRelay
  snapshot: RelayFleetSnapshot | undefined
  snapshotPending: boolean
  onSelectRelay: (relayId: string) => void
}) {
  const overviewQuery = useQuery(relayTailscaleQueryOptions(selectedRelay.id))
  const selectedNode = snapshot?.nodes.find(
    (node) => node.relayId === selectedRelay.id
  )
  const servers = React.useMemo(
    () =>
      snapshot?.instances.filter(
        (instance) => instance.relayId === selectedRelay.id
      ) ?? [],
    [selectedRelay.id, snapshot?.instances]
  )

  if (overviewQuery.isPending) {
    return (
      <div className="grid min-h-72 place-items-center rounded-xl border bg-card/45">
        <LoaderCircle className="size-5 animate-spin text-primary" />
      </div>
    )
  }

  if (overviewQuery.error || !overviewQuery.data) {
    return (
      <div className="rounded-xl border border-amber-400/25 bg-amber-400/5 px-5 py-8 text-center">
        <CircleAlert className="mx-auto size-5 text-amber-300" />
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

  const overview = overviewQuery.data
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <TailscaleSetupDialog relay={selectedRelay} overview={overview} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(220px,0.38fr)_minmax(0,0.62fr)]">
        <RelayRail
          relays={relays}
          selectedRelay={selectedRelay}
          selectedNode={selectedNode}
          snapshot={snapshot}
          overview={overview}
          onSelectRelay={onSelectRelay}
        />
        <ServerDirectory
          relay={selectedRelay}
          servers={servers}
          overview={overview}
          pending={snapshotPending}
        />
      </div>
    </div>
  )
})

const TailscaleSetupDialog = React.memo(function TailscaleSetupDialog({
  relay,
  overview,
}: {
  relay: PersistedRelay
  overview: RelayTailscaleOverview
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [domain, setDomain] = React.useState(
    () => overview.settings?.domain ?? "test"
  )
  const [hostname, setHostname] = React.useState(
    () => overview.settings?.hostname ?? suggestedHostname(relay.name)
  )
  const [authKey, setAuthKey] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const updateOverview = React.useCallback(
    (next: RelayTailscaleOverview) => {
      queryClient.setQueryData(queryKeys.tailscale(relay.id), next)
    },
    [queryClient, relay.id]
  )
  const saveMutation = useMutation({
    mutationFn: updateRelayTailscale,
    onSuccess: async (next) => {
      updateOverview(next)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.tailscale(relay.id),
      })
    },
  })
  const installMutation = useMutation({
    mutationFn: installRelayTailscale,
    onSuccess: async (next) => {
      setAuthKey("")
      updateOverview(next)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.tailscale(relay.id),
      })
    },
  })

  const normalizedDomain = normalizeDnsValue(domain)
  const normalizedHostname = hostname.trim().toLowerCase()
  const savedSettings = overview.settings
  const configurationChanged =
    !savedSettings ||
    normalizedDomain !== savedSettings.domain ||
    normalizedHostname !== savedSettings.hostname
  const pending = saveMutation.isPending || installMutation.isPending
  const installed = overview.status.installed

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setError(null)
    try {
      if (configurationChanged) {
        await saveMutation.mutateAsync({
          data: {
            dnsPort: savedSettings?.dnsPort ?? 53,
            domain,
            hostname,
            proxyPort: savedSettings?.proxyPort ?? 25_565,
            relayId: relay.id,
          },
        })
      }
      if (authKey.trim()) {
        await installMutation.mutateAsync({
          data: { authKey, relayId: relay.id },
        })
      }
      setOpen(false)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update Tailscale"
      )
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) setError(null)
      }}
    >
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
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="text-[10px] font-medium">Global domain</span>
              <div className="mt-2 flex">
                <span className="grid h-9 place-items-center rounded-l-md border border-r-0 bg-muted/35 px-3 font-mono text-xs text-muted-foreground">
                  .
                </span>
                <Input
                  aria-label="Global Tailscale domain"
                  value={domain.replace(/^[.]+/u, "")}
                  onChange={(event) => {
                    setDomain(event.target.value)
                    setError(null)
                  }}
                  disabled={pending}
                  placeholder="test"
                  className="rounded-l-none font-mono"
                />
              </div>
            </label>
            <label>
              <span className="text-[10px] font-medium">Relay hostname</span>
              <Input
                aria-label="Tailscale Relay hostname"
                value={hostname}
                onChange={(event) => {
                  setHostname(event.target.value)
                  setError(null)
                }}
                disabled={pending}
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
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={authKey}
              onChange={(event) => {
                setAuthKey(event.target.value)
                setError(null)
              }}
              disabled={pending}
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
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                pending ||
                !normalizedDomain ||
                !normalizedHostname ||
                (!configurationChanged && !authKey.trim()) ||
                (!installed && !authKey.trim())
              }
            >
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : authKey.trim() ? (
                <KeyRound />
              ) : (
                <Save />
              )}
              {installMutation.isPending
                ? "Installing…"
                : saveMutation.isPending
                  ? "Saving…"
                  : !installed
                    ? "Install"
                    : authKey.trim()
                      ? "Update Auth Key"
                      : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
})

const RelayRail = React.memo(function RelayRail({
  relays,
  selectedRelay,
  selectedNode,
  snapshot,
  overview,
  onSelectRelay,
}: {
  relays: Array<PersistedRelay>
  selectedRelay: PersistedRelay
  selectedNode: FleetRelayNode | undefined
  snapshot: RelayFleetSnapshot | undefined
  overview: RelayTailscaleOverview
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
        {relays.map((relay) => {
          const selected = relay.id === selectedRelay.id
          const node = snapshot?.nodes.find(
            (candidate) => candidate.relayId === relay.id
          )
          const serverCount =
            snapshot?.instances.filter(
              (instance) => instance.relayId === relay.id
            ).length ?? 0
          return (
            <button
              key={relay.id}
              type="button"
              aria-pressed={selected}
              className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
                selected
                  ? "border-primary/30 bg-primary/8"
                  : "border-transparent hover:border-border hover:bg-background/55"
              }`}
              onClick={() => onSelectRelay(relay.id)}
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
                <span className="block truncate text-xs font-medium">
                  {relay.name}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground">
                  <span
                    className={`size-1.5 rounded-full ${
                      node?.relayStatus === "connected"
                        ? "bg-emerald-400"
                        : "bg-muted-foreground/35"
                    }`}
                  />
                  {serverCount} server{serverCount === 1 ? "" : "s"}
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
        })}
      </div>

      <div className="border-t bg-background/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-medium">Selected node</p>
          <StatusBadge overview={overview} compact />
        </div>
        <dl className="mt-3 space-y-2.5">
          <NodeDetail
            label="Relay hostname"
            value={overview.settings?.hostname ?? "Not configured"}
          />
          <NodeDetail
            label="Tailnet IP"
            value={overview.status.dnsAddress ?? "Not connected"}
          />
          <NodeDetail
            label="CoreDNS"
            value={
              overview.status.coreDnsRunning
                ? `Listening on ${overview.status.dnsAddress}`
                : "Stopped"
            }
          />
          <NodeDetail
            label="Relay"
            value={
              selectedNode?.relayStatus === "connected"
                ? "Online"
                : "Unreachable"
            }
          />
        </dl>
      </div>
    </aside>
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
  servers,
  overview,
  pending,
}: {
  relay: PersistedRelay
  servers: Array<FleetRelayInstance>
  overview: RelayTailscaleOverview
  pending: boolean
}) {
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

      {pending ? (
        <div className="grid min-h-48 place-items-center">
          <LoaderCircle className="size-4 animate-spin text-primary" />
        </div>
      ) : servers.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <Server className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold">No servers on this Relay</p>
        </div>
      ) : !overview.settings ? (
        <div className="px-6 py-14 text-center">
          <ShieldCheck className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold">
            Configure Tailscale first
          </p>
        </div>
      ) : (
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
                  key={`${server.id}:${server.tailscale.enabled}:${server.tailscale.subdomain ?? ""}:${overview.settings?.hostname}`}
                  server={server}
                  overview={overview}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
})

const ServerTailscaleRow = React.memo(function ServerTailscaleRow({
  server,
  overview,
}: {
  server: FleetRelayInstance
  overview: RelayTailscaleOverview
}) {
  const queryClient = useQueryClient()
  const settings = overview.settings
  const hostnameNamespace = settings ? `${settings.hostname}.` : ""
  const savedSubdomain = server.tailscale.subdomain ?? ""
  const initialPrefix = savedSubdomain.startsWith(hostnameNamespace)
    ? savedSubdomain.slice(hostnameNamespace.length)
    : savedSubdomain || suggestedServerPrefix(server)
  const [draft, setDraft] = React.useState<{
    enabled: boolean
    prefix: string
  } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const enabled = draft?.enabled ?? server.tailscale.enabled
  const prefix = draft?.prefix ?? initialPrefix
  const normalizedPrefix = normalizeDnsValue(prefix)
  const fullSubdomain = settings
    ? `${settings.hostname}.${normalizedPrefix}`
    : normalizedPrefix
  const changed =
    enabled !== server.tailscale.enabled ||
    (enabled && fullSubdomain !== savedSubdomain)
  const canEnable = overview.status.connected && Boolean(settings)

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
      mutation.isPending ||
      !changed ||
      !server.managedByRelay ||
      (enabled && (!settings || !normalizedPrefix))
    ) {
      return
    }
    setError(null)
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
      setError(
        cause instanceof Error ? cause.message : "Could not update this server"
      )
    }
  }

  const tailnetAddress =
    server.tailscale.enabled && overview.status.connected
      ? (overview.status.ipv4Address ??
        overview.status.ipv6Address ??
        "Connected")
      : "—"

  return (
    <tr className="border-b last:border-b-0">
      <td className="px-4 py-3 align-top">
        <input
          type="checkbox"
          aria-label={`Publish ${server.name} on Tailscale`}
          checked={enabled}
          disabled={
            mutation.isPending ||
            !server.managedByRelay ||
            (!enabled && !canEnable)
          }
          onChange={(event) => {
            setDraft({ enabled: event.target.checked, prefix })
            setError(null)
          }}
          className="mt-1 accent-primary"
        />
      </td>
      <td className="px-3 py-3 align-top">
        <div className="max-w-44">
          <p className="truncate text-xs font-medium">{server.name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground">
            <span
              className={`size-1.5 rounded-full ${
                server.observedState === "running"
                  ? "bg-emerald-400"
                  : "bg-muted-foreground/35"
              }`}
            />
            {server.version} · {server.implementation}
          </p>
          {!server.managedByRelay ? (
            <p className="mt-1 text-[8px] text-amber-300">
              Imported · read only
            </p>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-3 align-top">
        <div className="flex min-w-80">
          <span className="grid h-8 max-w-28 shrink-0 place-items-center truncate rounded-l-md border border-r-0 bg-muted/35 px-2 font-mono text-[9px] text-muted-foreground">
            {settings?.hostname}.
          </span>
          <Input
            aria-label={`Hostname prefix for ${server.name}`}
            value={prefix}
            onChange={(event) => {
              setDraft({ enabled, prefix: event.target.value })
              setError(null)
            }}
            disabled={!server.managedByRelay || mutation.isPending || !enabled}
            placeholder="1.21.11.paper"
            className="h-8 min-w-24 rounded-none font-mono text-[10px]"
          />
          <span className="grid h-8 max-w-24 shrink-0 place-items-center truncate rounded-r-md border border-l-0 bg-muted/35 px-2 font-mono text-[9px] text-muted-foreground">
            .{settings?.domain}
          </span>
        </div>
        {error ? (
          <p className="mt-1.5 max-w-md text-[9px] leading-4 text-destructive">
            {error}
          </p>
        ) : null}
      </td>
      <td className="px-3 py-3 align-top">
        <span
          className={`inline-flex h-8 items-center font-mono text-[10px] ${
            tailnetAddress === "—" ? "text-muted-foreground" : "text-foreground"
          }`}
        >
          {tailnetAddress}
        </span>
      </td>
      <td className="px-4 py-3 text-right align-top">
        <Button
          type="button"
          variant={changed ? "default" : "ghost"}
          size="sm"
          className="h-8"
          disabled={
            mutation.isPending ||
            !changed ||
            !server.managedByRelay ||
            (enabled && !normalizedPrefix)
          }
          onClick={() => void apply()}
        >
          {mutation.isPending ? (
            <LoaderCircle className="animate-spin" />
          ) : changed ? (
            <Save />
          ) : (
            <Check />
          )}
          <span className="sr-only">
            {mutation.isPending
              ? `Applying ${server.name}`
              : changed
                ? `Apply changes to ${server.name}`
                : `${server.name} is saved`}
          </span>
        </Button>
      </td>
    </tr>
  )
})

function StatusBadge({
  overview,
  compact = false,
}: {
  overview: RelayTailscaleOverview
  compact?: boolean
}) {
  const label = overview.status.connected
    ? "CONNECTED"
    : overview.status.installed
      ? "ATTENTION"
      : overview.settings
        ? "CONFIGURED"
        : "NOT SET"
  const tone = overview.status.connected
    ? "border-emerald-400/30 text-emerald-300"
    : overview.status.installed
      ? "border-amber-400/30 text-amber-300"
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

function suggestedServerPrefix(server: FleetRelayInstance): string {
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
