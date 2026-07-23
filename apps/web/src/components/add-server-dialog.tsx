import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { CircleAlert, LoaderCircle, Rocket } from "lucide-react"
import type { Brick } from "@workspace/contracts"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"

import {
  BrickSelectionFields,
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Server</DialogTitle>
          <DialogDescription>
            Choose a Brick and Relay. Provisioning creates the server stopped so
            you can finish Startup before the first boot.
          </DialogDescription>
        </DialogHeader>
        {!catalogQuery.data ? (
          <div className="grid min-h-40 place-items-center text-center">
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
  const [name, setName] = React.useState(() =>
    bricks[0] ? defaultBrickInstanceName(bricks[0]) : ""
  )
  const [relayId, setRelayId] = React.useState(() => relays[0]?.id ?? "")
  const [error, setError] = React.useState<string | null>(null)

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

  const provisionMutation = useMutation({
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
  const pending = provisionMutation.isPending
  const submittingRef = React.useRef(false)

  function changeSelection(next: BrickSelection | null) {
    setSelection(next)
    setError(null)
    if (next?.kind === "catalog") {
      setName(defaultBrickInstanceName(next.brick))
    } else if (next?.kind === "custom") {
      setName((current) =>
        current.trim().length > 0 ? current : "Custom server"
      )
    }
  }

  async function provision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      !relayConnected ||
      !relayId ||
      !selection ||
      pending ||
      submittingRef.current
    ) {
      return
    }
    setError(null)

    const recipe =
      selection.kind === "catalog"
        ? selection.brick.source
        : selection.source.trim()
    if (!recipe) {
      setError("Enter a Brick recipe URL")
      return
    }

    submittingRef.current = true
    try {
      await provisionMutation.mutateAsync({
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
      setError(cause instanceof Error ? cause.message : "Could not provision")
    } finally {
      submittingRef.current = false
    }
  }

  const canProvision =
    relayConnected &&
    Boolean(relayId) &&
    Boolean(selection) &&
    (selection?.kind === "catalog" ||
      (selection?.kind === "custom" && selection.source.trim().length > 0)) &&
    !pending

  return (
    <form className="space-y-5" onSubmit={provision}>
      <BrickSelectionFields
        bricks={bricks}
        selection={selection}
        onSelectionChange={changeSelection}
        disabled={pending}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5 text-[10px] font-medium text-muted-foreground">
          <span>Relay</span>
          <select
            value={relayId}
            onChange={(event) => setRelayId(event.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-ring"
            required
          >
            {relays.length === 0 ? (
              <option value="">No Relays available</option>
            ) : (
              relays.map((relay) => (
                <option key={relay.id} value={relay.id}>
                  {relay.name}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="block space-y-1.5 text-[10px] font-medium text-muted-foreground">
          <span>Display name</span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            placeholder="Survival SMP"
            required
          />
        </label>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </div>
      ) : null}

      {!relayConnected && relayId ? (
        <p className="text-[11px] text-amber-300">
          Selected Relay is not connected. Connect it before provisioning.
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canProvision}>
          {pending ? <LoaderCircle className="animate-spin" /> : <Rocket />}
          Provision
        </Button>
      </DialogFooter>
    </form>
  )
})
