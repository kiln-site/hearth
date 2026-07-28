import * as React from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  KeyRound,
  LoaderCircle,
  Network,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Unplug,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Switch } from "@workspace/ui/components/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import {
  WorkspaceDataTable,
  WorkspaceTableCell,
  WorkspaceTableHead,
  WorkspaceTableHeading,
  createWorkspaceTableSearchStore,
  useWorkspaceTableSearchInput,
} from "@/components/workspace-data-table"
import type { WorkspaceTableSearchStore } from "@/components/workspace-data-table"
import {
  queryKeys,
  relaySnapshotQueryOptions,
  tailscaleStacksQueryOptions,
} from "@/lib/query-options"
import type { InstanceWorkspaceInstance } from "@/lib/relay-selectors"
import {
  defaultTailscaleHostname,
  selectTailscaleServers,
  tailscaleServerKey,
} from "@/lib/tailscale-selectors"
import type { TailscaleServer } from "@/lib/tailscale-selectors"
import {
  showTailscaleOperationError,
  showTailscaleOperationProgress,
  showTailscaleOperationSuccess,
  tailscaleOperationToastId,
  type TailscaleOperation,
} from "@/lib/tailscale-operation-toasts"
import {
  saveTailscaleStack,
  type TailscaleStackOverview,
} from "@/server/tailscale"

type StackBinding = TailscaleStackOverview["bindings"][number]
type SaveStackInput = Parameters<typeof saveTailscaleStack>[0]["data"]

const emptyServers: Array<TailscaleServer> = []

export function TailscaleNetworkMembershipPage({
  stackId,
}: {
  stackId: string
}) {
  const [searchStore] = React.useState(createWorkspaceTableSearchStore)
  const { data: stacks } = useSuspenseQuery(tailscaleStacksQueryOptions())
  const { data: servers = emptyServers, isPending: serversPending } = useQuery({
    ...relaySnapshotQueryOptions(),
    notifyOnChangeProps: ["data", "isPending"],
    select: selectTailscaleServers,
  })
  const stack = stacks.find((candidate) => candidate.id === stackId)
  const save = useStackMembershipMutation()

  if (!stack) {
    return (
      <CenteredNetworkState>
        This Tailscale network is no longer available.
      </CenteredNetworkState>
    )
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background/55 p-3 sm:p-5">
      <section className="mx-auto max-w-[90rem] overflow-hidden rounded-xl border bg-card/45 [contain:paint]">
        <MembershipToolbar searchStore={searchStore} stackName={stack.name} />
        {save.error ? (
          <p
            className="border-b border-destructive/25 bg-destructive/5 px-4 py-2 text-xs text-destructive"
            role="alert"
          >
            {errorMessage(save.error)}
          </p>
        ) : null}
        <TailscaleMembershipTable
          pending={save.isPending}
          searchStore={searchStore}
          servers={servers}
          serversPending={serversPending}
          stack={stack}
          onSave={(bindings, authKey) =>
            save.mutateAsync({ authKey, bindings, stack })
          }
        />
      </section>
    </main>
  )
}

