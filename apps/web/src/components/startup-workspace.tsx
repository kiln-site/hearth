import * as React from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  ArrowLeftRight,
  CircleAlert,
  LoaderCircle,
  Play,
  Rocket,
  Save,
} from "lucide-react"
import type { Brick, BrickVariableValue } from "@workspace/contracts"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

import {
  BrickSelectDialog,
  type BrickSelection,
} from "@/components/brick-selector"
import { BrickVariableField } from "@/components/brick-variable-fields"
import { ServerTypeIcon } from "@/components/server-type-icon"
import {
  useInstanceIdentity,
  useInstancePermissions,
  useInstanceRelayConnected,
} from "@/components/instance-workspace-context"
import {
  defaultBrickVariables,
  updateBrickVariable,
} from "@/lib/brick-variables"
import {
  brickCatalogQueryOptions,
  instanceStartupQueryOptions,
  queryKeys,
  replaceRelaySnapshotInstance,
} from "@/lib/query-options"
import type { RelayFleetSnapshot } from "@/lib/relay-fleet"
import { updateInstanceStartup } from "@/server/bricks"

const emptyBricks: Array<Brick> = []

type BrickView = {
  description: string
  game: string
  id: string
  name: string
  source: string
  variables: Brick["variables"]
}

function brickViewFromBrick(brick: Brick, source = brick.source): BrickView {
  return {
    description: brick.metadata.description,
    game: brick.metadata.game,
    id: brick.metadata.id,
    name: brick.metadata.name,
    source,
    variables: brick.variables,
  }
}

export function StartupWorkspace() {
  const instance = useInstanceIdentity()
  const permissions = useInstancePermissions()
  const relayConnected = useInstanceRelayConnected()
  const startupQuery = useQuery(
    instanceStartupQueryOptions(instance.relayId, instance.id)
  )

  if (startupQuery.isPending) {
    return (
      <section className="grid min-h-0 flex-1 place-items-center bg-card">
        <LoaderCircle className="size-5 animate-spin text-primary" />
      </section>
    )
  }

  if (startupQuery.error || !startupQuery.data) {
    return (
      <section className="grid min-h-0 flex-1 place-items-center bg-card px-6 text-center">
        <div className="max-w-sm">
          <CircleAlert className="mx-auto size-5 text-amber-300" />
          <p className="mt-3 text-sm font-semibold">Startup unavailable</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            {startupQuery.error?.message ??
              "This server does not expose Brick startup variables yet."}
          </p>
        </div>
      </section>
    )
  }

  return (
    <StartupForm
      key={`${instance.relayId}:${instance.id}:${startupQuery.dataUpdatedAt}`}
      brick={startupQuery.data.brick}
      brickSource={startupQuery.data.brickSource}
      canEdit={permissions.settings && relayConnected}
      initialVariables={startupQuery.data.variables}
      instanceId={instance.id}
      observedState={startupQuery.data.instance.observedState}
      relayId={instance.relayId}
    />
  )
}

