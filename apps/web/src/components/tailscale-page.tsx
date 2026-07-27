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
  Network,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { builtinTailscaleBrickId } from "@workspace/contracts"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

import { ServerTypeIcon } from "@/components/server-type-icon"
import type { FleetRelayInstance, RelayFleetSnapshot } from "@/lib/relay-fleet"
import {
  queryKeys,
  relaySnapshotQueryOptions,
  tailscaleStacksQueryOptions,
} from "@/lib/query-options"
import {
  removeTailscaleStack,
  saveTailscaleStack,
  type TailscaleStackOverview,
} from "@/server/tailscale"

type SaveStackInput = Parameters<typeof saveTailscaleStack>[0]["data"]
type TailscaleServer = Pick<
  FleetRelayInstance,
  | "id"
  | "implementation"
  | "name"
  | "relayId"
  | "relayName"
  | "routeId"
  | "shortId"
>

function selectTailscaleServers(
  snapshot: RelayFleetSnapshot
): Array<TailscaleServer> {
  return snapshot.instances.flatMap((instance) =>
    instance.brickId === builtinTailscaleBrickId
      ? []
      : [
          {
            id: instance.id,
            implementation: instance.implementation,
            name: instance.name,
            relayId: instance.relayId,
            relayName: instance.relayName,
            routeId: instance.routeId,
            shortId: instance.shortId,
          },
        ]
  )
}