export function GameServerTailscaleSection({
  server,
}: {
  server: InstanceWorkspaceInstance
}) {
  const { data: stacks } = useSuspenseQuery(tailscaleStacksQueryOptions())
  const save = useStackMembershipMutation()
  const [joining, setJoining] = React.useState(false)
  const memberships = React.useMemo(
    () =>
      stacks.flatMap((stack) => {
        const binding = findBinding(stack, server)
        return binding ? [{ binding, stack }] : []
      }),
    [server, stacks]
  )
  const available = React.useMemo(
    () =>
      stacks.filter(
        (stack) =>
          !stack.bindings.some(
            (binding) =>
              binding.relayId === server.relayId &&
              binding.instanceId === server.id
          )
      ),
    [server.id, server.relayId, stacks]
  )

  return (
    <section className="overflow-hidden border border-border/80 bg-card/45">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Network className="size-4 shrink-0 text-primary" />
          <h2 className="truncate text-sm font-semibold">Tailscale networks</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <Button asChild size="sm" variant="ghost">
            <Link to="/infra/tailscale">
              <Settings2 />
              Manage
            </Link>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={save.isPending}
            onClick={() => setJoining(true)}
          >
            <Plus />
            Join network
          </Button>
        </div>
      </div>
      {memberships.length ? (
        <div className="divide-y divide-border/65">
          {memberships.map(({ binding, stack }) => (
            <GameServerMembershipRow
              key={stack.id}
              binding={binding}
              pending={save.isPending}
              stack={stack}
              onLeave={() =>
                save.mutateAsync({
                  bindings: stack.bindings.filter(
                    (candidate) =>
                      candidate.relayId !== server.relayId ||
                      candidate.instanceId !== server.id
                  ),
                  stack,
                })
              }
            />
          ))}
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-xs text-muted-foreground">
          This server is not connected to a Tailscale network.
        </p>
      )}
      {save.error ? (
        <p
          className="border-t border-destructive/25 bg-destructive/5 px-4 py-2 text-xs text-destructive"
          role="alert"
        >
          {errorMessage(save.error)}
        </p>
      ) : null}
      {joining ? (
        <JoinNetworkDialog
          networks={available}
          open
          pending={save.isPending}
          server={server}
          onOpenChange={setJoining}
          onJoin={async (stack, hostname, authKey) => {
            await save.mutateAsync({
              authKey,
              bindings: [
                ...stack.bindings,
                {
                  address: "",
                  hostname,
                  instanceId: server.id,
                  relayId: server.relayId,
                  relayName: server.relayName,
                },
              ],
              stack,
            })
            setJoining(false)
          }}
        />
      ) : null}
    </section>
  )
}

const MembershipToolbar = React.memo(function MembershipToolbar({
  searchStore,
  stackName,
}: {
  searchStore: WorkspaceTableSearchStore
  stackName: string
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  useWorkspaceTableSearchInput(inputRef, searchStore)

  return (
    <div className="flex min-w-0 items-center gap-2 border-b bg-background/25 p-3">
      <TailscaleMembershipSyncButton />
      <div className="relative min-w-0 flex-1 sm:max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="search"
          defaultValue={searchStore.getServerSnapshot()}
          onChange={(event) => searchStore.set(event.currentTarget.value)}
          placeholder="Search servers"
          aria-label={`Search servers in ${stackName}`}
          className="pl-9 text-base md:text-sm"
        />
      </div>
      <span className="ml-auto hidden truncate px-2 text-xs font-semibold sm:block">
        {stackName}
      </span>
    </div>
  )
})

const TailscaleMembershipSyncButton = React.memo(
  function TailscaleMembershipSyncButton() {
    const queryClient = useQueryClient()
    const [syncing, setSyncing] = React.useState(false)

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Refresh servers"
            aria-busy={syncing}
            disabled={syncing}
            onClick={() => {
              setSyncing(true)
              void Promise.all([
                queryClient.invalidateQueries({
                  queryKey: queryKeys.tailscaleStacks,
                }),
                queryClient.invalidateQueries({
                  queryKey: queryKeys.relay.snapshot,
                }),
              ]).finally(() => setSyncing(false))
            }}
          >
            <RefreshCw className={syncing ? "animate-spin" : undefined} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Refresh servers</TooltipContent>
      </Tooltip>
    )
  }
)

