import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { CircleAlert, LoaderCircle, Rocket } from "lucide-react"
import type { Brick } from "@workspace/contracts"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"

import {
  BrickCatalogBrowser,
  type BrickSelection,
} from "@/components/brick-selector"
import {
  defaultBrickInstanceName,
  defaultBrickVariables,
} from "@/lib/brick-variables"
import { relayInstanceRouteId } from "@/lib/relay-fleet"
import type { PersistedRelay } from "@/lib/relay-registry"
import {
  brickCatalogQueryOptions,
  queryKeys,
  relayConnectionQueryOptions,
} from "@/lib/query-options"
import type { RelayConnection } from "@/lib/query-options"
import { createBrickInstance } from "@/server/bricks"

type AddServerDialogState = { kind: "closed" } | { kind: "open" }
type CreateBrickInstanceInput = Parameters<typeof createBrickInstance>[0]

export interface AddServerDialogStore {
  close: () => void
  getServerSnapshot: () => AddServerDialogState
  getSnapshot: () => AddServerDialogState
  open: () => void
  subscribe: (listener: () => void) => () => void
}

const closedState: AddServerDialogState = { kind: "closed" }

export function createAddServerDialogStore(): AddServerDialogStore {
  let state = closedState
  const listeners = new Set<() => void>()

  function publish(next: AddServerDialogState) {
    if (next === state) return
    state = next
    for (const listener of listeners) listener()
  }

  return {
    close: () => publish(closedState),
    getServerSnapshot: () => closedState,
    getSnapshot: () => state,
    open: () => publish({ kind: "open" }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export const AddServerDialogHost = React.memo(function AddServerDialogHost({
  store,
}: {
  store: AddServerDialogStore
}) {
  const state = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot
  )
  return (
    <AddServerDialog
      open={state.kind === "open"}
      onOpenChange={(open) => {
        if (!open) store.close()
      }}
    />
  )
})

const AddServerDialog = React.memo(function AddServerDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const catalogQuery = useQuery({
    ...brickCatalogQueryOptions(),
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(36rem,calc(100dvh-2rem))] max-h-none gap-0 overflow-hidden p-0 sm:max-w-[calc(100%-2rem)] xl:max-w-5xl">
        <DialogTitle className="sr-only">Add Server</DialogTitle>
        {!catalogQuery.data ? (
          <div className="grid min-h-56 place-items-center text-center">
            {catalogQuery.isPending ? (
              <LoaderCircle className="size-5 animate-spin text-primary" />
            ) : (
              <div className="max-w-sm">
                <CircleAlert className="mx-auto size-5 text-amber-300" />
                <p className="mt-2 text-sm font-semibold">
                  Brick catalog unavailable
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {catalogQuery.error?.message ??
                    "Connect a Relay to load official Bricks."}
                </p>
              </div>
            )}
          </div>
        ) : (
          <AddServerForm
            bricks={catalogQuery.data.bricks}
            relays={catalogQuery.data.relays}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
})

const AddServerForm = React.memo(function AddServerForm({
  bricks,
  relays,
  onClose,
}: {
  bricks: Array<Brick>
  relays: Array<PersistedRelay>
  onClose: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [selection, setSelection] = React.useState<BrickSelection | null>(() =>
    bricks[0] ? { kind: "catalog", brick: bricks[0] } : null
  )
  const [relayId, setRelayId] = React.useState(() => relays[0]?.id ?? "")

  const { isPending: pending, mutateAsync: provisionServer } = useMutation({
    mutationFn: createBrickInstance,
    onSuccess: async (instance, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.bricks }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.relay.connection,
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.relay.snapshot }),
      ])
      onClose()
      await navigate({
        to: "/server/$serverId/startup",
        params: {
          serverId: relayInstanceRouteId(
            variables.data.relayId,
            instance.shortId
          ),
        },
      })
    },
  })

  const changeSelection = React.useCallback((next: BrickSelection | null) => {
    setSelection(next)
  }, [])

  return (
    <BrickCatalogBrowser
      bricks={bricks}
      selection={selection}
      onSelectionChange={changeSelection}
      disabled={pending}
      className="h-full rounded-none border-0 bg-transparent"
      configuration={
        <AddServerConfiguration
          selection={selection}
          relays={relays}
          relayId={relayId}
          onRelayIdChange={setRelayId}
          onClose={onClose}
          onProvision={provisionServer}
          pending={pending}
        />
      }
    />
  )
})