export const TailscalePage = React.memo(function TailscalePage() {
  const { data: stacks } = useSuspenseQuery(tailscaleStacksQueryOptions())
  const [selectedStackId, setSelectedStackId] = React.useState("")
  const [selectedServerId, setSelectedServerId] = React.useState("")
  const [setupOpen, setSetupOpen] = React.useState(false)
  const selectedStack =
    stacks.find((stack) => stack.id === selectedStackId) ?? stacks[0] ?? null

  const selectStack = React.useCallback((id: string) => {
    setSelectedStackId(id)
    setSelectedServerId("")
  }, [])

  if (stacks.length === 0) {
    return (
      <main className="mx-auto grid min-h-[32rem] w-full max-w-6xl place-items-center px-3 pb-10 sm:px-5">
        <section className="w-full max-w-md rounded-xl border bg-card/45 p-8 text-center shadow-sm">
          <div className="mx-auto grid size-11 place-items-center rounded-lg border bg-primary/8 text-primary">
            <Network className="size-5" />
          </div>
          <h1 className="mt-4 font-heading text-xl font-semibold">
            Add Tailscale
          </h1>
          <Button className="mt-6" onClick={() => setSetupOpen(true)}>
            <Plus className="size-4" />
            Create network
          </Button>
          <StackEditorDialog
            open={setupOpen}
            onOpenChange={setSetupOpen}
            stack={null}
          />
        </section>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-3 pb-10 sm:px-5">
      <div className="grid min-h-[38rem] overflow-hidden rounded-xl border border-border/70 bg-background/35 md:h-[min(44rem,calc(100dvh-12rem))] md:min-h-0 md:grid-cols-[13rem_minmax(0,1fr)_21rem]">
        <StackSelector
          stacks={stacks}
          selectedId={selectedStack?.id ?? ""}
          onSelect={selectStack}
          onCreate={() => setSetupOpen(true)}
        />
        {selectedStack ? (
          <>
            <StackServerSelector
              stack={selectedStack}
              selectedServerId={selectedServerId}
              onSelect={setSelectedServerId}
            />
            <StackDetails
              key={`${selectedStack.id}:${selectedServerId}`}
              stack={selectedStack}
              selectedServerId={selectedServerId}
            />
          </>
        ) : null}
      </div>
      <StackEditorDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        stack={null}
      />
    </main>
  )
})

const StackSelector = React.memo(function StackSelector({
  stacks,
  selectedId,
  onSelect,
  onCreate,
}: {
  stacks: Array<TailscaleStackOverview>
  selectedId: string
  onSelect: (id: string) => void
  onCreate: () => void
}) {
  return (
    <aside className="flex min-h-0 flex-col border-b border-border/60 md:border-r md:border-b-0">
      <div className="flex h-12 items-center justify-between border-b border-border/60 px-3">
        <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          Networks
        </span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Create Tailscale network"
          onClick={onCreate}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {stacks.map((stack) => {
          const selected = stack.id === selectedId
          const connected = stack.deployments.every(
            (deployment) => deployment.status.connected
          )
          return (
            <button
              key={stack.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(stack.id)}
              className={cn(
                "relative w-full rounded-md px-3 py-2.5 text-left transition-colors",
                selected
                  ? "bg-primary/12 text-foreground"
                  : "text-muted-foreground hover:bg-accent/55 hover:text-foreground"
              )}
            >
              {selected ? (
                <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-primary" />
              ) : null}
              <span className="block truncate text-xs font-medium">
                {stack.name}
              </span>
              <span className="mt-1 flex items-center gap-1.5 font-mono text-[9px] uppercase">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    connected ? "bg-emerald-500" : "bg-amber-500"
                  )}
                />
                {stack.bindings.length} servers
              </span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
})

const StackServerSelector = React.memo(function StackServerSelector({
  stack,
  selectedServerId,
  onSelect,
}: {
  stack: TailscaleStackOverview
  selectedServerId: string
  onSelect: (id: string) => void
}) {
  const [search, setSearch] = React.useState("")
  const { data: servers = emptyServers } = useQuery({
    ...relaySnapshotQueryOptions(),
    notifyOnChangeProps: ["data"],
    select: selectTailscaleServers,
  })
  const linkedIds = React.useMemo(
    () => new Set(stack.bindings.map((binding) => binding.instanceId)),
    [stack.bindings]
  )
  const visible = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return servers
    return servers.filter((server) =>
      `${server.name} ${server.shortId} ${server.implementation} ${server.relayName}`
        .toLowerCase()
        .includes(query)
    )
  }, [search, servers])
  const effectiveSelectedId = servers.some(
    (server) => server.id === selectedServerId
  )
    ? selectedServerId
    : (servers[0]?.id ?? "")

  return (
    <section className="flex min-h-0 min-w-0 flex-col border-b border-border/60 md:border-r md:border-b-0">
      <div className="border-b border-border/60 p-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search servers…"
            aria-label="Search servers"
            className="h-9 pl-8 text-base md:text-sm"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {visible.map((server) => {
          const selected = server.id === effectiveSelectedId
          const binding = stack.bindings.find(
            (candidate) =>
              candidate.instanceId === server.id &&
              candidate.relayId === server.relayId
          )
          return (
            <button
              key={server.routeId}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(server.id)}
              className={cn(
                "group flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-left transition-colors",
                selected
                  ? "border-primary/25 bg-primary/10"
                  : "hover:bg-accent/45"
              )}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-background/70 text-muted-foreground">
                <ServerTypeIcon
                  implementation={server.implementation}
                  className="size-4"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {server.name}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                  {binding
                    ? `${binding.hostname}.${stack.domain}`
                    : server.shortId}
                </span>
              </span>
              <span
                className={cn(
                  "size-2 rounded-full",
                  linkedIds.has(server.id)
                    ? "bg-emerald-500"
                    : "bg-muted-foreground/25"
                )}
              />
            </button>
          )
        })}
        {visible.length === 0 ? (
          <div className="grid min-h-48 place-items-center text-center text-sm text-muted-foreground">
            No servers found
          </div>
        ) : null}
      </div>
    </section>
  )
})

const StackDetails = React.memo(function StackDetails({
  stack,
  selectedServerId,
}: {
  stack: TailscaleStackOverview
  selectedServerId: string
}) {
  const queryClient = useQueryClient()
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [removeOpen, setRemoveOpen] = React.useState(false)
  const { data: servers = emptyServers } = useQuery({
    ...relaySnapshotQueryOptions(),
    notifyOnChangeProps: ["data"],
    select: selectTailscaleServers,
  })
  const server =
    servers.find((instance) => instance.id === selectedServerId) ??
    servers[0] ??
    null
  const binding = server
    ? stack.bindings.find(
        (candidate) =>
          candidate.instanceId === server.id &&
          candidate.relayId === server.relayId
      )
    : null
  const deployment = server
    ? stack.deployments.find(
        (candidate) => candidate.relayId === server.relayId
      )
    : null
  const [hostname, setHostname] = React.useState(
    binding?.hostname ?? (server ? defaultHostname(server) : "")
  )
  const [authKey, setAuthKey] = React.useState("")
  const saveMutation = useMutation({
    mutationFn: (input: SaveStackInput) =>
      saveTailscaleStack({ data: input }),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.tailscaleStacks, next)
      setAuthKey("")
    },
  })
  const removeMutation = useMutation({
    mutationFn: () => removeTailscaleStack({ data: { id: stack.id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.tailscaleStacks,
      })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.relay.snapshot,
      })
      setRemoveOpen(false)
    },
  })

  if (!server) {
    return (
      <aside className="grid min-h-64 place-items-center p-6 text-center text-sm text-muted-foreground">
        Select a server
      </aside>
    )
  }

  const nextBindings = binding
    ? stack.bindings.map((candidate) =>
        candidate.instanceId === server.id &&
        candidate.relayId === server.relayId
          ? { ...candidate, hostname }
          : candidate
      )
    : [
        ...stack.bindings,
        {
          address: "",
          hostname,
          instanceId: server.id,
          relayId: server.relayId,
          relayName: server.relayName,
        },
      ]
  const submit = (bindings: typeof stack.bindings) =>
    saveMutation.mutate({
      authKey: authKey.trim() || undefined,
      bindings: bindings.map(
        ({ hostname: name, instanceId, relayId }) => ({
          hostname: name,
          instanceId,
          relayId,
        })
      ),
      domain: stack.domain,
      id: stack.id,
      name: stack.name,
    })

  return (
    <aside className="flex min-h-0 flex-col">
      <div className="flex h-12 items-center justify-between border-b border-border/60 px-4">
        <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          Server
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Configure network"
          onClick={() => setEditorOpen(true)}
        >
          <Settings2 className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg border bg-card">
            <ServerTypeIcon
              implementation={server.implementation}
              className="size-4"
            />
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-heading font-semibold">{server.name}</h2>
            <p className="font-mono text-[10px] text-muted-foreground">
              {server.shortId} · {server.relayName}
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between border-y py-4">
          <div>
            <p className="text-sm font-medium">Tailnet access</p>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground uppercase">
              {binding ? "Connected" : "Disconnected"}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-label={`${binding ? "Disconnect" : "Connect"} ${server.name} from ${stack.name}`}
            aria-checked={Boolean(binding)}
            disabled={
              saveMutation.isPending ||
              (!binding && !deployment && !authKey.trim())
            }
            onClick={() =>
              binding
                ? submit(
                    stack.bindings.filter(
                      (candidate) =>
                        !(
                          candidate.instanceId === server.id &&
                          candidate.relayId === server.relayId
                        )
                    )
                  )
                : submit(nextBindings)
            }
            className={cn(
              "relative h-6 w-11 rounded-full border transition-colors disabled:opacity-50",
              binding
                ? "border-primary bg-primary"
                : "border-border bg-muted"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-4.5 rounded-full bg-white shadow-sm transition-transform",
                binding ? "translate-x-4.5" : "translate-x-0.5"
              )}
            />
          </button>
        </div>

        <label className="mt-5 block">
          <span className="mb-2 block font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
            Hostname
          </span>
          <div className="flex">
            <Input
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
              disabled={!binding}
              aria-label={`${server.name} hostname`}
              className="rounded-r-none font-mono text-sm"
            />
            <span className="flex h-9 items-center rounded-r-md border border-l-0 bg-muted/45 px-2 font-mono text-xs text-muted-foreground">
              .{stack.domain}
            </span>
          </div>
        </label>
        {binding ? (
          <Button
            className="mt-3 w-full"
            variant="outline"
            disabled={
              saveMutation.isPending ||
              !hostname.trim() ||
              hostname === binding.hostname
            }
            onClick={() => submit(nextBindings)}
          >
            {saveMutation.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Save hostname
          </Button>
        ) : !deployment ? (
          <label className="mt-4 block">
            <span className="mb-2 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
              <KeyRound className="size-3" />
              Auth key for this node
            </span>
            <Input
              type="password"
              autoComplete="off"
              value={authKey}
              onChange={(event) => setAuthKey(event.target.value)}
              placeholder="tskey-auth-…"
              className="font-mono text-sm"
            />
          </label>
        ) : null}
        {saveMutation.error ? (
          <p className="mt-3 text-xs text-destructive">
            {saveMutation.error.message}
          </p>
        ) : null}

        {binding ? (
          <dl className="mt-6 space-y-3 text-xs">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Private IP</dt>
              <dd className="font-mono">{binding.address}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Node</dt>
              <dd className="truncate font-mono">{server.relayName}</dd>
            </div>
          </dl>
        ) : null}

        <PrivateDnsCard stack={stack} />
      </div>
      <div className="border-t border-border/60 p-3">
        <Button
          variant="ghost"
          className="w-full text-destructive hover:text-destructive"
          onClick={() => setRemoveOpen(true)}
        >
          <Trash2 className="size-4" />
          Remove network
        </Button>
      </div>
      <StackEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        stack={stack}
      />
      <RemoveStackDialog
        open={removeOpen}
        pending={removeMutation.isPending}
        stackName={stack.name}
        onOpenChange={setRemoveOpen}
        onRemove={() => removeMutation.mutate()}
      />
    </aside>
  )
})