const TailscaleMembershipTable = React.memo(function TailscaleMembershipTable({
  pending,
  searchStore,
  servers,
  serversPending,
  stack,
  onSave,
}: {
  pending: boolean
  searchStore: WorkspaceTableSearchStore
  servers: Array<TailscaleServer>
  serversPending: boolean
  stack: TailscaleStackOverview
  onSave: (bindings: Array<StackBinding>, authKey?: string) => Promise<unknown>
}) {
  const renderRow = React.useCallback(
    (server: TailscaleServer) => (
      <TailscaleMembershipRow
        pending={pending}
        server={server}
        stack={stack}
        onSave={onSave}
      />
    ),
    [onSave, pending, stack]
  )
  const renderEmpty = React.useCallback(
    (searchActive: boolean) => (
      <div className="grid min-h-52 place-items-center px-6 text-center text-xs text-muted-foreground">
        {serversPending
          ? "Loading servers…"
          : searchActive
            ? "No servers match your search."
            : "No servers are available."}
      </div>
    ),
    [serversPending]
  )

  return (
    <WorkspaceDataTable
      getRowKey={serverRowKey}
      getSearchText={serverSearchText}
      head={<MembershipTableHead />}
      items={servers}
      renderEmpty={renderEmpty}
      renderRow={renderRow}
      searchStore={searchStore}
    />
  )
})

const MembershipTableHead = React.memo(function MembershipTableHead() {
  return (
    <WorkspaceTableHead>
      <WorkspaceTableHeading className="w-auto sm:w-[32%]">
        Server
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="hidden w-[20%] sm:table-cell">
        Node
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="w-[44%] sm:w-[36%]">
        Hostname
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="w-16 text-center sm:w-24">
        Connected
      </WorkspaceTableHeading>
    </WorkspaceTableHead>
  )
})

const TailscaleMembershipRow = React.memo(function TailscaleMembershipRow({
  pending,
  server,
  stack,
  onSave,
}: {
  pending: boolean
  server: TailscaleServer
  stack: TailscaleStackOverview
  onSave: (bindings: Array<StackBinding>, authKey?: string) => Promise<unknown>
}) {
  const binding = findBinding(stack, server)
  const initialHostname = binding?.hostname ?? defaultTailscaleHostname(server)
  const [hostname, setHostname] = React.useState(initialHostname)
  const [authOpen, setAuthOpen] = React.useState(false)
  const deploymentExists = stack.deployments.some(
    (deployment) => deployment.relayId === server.relayId
  )
  const dirty = Boolean(binding && hostname.trim() !== binding.hostname)

  React.useEffect(() => {
    setHostname(initialHostname)
  }, [initialHostname])

  const enable = async (authKey?: string) => {
    await onSave(
      [
        ...stack.bindings,
        {
          address: "",
          hostname: hostname.trim(),
          instanceId: server.id,
          relayId: server.relayId,
          relayName: server.relayName,
        },
      ],
      authKey
    )
    setAuthOpen(false)
  }

  return (
    <>
      <tr className="group transition-colors hover:bg-accent/25">
        <WorkspaceTableCell>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{server.name}</p>
            <p className="truncate font-mono text-[9px] text-muted-foreground">
              {server.shortId}
            </p>
          </div>
        </WorkspaceTableCell>
        <WorkspaceTableCell className="hidden sm:table-cell">
          <span className="truncate text-xs text-muted-foreground">
            {server.relayName}
          </span>
        </WorkspaceTableCell>
        <WorkspaceTableCell>
          <div className="flex min-w-0 items-center gap-1.5">
            <Input
              value={hostname}
              disabled={pending}
              onChange={(event) => setHostname(event.target.value)}
              aria-label={`Hostname for ${server.name}`}
              className="h-8 min-w-0 font-mono text-xs"
            />
            <span className="hidden shrink-0 font-mono text-[9px] text-muted-foreground lg:inline">
              .{stack.domain}
            </span>
            {dirty ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || !hostname.trim()}
                onClick={() =>
                  void onSave(
                    stack.bindings.map((candidate) =>
                      candidate.relayId === server.relayId &&
                      candidate.instanceId === server.id
                        ? { ...candidate, hostname: hostname.trim() }
                        : candidate
                    )
                  )
                }
              >
                Save
              </Button>
            ) : null}
          </div>
        </WorkspaceTableCell>
        <WorkspaceTableCell className="text-center">
          <Switch
            checked={Boolean(binding)}
            disabled={pending || !hostname.trim()}
            aria-label={`${binding ? "Disconnect" : "Connect"} ${server.name}`}
            onCheckedChange={(checked) => {
              if (!checked) {
                void onSave(
                  stack.bindings.filter(
                    (candidate) =>
                      candidate.relayId !== server.relayId ||
                      candidate.instanceId !== server.id
                  )
                )
                return
              }
              if (deploymentExists) void enable()
              else setAuthOpen(true)
            }}
          />
        </WorkspaceTableCell>
      </tr>
      {authOpen ? (
        <AuthKeyDialog
          networkName={stack.name}
          open
          pending={pending}
          onOpenChange={setAuthOpen}
          onSubmit={enable}
        />
      ) : null}
    </>
  )
})