const AddServerConfiguration = React.memo(function AddServerConfiguration({
  selection,
  relays,
  relayId,
  onRelayIdChange,
  onClose,
  onProvision,
  pending,
}: {
  selection: BrickSelection | null
  relays: Array<PersistedRelay>
  relayId: string
  onRelayIdChange: (relayId: string) => void
  onClose: () => void
  onProvision: (input: CreateBrickInstanceInput) => Promise<unknown>
  pending: boolean
}) {
  const queryClient = useQueryClient()
  const selectionName =
    selection?.kind === "catalog"
      ? defaultBrickInstanceName(selection.brick)
      : selection?.kind === "custom"
        ? "Custom server"
        : ""
  const selectionIdentity =
    selection?.kind === "catalog"
      ? selection.brick.source
      : (selection?.kind ?? "none")
  const [failure, setFailure] = React.useState<{
    selectionIdentity: string
    message: string
  } | null>(null)
  const error =
    failure?.selectionIdentity === selectionIdentity ? failure.message : null
  const compatibleRelays = relays.filter((relay) =>
    relaySupportsSelection(relay, selection)
  )
  const selectedRelay = relays.find((relay) => relay.id === relayId)
  const relayCompatible =
    selectedRelay !== undefined &&
    relaySupportsSelection(selectedRelay, selection)

  const selectRelayConnected = React.useCallback(
    (connection: RelayConnection) =>
      connection.status === "connected" &&
      connection.relays.some(
        (relay) => relay.id === relayId && relay.status === "connected"
      ),
    [relayId]
  )
  const { data: relayConnected = false } = useQuery({
    ...relayConnectionQueryOptions(queryClient),
    select: selectRelayConnected,
  })

  const submittingRef = React.useRef(false)

  async function provision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      !relayConnected ||
      !relayId ||
      !relayCompatible ||
      !selection ||
      pending ||
      submittingRef.current
    ) {
      return
    }
    setFailure(null)

    const recipe =
      selection.kind === "catalog"
        ? selection.brick.source
        : selection.source.trim()
    if (!recipe) {
      setFailure({
        selectionIdentity,
        message: "Enter a Brick recipe URL",
      })
      return
    }
    const submittedName = new FormData(event.currentTarget).get("name")
    const name = typeof submittedName === "string" ? submittedName.trim() : ""

    submittingRef.current = true
    try {
      await onProvision({
        data: {
          name: name.trim() || "New server",
          recipe,
          relayId,
          start: false,
          variables:
            selection.kind === "catalog"
              ? defaultBrickVariables(selection.brick)
              : {},
        },
      })
    } catch (cause) {
      setFailure({
        selectionIdentity,
        message: cause instanceof Error ? cause.message : "Could not provision",
      })
    } finally {
      submittingRef.current = false
    }
  }

  const canProvision =
    relayConnected &&
    Boolean(relayId) &&
    relayCompatible &&
    Boolean(selection) &&
    (selection?.kind === "catalog" ||
      (selection?.kind === "custom" && selection.source.trim().length > 0)) &&
    !pending

  return (
    <form className="space-y-3" onSubmit={provision}>
      <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
        Server details
      </p>
      <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
        <span>Server name</span>
        <Input
          key={selectionIdentity}
          name="name"
          defaultValue={selectionName}
          maxLength={120}
          placeholder="Server name"
          disabled={pending}
          required
        />
      </label>
      <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
        <span>Relay</span>
        <select
          value={relayId}
          onChange={(event) => onRelayIdChange(event.target.value)}
          disabled={pending}
          className="h-8 w-full rounded-md border border-input bg-input/18 px-2.5 text-sm transition-[border-color,background-color,box-shadow] duration-150 outline-none hover:bg-input/24 focus-visible:border-ring/75 focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50"
          required
        >
          {relays.length === 0 ? (
            <option value="">No Relays available</option>
          ) : (
            <>
              {compatibleRelays.length === 0 ? (
                <option value="">No compatible Relays</option>
              ) : null}
              {relays.map((relay) => {
                const compatible = relaySupportsSelection(relay, selection)
                return (
                  <option
                    key={relay.id}
                    value={relay.id}
                    disabled={!compatible}
                  >
                    {relay.name} - {relayDisplayHost(relay)}
                    {compatible
                      ? ""
                      : ` — incompatible (${displayArchitecture(relay.nodeArch)})`}
                  </option>
                )
              })}
            </>
          )}
        </select>
      </label>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </div>
      ) : null}

      {relayCompatible && !relayConnected && relayId ? (
        <p className="text-xs leading-relaxed text-amber-300">
          Selected Relay is not connected.
        </p>
      ) : null}

      {selectedRelay && !relayCompatible ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/8 px-3 py-2 text-xs leading-relaxed text-amber-200">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {selectedRelay.name} runs{" "}
            {displayArchitecture(selectedRelay.nodeArch)}, which this Brick does
            not support. Choose a compatible Relay to provision.
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canProvision}>
          {pending ? <LoaderCircle className="animate-spin" /> : <Rocket />}
          Provision
        </Button>
      </div>
    </form>
  )
})

function relayDisplayHost(relay: PersistedRelay): string {
  try {
    return new URL(relay.browserOrigin).hostname || relay.hostname
  } catch {
    return relay.hostname
  }
}

function relaySupportsSelection(
  relay: PersistedRelay,
  selection: BrickSelection | null
): boolean {
  if (selection?.kind !== "catalog" || !relay.nodeArch) return true
  const architectures = selection.brick.constraints.architectures
  if (!architectures || architectures.length === 0) return true
  const relayArchitecture = normalizeArchitecture(relay.nodeArch)
  return architectures.some(
    (architecture) => normalizeArchitecture(architecture) === relayArchitecture
  )
}

function normalizeArchitecture(architecture: string): string {
  switch (architecture.trim().toLowerCase()) {
    case "x64":
    case "x86-64":
    case "x86_64":
      return "amd64"
    case "aarch64":
      return "arm64"
    default:
      return architecture.trim().toLowerCase()
  }
}

function displayArchitecture(architecture: string | null): string {
  return architecture ? normalizeArchitecture(architecture) : "unknown"
}