const PrivateDnsCard = React.memo(function PrivateDnsCard({
  stack,
}: {
  stack: TailscaleStackOverview
}) {
  const addresses = stack.deployments
    .flatMap((item) =>
      item.status.ipv4Address ? [item.status.ipv4Address] : []
    )
    .join(" · ")
  return (
    <div className="mt-6 rounded-lg border bg-card/45 p-3">
      <div className="flex items-center gap-2 text-xs font-medium">
        <ShieldCheck className="size-3.5 text-primary" />
        Private DNS
      </div>
      <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">
        {addresses || "Waiting for a Tailscale IP"}
      </p>
      <a
        href="https://login.tailscale.com/admin/dns"
        target="_blank"
        rel="noreferrer"
        className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline"
      >
        Configure split DNS for .{stack.domain}
        <ExternalLink className="size-3" />
      </a>
      <a
        href="https://login.tailscale.com/admin/machines"
        target="_blank"
        rel="noreferrer"
        className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
      >
        Approve private subnet routes
        <ExternalLink className="size-3" />
      </a>
    </div>
  )
})

const RemoveStackDialog = React.memo(function RemoveStackDialog({
  open,
  pending,
  stackName,
  onOpenChange,
  onRemove,
}: {
  open: boolean
  pending: boolean
  stackName: string
  onOpenChange: (open: boolean) => void
  onRemove: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove {stackName}?</DialogTitle>
        </DialogHeader>
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          Servers are detached live. Tailscale and CoreDNS are uninstalled from
          every node used by this network.
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={onRemove}>
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})

const StackEditorDialog = React.memo(function StackEditorDialog({
  open,
  onOpenChange,
  stack,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  stack: TailscaleStackOverview | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(42rem,calc(100dvh-2rem))] max-h-none gap-0 overflow-hidden p-0 sm:max-w-[min(62rem,calc(100%-2rem))]">
        <DialogTitle className="sr-only">
          {stack ? "Configure Tailscale" : "Create Tailscale network"}
        </DialogTitle>
        {open ? (
          <StackEditorForm
            key={stack?.id ?? "new"}
            stack={stack}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
})

const StackEditorForm = React.memo(function StackEditorForm({
  stack,
  onDone,
}: {
  stack: TailscaleStackOverview | null
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [newStackId] = React.useState(() => randomStackId())
  const [name, setName] = React.useState(stack?.name ?? "Private Network")
  const [domain, setDomain] = React.useState(stack?.domain ?? "test")
  const [authKey, setAuthKey] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [bindings, setBindings] = React.useState<
    Map<string, { hostname: string; relayId: string }>
  >(
    () =>
      new Map(
        stack?.bindings.map((binding) => [
          serverKey(binding.relayId, binding.instanceId),
          { hostname: binding.hostname, relayId: binding.relayId },
        ]) ?? []
      )
  )
  const { data: servers = emptyServers, isPending } = useQuery({
    ...relaySnapshotQueryOptions(),
    enabled: true,
    notifyOnChangeProps: ["data", "isPending"],
    select: selectTailscaleServers,
  })
  const visible = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return servers
    return servers.filter((server) =>
      `${server.name} ${server.shortId} ${server.relayName}`
        .toLowerCase()
        .includes(query)
    )
  }, [search, servers])
  const mutation = useMutation({
    mutationFn: (input: SaveStackInput) =>
      saveTailscaleStack({ data: input }),
    onSuccess: async (next) => {
      queryClient.setQueryData(queryKeys.tailscaleStacks, next)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.relay.snapshot,
      })
      onDone()
    },
  })
  const toggle = React.useCallback((server: TailscaleServer) => {
    const key = serverKey(server.relayId, server.id)
    setBindings((current) => {
      const next = new Map(current)
      if (next.has(key)) next.delete(key)
      else
        next.set(key, {
          hostname: defaultHostname(server),
          relayId: server.relayId,
        })
      return next
    })
  }, [])
  const updateHostname = React.useCallback(
    (server: TailscaleServer, hostname: string) => {
      const key = serverKey(server.relayId, server.id)
      setBindings((current) => {
        const existing = current.get(key)
        if (!existing) return current
        const next = new Map(current)
        next.set(key, { ...existing, hostname })
        return next
      })
    },
    []
  )
  const selectedRelayIds = new Set(
    [...bindings.values()].map((binding) => binding.relayId)
  )
  const existingRelayIds = new Set(
    stack?.deployments.map((deployment) => deployment.relayId) ?? []
  )
  const needsAuthKey = [...selectedRelayIds].some(
    (relayId) => !existingRelayIds.has(relayId)
  )
  const canSubmit =
    name.trim() &&
    domain.trim() &&
    bindings.size > 0 &&
    (!needsAuthKey || authKey.trim()) &&
    [...bindings.values()].every((binding) => binding.hostname.trim())

  return (
    <form
      className="grid h-full min-h-0 md:grid-cols-[18rem_minmax(0,1fr)]"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate({
          authKey: authKey.trim() || undefined,
          bindings: [...bindings.entries()].map(([key, binding]) => ({
            hostname: binding.hostname,
            instanceId: key.split(":")[1] ?? "",
            relayId: binding.relayId,
          })),
          domain,
          id: stack?.id ?? newStackId,
          name,
        })
      }}
    >
      <aside className="flex min-h-0 flex-col border-b bg-muted/15 md:border-r md:border-b-0">
        <div className="border-b p-5">
          <div className="grid size-10 place-items-center rounded-lg border bg-background text-primary">
            <Network className="size-4" />
          </div>
          <h2 className="mt-4 font-heading text-lg font-semibold">
            {stack ? "Configure Tailscale" : "Create Tailscale"}
          </h2>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <label className="block">
            <span className="mb-2 block text-xs font-medium">Name</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-medium">Domain</span>
            <Input
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="test"
              className="font-mono"
            />
          </label>
          {needsAuthKey ? (
            <label className="block">
              <span className="mb-2 flex items-center gap-1.5 text-xs font-medium">
                <KeyRound className="size-3.5" />
                Auth key
              </span>
              <Input
                type="password"
                autoComplete="off"
                value={authKey}
                onChange={(event) => setAuthKey(event.target.value)}
                placeholder="tskey-auth-…"
                className="font-mono"
              />
            </label>
          ) : null}
        </div>
        <div className="border-t p-4">
          {mutation.error ? (
            <p className="mb-3 text-xs text-destructive">
              {mutation.error.message}
            </p>
          ) : null}
          <Button
            type="submit"
            className="w-full"
            disabled={!canSubmit || mutation.isPending}
          >
            {mutation.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ShieldCheck className="size-4" />
            )}
            {stack ? "Apply changes" : "Install"}
          </Button>
        </div>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="border-b p-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-heading font-semibold">Servers</h3>
            <Badge variant="outline" className="font-mono text-[10px]">
              {bindings.size} selected
            </Badge>
          </div>
          <label className="relative mt-3 block">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search servers…"
              className="pl-8"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {isPending ? (
            <div className="grid h-full place-items-center">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            visible.map((server) => (
              <StackEditorServerRow
                key={server.routeId}
                binding={bindings.get(serverKey(server.relayId, server.id))}
                domain={domain}
                server={server}
                onHostnameChange={updateHostname}
                onToggle={toggle}
              />
            ))
          )}
        </div>
      </section>
    </form>
  )
})

