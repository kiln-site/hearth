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
  Copy,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Network,
  Save,
  Server,
  ShieldCheck,
  Waypoints,
} from "lucide-react"
import type {
  RelayTailscaleOverview,
  RelayTailscaleSettings,
} from "@workspace/contracts"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import type { PersistedRelay } from "@/lib/relay-registry"
import {
  queryKeys,
  relaysQueryOptions,
  relayTailscaleQueryOptions,
} from "@/lib/query-options"
import { installRelayTailscale, updateRelayTailscale } from "@/server/relays"

export const TailscalePage = React.memo(function TailscalePage() {
  const { data: relays } = useSuspenseQuery(relaysQueryOptions())
  const availableRelays = relays.filter((relay) => relay.enabled)
  const [selectedRelayId, setSelectedRelayId] = React.useState(
    () => availableRelays[0]?.id ?? ""
  )
  const selectedRelay =
    availableRelays.find((relay) => relay.id === selectedRelayId) ??
    availableRelays[0]

  if (!selectedRelay) {
    return (
      <main className="mx-auto w-full max-w-5xl px-3 pb-10 sm:px-5">
        <div className="rounded-xl border border-dashed bg-card/45 px-6 py-14 text-center">
          <Server className="mx-auto size-5 text-muted-foreground" />
          <h1 className="mt-3 font-heading text-lg font-semibold">
            No active nodes
          </h1>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
            Add or resume a Relay node before configuring its private network.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-3 pb-10 sm:px-5">
      <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[9px] tracking-[0.18em] text-primary uppercase">
            Private infrastructure
          </p>
          <h1 className="mt-1 font-heading text-2xl font-semibold tracking-[-0.035em]">
            Tailscale
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            Join a node to your tailnet and publish intentional server names
            through its managed CoreDNS resolver.
          </p>
        </div>

        <label className="min-w-56">
          <span className="mb-1.5 block font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
            Node
          </span>
          <select
            value={selectedRelay.id}
            onChange={(event) => setSelectedRelayId(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {availableRelays.map((relay) => (
              <option key={relay.id} value={relay.id}>
                {relay.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      <TailscaleNodePanel key={selectedRelay.id} relay={selectedRelay} />
    </main>
  )
})

const TailscaleNodePanel = React.memo(function TailscaleNodePanel({
  relay,
}: {
  relay: PersistedRelay
}) {
  const overviewQuery = useQuery(relayTailscaleQueryOptions(relay.id))

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

  return (
    <TailscaleConfiguration
      key={overviewQuery.dataUpdatedAt}
      relay={relay}
      overview={overviewQuery.data}
    />
  )
})

const TailscaleConfiguration = React.memo(function TailscaleConfiguration({
  relay,
  overview,
}: {
  relay: PersistedRelay
  overview: RelayTailscaleOverview
}) {
  const queryClient = useQueryClient()
  const [domain, setDomain] = React.useState(
    () => overview.settings?.domain ?? "test"
  )
  const [hostname, setHostname] = React.useState(
    () => overview.settings?.hostname ?? suggestedHostname(relay.name)
  )
  const [authKey, setAuthKey] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [configurationSaved, setConfigurationSaved] = React.useState(false)

  const updateOverview = React.useCallback(
    (next: RelayTailscaleOverview) => {
      queryClient.setQueryData(queryKeys.tailscale(relay.id), next)
    },
    [queryClient, relay.id]
  )
  const saveMutation = useMutation({
    mutationFn: updateRelayTailscale,
    onSuccess: (next) => {
      updateOverview(next)
      setConfigurationSaved(true)
      window.setTimeout(() => setConfigurationSaved(false), 2_000)
    },
  })
  const installMutation = useMutation({
    mutationFn: installRelayTailscale,
    onSuccess: (next) => {
      setAuthKey("")
      updateOverview(next)
    },
  })

  const normalizedDomain = domain.trim().replace(/^[.]+|[.]+$/gu, "")
  const normalizedHostname = hostname.trim().toLowerCase()
  const savedSettings = overview.settings
  const configurationChanged =
    !savedSettings ||
    normalizedDomain !== savedSettings.domain ||
    normalizedHostname !== savedSettings.hostname
  const pending = saveMutation.isPending || installMutation.isPending

  async function saveConfiguration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setError(null)
    try {
      await saveMutation.mutateAsync({
        data: {
          dnsPort: savedSettings?.dnsPort ?? 53,
          domain,
          hostname,
          proxyPort: savedSettings?.proxyPort ?? 25_565,
          relayId: relay.id,
        },
      })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save Tailscale configuration"
      )
    }
  }

  async function install(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !authKey.trim() || !overview.settings) return
    setError(null)
    try {
      await installMutation.mutateAsync({
        data: { authKey, relayId: relay.id },
      })
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not install Tailscale"
      )
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
      <div className="space-y-4">
        <section className="overflow-hidden rounded-xl border bg-card/45">
          <div className="flex items-center justify-between border-b bg-background/25 px-4 py-3">
            <div className="flex items-center gap-2">
              <Waypoints className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">Node configuration</h2>
            </div>
            <StatusBadge overview={overview} />
          </div>

          <form className="space-y-4 p-4" onSubmit={saveConfiguration}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className="text-[10px] font-medium">Global domain</span>
                <span className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">
                  Shared suffix for Tailscale-enabled servers.
                </span>
                <div className="mt-2 flex">
                  <span className="grid h-9 place-items-center rounded-l-md border border-r-0 bg-muted/35 px-3 font-mono text-xs text-muted-foreground">
                    .
                  </span>
                  <Input
                    aria-label="Global Tailscale domain"
                    value={domain.replace(/^[.]+/u, "")}
                    onChange={(event) => {
                      setDomain(event.target.value)
                      setConfigurationSaved(false)
                      setError(null)
                    }}
                    disabled={pending}
                    placeholder="test"
                    className="rounded-l-none font-mono"
                  />
                </div>
              </label>

              <label>
                <span className="text-[10px] font-medium">Node hostname</span>
                <span className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">
                  Device name shown in the Tailscale admin console.
                </span>
                <Input
                  aria-label="Tailscale node hostname"
                  value={hostname}
                  onChange={(event) => {
                    setHostname(event.target.value)
                    setConfigurationSaved(false)
                    setError(null)
                  }}
                  disabled={pending}
                  placeholder="kiln-node"
                  className="mt-2 font-mono"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                disabled={
                  pending ||
                  !normalizedDomain ||
                  !normalizedHostname ||
                  !configurationChanged
                }
              >
                {saveMutation.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : configurationSaved ? (
                  <Check />
                ) : (
                  <Save />
                )}
                {saveMutation.isPending
                  ? "Saving…"
                  : configurationSaved
                    ? "Saved"
                    : "Save configuration"}
              </Button>
              {overview.status.connected && configurationChanged ? (
                <p className="text-[10px] text-amber-300">
                  Save to update CoreDNS and the tailnet hostname.
                </p>
              ) : null}
            </div>
          </form>
        </section>

        {!overview.status.connected ? (
          <section className="overflow-hidden rounded-xl border bg-card/45">
            <div className="flex items-center gap-2 border-b bg-background/25 px-4 py-3">
              <KeyRound className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">Install on node</h2>
            </div>
            <form className="space-y-3 p-4" onSubmit={install}>
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
                  disabled={pending || !overview.settings}
                  placeholder="tskey-auth-…"
                  className="mt-2 font-mono"
                />
                <p className="mt-1.5 text-[9px] leading-4 text-muted-foreground">
                  The key is used for initial authentication, then removed from
                  the managed container. The node identity persists on disk.
                </p>
              </div>

              <Button
                type="submit"
                disabled={
                  pending ||
                  !overview.settings ||
                  configurationChanged ||
                  !authKey.trim()
                }
              >
                {installMutation.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Network />
                )}
                {installMutation.isPending
                  ? "Joining tailnet…"
                  : overview.status.installed
                    ? "Retry installation"
                    : "Install Tailscale"}
              </Button>
              {!overview.settings ? (
                <p className="text-[10px] text-muted-foreground">
                  Save the node configuration first.
                </p>
              ) : configurationChanged ? (
                <p className="text-[10px] text-muted-foreground">
                  Save configuration changes before installing.
                </p>
              ) : null}
            </form>
          </section>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            {error}
          </div>
        ) : null}
      </div>

      <div className="space-y-4">
        <NodeStatusCard relay={relay} overview={overview} />
        {overview.status.connected && overview.settings ? (
          <DnsSetupCard overview={overview} settings={overview.settings} />
        ) : (
          <div className="rounded-xl border border-dashed bg-muted/10 p-5">
            <ShieldCheck className="size-4 text-muted-foreground" />
            <p className="mt-3 text-xs font-semibold">
              Private server names stay dormant
            </p>
            <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
              CoreDNS starts only after this node has a Tailscale address.
              Servers can then opt in from their Startup page.
            </p>
          </div>
        )}
      </div>
    </div>
  )
})

function StatusBadge({ overview }: { overview: RelayTailscaleOverview }) {
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
    <Badge variant="outline" className={`font-mono text-[9px] ${tone}`}>
      {label}
    </Badge>
  )
}

function NodeStatusCard({
  relay,
  overview,
}: {
  relay: PersistedRelay
  overview: RelayTailscaleOverview
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card/45">
      <div className="flex items-center gap-2 border-b bg-background/25 px-4 py-3">
        <Server className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">{relay.name}</h2>
      </div>
      <StatusRow
        label="Tailscale service"
        value={
          overview.status.connected
            ? "Connected"
            : overview.status.installed
              ? "Installed"
              : "Not installed"
        }
        healthy={overview.status.connected}
      />
      <StatusRow
        label="CoreDNS"
        value={overview.status.coreDnsRunning ? "Running" : "Stopped"}
        healthy={overview.status.coreDnsRunning}
      />
      <StatusRow
        label="Tailscale IPv4"
        value={overview.status.ipv4Address ?? "Waiting for address"}
        mono
      />
      <StatusRow
        label="Tailscale IPv6"
        value={overview.status.ipv6Address ?? "Waiting for address"}
        mono
      />
      {overview.status.message ? (
        <div className="border-t px-4 py-3 text-[10px] leading-5 text-muted-foreground">
          {overview.status.message}
        </div>
      ) : null}
    </section>
  )
}

function StatusRow({
  label,
  value,
  healthy,
  mono = false,
}: {
  label: string
  value: string
  healthy?: boolean
  mono?: boolean
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b px-4 py-2.5 last:border-b-0">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span
        className={`flex min-w-0 items-center gap-2 truncate text-[10px] font-medium ${mono ? "font-mono" : ""}`}
      >
        {healthy === undefined ? null : (
          <span
            className={`size-1.5 rounded-full ${healthy ? "bg-emerald-400" : "bg-muted-foreground/40"}`}
          />
        )}
        {value}
      </span>
    </div>
  )
}

function DnsSetupCard({
  overview,
  settings,
}: {
  overview: RelayTailscaleOverview
  settings: RelayTailscaleSettings
}) {
  return (
    <section className="rounded-xl border border-primary/20 bg-primary/5 p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Finish split DNS</h2>
      </div>
      <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
        In Tailscale DNS, add a custom nameserver restricted to the domain
        below. This sends only Kiln server lookups to this node.
      </p>
      <div className="mt-4 space-y-2">
        <CopyValue
          label="Nameserver"
          value={overview.status.dnsAddress ?? ""}
        />
        <CopyValue label="Restricted domain" value={settings.domain} />
      </div>
      <Button asChild variant="outline" size="sm" className="mt-4">
        <a
          href="https://login.tailscale.com/admin/dns"
          target="_blank"
          rel="noreferrer"
        >
          Open Tailscale DNS
          <ExternalLink />
        </a>
      </Button>
    </section>
  )
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between rounded-lg border bg-background/55 px-3 py-2.5 text-left transition-colors hover:bg-background/80"
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1_800)
      }}
    >
      <span>
        <span className="block font-mono text-[8px] tracking-wider text-muted-foreground uppercase">
          {label}
        </span>
        <span className="mt-0.5 block font-mono text-xs font-medium">
          {value}
        </span>
      </span>
      {copied ? (
        <Check className="size-3.5 text-emerald-400" />
      ) : (
        <Copy className="size-3.5 text-muted-foreground" />
      )}
    </button>
  )
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