const GameServerMembershipRow = React.memo(function GameServerMembershipRow({
  binding,
  pending,
  stack,
  onLeave,
}: {
  binding: StackBinding
  pending: boolean
  stack: TailscaleStackOverview
  onLeave: () => Promise<unknown>
}) {
  return (
    <div className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">{stack.name}</p>
        <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">
          {binding.address}
        </p>
      </div>
      <p className="truncate font-mono text-[10px] text-muted-foreground">
        {binding.hostname}.{stack.domain}
      </p>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => void onLeave().catch(() => undefined)}
      >
        {pending ? <LoaderCircle className="animate-spin" /> : <Unplug />}
        Leave
      </Button>
    </div>
  )
})

const JoinNetworkDialog = React.memo(function JoinNetworkDialog({
  networks,
  open,
  pending,
  server,
  onOpenChange,
  onJoin,
}: {
  networks: Array<TailscaleStackOverview>
  open: boolean
  pending: boolean
  server: InstanceWorkspaceInstance
  onOpenChange: (open: boolean) => void
  onJoin: (
    stack: TailscaleStackOverview,
    hostname: string,
    authKey?: string
  ) => Promise<void>
}) {
  const [selectedId, setSelectedId] = React.useState(networks[0]?.id ?? "")
  const [hostname, setHostname] = React.useState(() =>
    defaultTailscaleHostname(server)
  )
  const [authKey, setAuthKey] = React.useState("")
  const selected =
    networks.find((network) => network.id === selectedId) ?? networks[0]
  const needsAuth = Boolean(
    selected &&
    !selected.deployments.some(
      (deployment) => deployment.relayId === server.relayId
    )
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Join a Tailscale network</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <label className="block">
            <span className="mb-2 block text-xs font-medium">Network</span>
            <select
              value={selected?.id ?? ""}
              disabled={networks.length === 0}
              onChange={(event) => setSelectedId(event.target.value)}
              className="flex h-9 w-full border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
            >
              {networks.length === 0 ? (
                <option value="">No networks available</option>
              ) : null}
              {networks.map((network) => (
                <option key={network.id} value={network.id}>
                  {network.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-medium">Hostname</span>
            <div className="flex items-center">
              <Input
                value={hostname}
                onChange={(event) => setHostname(event.target.value)}
                className="min-w-0 rounded-r-none font-mono"
              />
              <span className="flex h-9 shrink-0 items-center border border-l-0 border-input bg-muted/30 px-3 font-mono text-xs text-muted-foreground">
                .{selected?.domain}
              </span>
            </div>
          </label>
          {needsAuth ? (
            <label className="block">
              <span className="mb-2 flex items-center gap-1.5 text-xs font-medium">
                <KeyRound className="size-3.5" />
                Auth key for this node
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
        <DialogFooter className="sm:justify-between">
          <Button asChild variant="outline">
            <Link to="/infra/tailscale" search={{ create: true }}>
              <Plus />
              Create network
            </Link>
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                pending ||
                !selected ||
                !hostname.trim() ||
                (needsAuth && !authKey.trim())
              }
              onClick={() => {
                if (!selected) return
                void onJoin(
                  selected,
                  hostname.trim(),
                  needsAuth ? authKey.trim() : undefined
                ).catch(() => undefined)
              }}
            >
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Network />
              )}
              Join
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})

const AuthKeyDialog = React.memo(function AuthKeyDialog({
  networkName,
  open,
  pending,
  onOpenChange,
  onSubmit,
}: {
  networkName: string
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (authKey: string) => Promise<unknown>
}) {
  const [authKey, setAuthKey] = React.useState("")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a node to {networkName}</DialogTitle>
        </DialogHeader>
        <label className="block py-2">
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
            autoFocus
          />
        </label>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || !authKey.trim()}
            onClick={() => void onSubmit(authKey.trim()).catch(() => undefined)}
          >
            {pending ? <LoaderCircle className="animate-spin" /> : <Network />}
            Add node
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})

function useStackMembershipMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      authKey,
      bindings,
      stack,
    }: {
      authKey?: string
      bindings: Array<StackBinding>
      stack: TailscaleStackOverview
    }) =>
      saveTailscaleStack({
        data: stackSaveInput(stack, bindings, authKey),
      }),
    onMutate: ({ bindings, stack }) => {
      const toast = membershipOperationToast(stack, bindings)
      showTailscaleOperationProgress(toast)
      return toast
    },
    onSuccess: async (next) => {
      queryClient.setQueryData(queryKeys.tailscaleStacks, next)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.relay.snapshot,
      })
    },
    onError: (cause, _input, toast) => {
      if (toast) showTailscaleOperationError(toast, cause)
    },
    onSettled: (_data, error, _input, toast) => {
      if (!error && toast) showTailscaleOperationSuccess(toast)
    },
  })
}