const StackEditorServerRow = React.memo(function StackEditorServerRow({
  binding,
  domain,
  server,
  onHostnameChange,
  onToggle,
}: {
  binding: { hostname: string; relayId: string } | undefined
  domain: string
  server: TailscaleServer
  onHostnameChange: (server: TailscaleServer, hostname: string) => void
  onToggle: (server: TailscaleServer) => void
}) {
  return (
    <div
      className={cn(
        "mb-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-lg border px-3 py-2.5 transition-colors",
        binding
          ? "border-primary/25 bg-primary/6"
          : "border-transparent hover:bg-accent/35"
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-label={`${binding ? "Remove" : "Add"} ${server.name}`}
        aria-checked={Boolean(binding)}
        onClick={() => onToggle(server)}
        className={cn(
          "mt-0.5 grid size-5 place-items-center rounded border",
          binding
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-background"
        )}
      >
        {binding ? <Check className="size-3.5" /> : null}
      </button>
      <div className="min-w-0">
        <button
          type="button"
          className="block w-full text-left"
          onClick={() => onToggle(server)}
        >
          <span className="block truncate text-sm font-medium">
            {server.name}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {server.shortId} · {server.relayName}
          </span>
        </button>
        {binding ? (
          <div className="mt-2 flex">
            <Input
              value={binding.hostname}
              onChange={(event) => onHostnameChange(server, event.target.value)}
              className="h-8 rounded-r-none font-mono text-xs"
              aria-label={`${server.name} hostname`}
            />
            <span className="flex h-8 items-center rounded-r-md border border-l-0 bg-muted/45 px-2 font-mono text-[10px] text-muted-foreground">
              .{domain || "test"}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
})

function defaultHostname(server: TailscaleServer): string {
  const slug = server.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
  return slug || server.shortId
}

function serverKey(relayId: string, instanceId: string): string {
  return `${relayId}:${instanceId}`
}

function randomStackId(): string {
  const bytes = new Uint8Array(20)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    ""
  )
}

const emptyServers: Array<TailscaleServer> = []