const StartupForm = React.memo(function StartupForm({
  brick: initialBrick,
  brickSource: initialBrickSource,
  canEdit,
  initialVariables,
  instanceId,
  observedState,
  relayId,
}: {
  brick: Brick
  brickSource: string
  canEdit: boolean
  initialVariables: Record<string, BrickVariableValue>
  instanceId: string
  observedState: string
  relayId: string
}) {
  const queryClient = useQueryClient()
  const [view, setView] = React.useState(() =>
    brickViewFromBrick(initialBrick, initialBrickSource)
  )
  const [variables, setVariables] =
    React.useState<Record<string, BrickVariableValue>>(initialVariables)
  const [startAfterSave, setStartAfterSave] = React.useState(
    () => observedState !== "running"
  )
  const [swapOpen, setSwapOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)

  const catalogQuery = useQuery({
    ...brickCatalogQueryOptions(),
    enabled: swapOpen && canEdit,
  })

  const saveMutation = useMutation({
    mutationFn: updateInstanceStartup,
    onSuccess: async (updated) => {
      queryClient.setQueryData<RelayFleetSnapshot>(
        queryKeys.relay.snapshot,
        (current) => {
          const previous = current?.instances.find(
            (item) => item.id === updated.id && item.relayId === relayId
          )
          return replaceRelaySnapshotInstance(current, {
            ...updated,
            name: previous?.name ?? updated.name,
            relayId,
          })
        }
      )
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["relay", relayId, "instances", instanceId, "startup"],
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.relay.snapshot }),
      ])
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2_000)
    },
  })
  const pending = saveMutation.isPending
  const submittingRef = React.useRef(false)

  function applyBrickSelection(selection: BrickSelection) {
    if (selection.kind === "catalog") {
      setView(brickViewFromBrick(selection.brick))
      setVariables(defaultBrickVariables(selection.brick))
      setError(null)
      return
    }
    const source = selection.source.trim()
    setView({
      description: "Custom HTTPS recipe",
      game: "Custom",
      id: "custom",
      name: "Custom Brick",
      source,
      variables: {},
    })
    setVariables({})
    setError(null)
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canEdit || pending || submittingRef.current) return
    setError(null)
    submittingRef.current = true
    try {
      await saveMutation.mutateAsync({
        data: {
          instanceId,
          recipe: view.source,
          relayId,
          start: startAfterSave,
          variables,
        },
      })
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not apply Startup"
      )
    } finally {
      submittingRef.current = false
    }
  }

  const entries = Object.entries(view.variables)
  const catalogBrick =
    catalogQuery.data?.bricks.find((item) => item.source === view.source) ??
    (initialBrick.source === view.source ? initialBrick : null)
  const swapInitial: BrickSelection | null = catalogBrick
    ? { kind: "catalog", brick: catalogBrick }
    : view.id === "custom"
      ? { kind: "custom", source: view.source }
      : initialBrick
        ? { kind: "catalog", brick: initialBrick }
        : null

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-card">
      <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[9px] tracking-[0.18em] text-primary uppercase">
            Startup
          </p>
          <h2 className="font-heading text-xl font-semibold tracking-[-0.03em]">
            Brick configuration
          </h2>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            These options come from the Brick recipe. Saving rebuilds the
            container with the same data volume
            {startAfterSave ? " and starts it" : ""}.
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-3 rounded-xl border border-border/75 bg-background/45 p-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border/80 bg-background/70 text-muted-foreground">
              <ServerTypeIcon
                implementation={view.id}
                className="size-5"
              />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold">{view.name}</p>
                <Badge variant="outline" className="font-mono text-[9px]">
                  {view.game}
                </Badge>
              </div>
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {view.description}
              </p>
              <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground/70">
                {view.source}
              </p>
            </div>
          </div>
          {canEdit ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={pending}
              onClick={() => setSwapOpen(true)}
            >
              <ArrowLeftRight />
              Swap Brick
            </Button>
          ) : null}
        </div>

        <form className="mt-5 space-y-4" onSubmit={onSubmit}>
          {entries.length === 0 ? (
            <div className="rounded-xl border border-border/75 bg-background/45 px-4 py-8 text-center text-xs text-muted-foreground">
              This Brick has no configurable Startup variables.
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-border/75 bg-background/45 p-4">
              {entries.map(([name, definition]) => (
                <BrickVariableField
                  key={name}
                  name={name}
                  definition={definition}
                  value={variables[name]}
                  onChange={(value) => {
                    if (!canEdit) return
                    setVariables((current) =>
                      updateBrickVariable(current, name, value)
                    )
                  }}
                />
              ))}
            </div>
          )}

          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-border/75 bg-background/45 px-4 py-3 text-xs">
            <span>
              <span className="block font-medium">Start after applying</span>
              <span className="mt-0.5 block text-[9px] text-muted-foreground">
                Leave off to keep the server stopped after rebuild.
              </span>
            </span>
            <input
              type="checkbox"
              checked={startAfterSave}
              disabled={!canEdit || pending}
              onChange={(event) => setStartAfterSave(event.target.checked)}
              className="accent-primary"
            />
          </label>

          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!canEdit || pending}>
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : saved ? (
                <Save />
              ) : startAfterSave ? (
                <Play />
              ) : (
                <Rocket />
              )}
              {pending
                ? "Applying…"
                : saved
                  ? "Applied"
                  : startAfterSave
                    ? "Apply & Start"
                    : "Apply Startup"}
            </Button>
            {!canEdit ? (
              <p className="text-[11px] text-muted-foreground">
                Connect the Relay and use an account with settings access to
                change Startup.
              </p>
            ) : null}
          </div>
        </form>
      </div>

      {canEdit ? (
        <StartupBrickSwapDialog
          open={swapOpen}
          onOpenChange={setSwapOpen}
          bricks={catalogQuery.data?.bricks ?? emptyBricks}
          loading={catalogQuery.isPending}
          error={catalogQuery.error?.message ?? null}
          initial={swapInitial}
          onConfirm={applyBrickSelection}
        />
      ) : null}
    </section>
  )
})

const StartupBrickSwapDialog = React.memo(function StartupBrickSwapDialog({
  open,
  onOpenChange,
  bricks,
  loading,
  error,
  initial,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bricks: Array<Brick>
  loading: boolean
  error: string | null
  initial: BrickSelection | null
  onConfirm: (selection: BrickSelection) => void
}) {
  if (loading) {
    return (
      <BrickSelectDialog
        open={open}
        onOpenChange={onOpenChange}
        bricks={[]}
        initial={null}
        title="Swap Brick"
        description="Loading Brick catalog…"
        confirmLabel="Use Brick"
        onConfirm={() => undefined}
      />
    )
  }

  if (error || bricks.length === 0) {
    return (
      <BrickSelectDialog
        open={open}
        onOpenChange={onOpenChange}
        bricks={[]}
        initial={null}
        title="Swap Brick"
        description={
          error ?? "Brick catalog unavailable. Connect a Relay and try again."
        }
        confirmLabel="Use Brick"
        onConfirm={() => undefined}
      />
    )
  }

  return (
    <BrickSelectDialog
      open={open}
      onOpenChange={onOpenChange}
      bricks={bricks}
      initial={initial}
      title="Swap Brick"
      description="Pick another catalog Brick or a custom recipe. Startup options update immediately; apply to rebuild the container."
      confirmLabel="Use Brick"
      onConfirm={onConfirm}
    />
  )
})