function membershipOperationToast(
  stack: TailscaleStackOverview,
  bindings: Array<StackBinding>
) {
  const currentBindingKeys = new Set(stack.bindings.map(stackBindingKey))
  const nextBindingKeys = new Set(bindings.map(stackBindingKey))
  const added = bindings.some(
    (binding) => !currentBindingKeys.has(stackBindingKey(binding))
  )
  const removed = stack.bindings.some(
    (binding) => !nextBindingKeys.has(stackBindingKey(binding))
  )
  const deployedRelayIds = new Set(
    stack.deployments.map(({ relayId }) => relayId)
  )
  const newRelayIds = new Set<string>()
  for (const { relayId } of bindings) {
    if (!deployedRelayIds.has(relayId)) {
      newRelayIds.add(relayId)
    }
  }
  const operation: TailscaleOperation =
    newRelayIds.size > 0
      ? "install"
      : added
        ? "connect"
        : removed
          ? "disconnect"
          : "update"

  return {
    id: tailscaleOperationToastId(stack.id),
    networkName: stack.name,
    nodeCount: operation === "install" ? newRelayIds.size : undefined,
    operation,
  }
}

function stackBindingKey({
  instanceId,
  relayId,
}: Pick<StackBinding, "instanceId" | "relayId">): string {
  return `${relayId}:${instanceId}`
}

function stackSaveInput(
  stack: TailscaleStackOverview,
  bindings: Array<StackBinding>,
  authKey?: string
): SaveStackInput {
  return {
    ...(authKey ? { authKey } : {}),
    bindings: bindings.map(({ hostname, instanceId, relayId }) => ({
      hostname,
      instanceId,
      relayId,
    })),
    domain: stack.domain,
    id: stack.id,
    name: stack.name,
  }
}

function findBinding(
  stack: TailscaleStackOverview,
  server: Pick<TailscaleServer, "id" | "relayId">
) {
  return stack.bindings.find(
    (binding) =>
      binding.relayId === server.relayId && binding.instanceId === server.id
  )
}

function serverRowKey(server: TailscaleServer) {
  return tailscaleServerKey(server.relayId, server.id)
}

function serverSearchText(server: TailscaleServer) {
  return `${server.name} ${server.shortId} ${server.relayName}`
}

function CenteredNetworkState({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center bg-background/55">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

function errorMessage(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : "The Tailscale network could not be updated."
}
