import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Effect } from "effect"
import {
  ArrowLeftRight,
  CircleAlert,
  LoaderCircle,
  Play,
  Rocket,
  Save,
} from "lucide-react"
import type {
  Brick,
  BrickVariableValue,
  RelayInstanceLimits,
} from "@workspace/contracts"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

import {
  BrickSelectDialog,
  type BrickSelection,
} from "@/components/brick-selector"
import { BrickVariableField } from "@/components/brick-variable-fields"
import { ServerTypeIcon } from "@/components/server-type-icon"
import {
  formatResourceBytes,
  ResourceAllocationCard,
  type StartupResourceAllocation,
} from "@/components/startup-resource-allocation"
import {
  useInstanceIdentity,
  useInstancePermissions,
  useInstanceRelayConnected,
} from "@/components/instance-workspace-context"
import { WorkspaceSummaryCard } from "@/components/workspace-summary-card"
import {
  defaultBrickVariables,
  unavailableMinecraftJavaVersion,
  updateBrickVariable,
  withRecommendedMinecraftJava,
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
  memoryTemplate: string
  name: string
  source: string
  variables: Brick["variables"]
}

function brickViewFromBrick(brick: Brick, source = brick.source): BrickView {
  return {
    description: brick.metadata.description,
    game: brick.metadata.game,
    id: brick.metadata.id,
    memoryTemplate: brick.runtime.resources.memory,
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
      allocation={startupQuery.data.allocation}
      initialLimits={startupQuery.data.instance.limits}
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
  allocation,
  initialLimits,
  initialVariables,
  instanceId,
  observedState,
  relayId,
}: {
  brick: Brick
  brickSource: string
  canEdit: boolean
  allocation: StartupResourceAllocation
  initialLimits: RelayInstanceLimits
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
  const [diskLimitGiB, setDiskLimitGiB] = React.useState(() =>
    bytesToGiBInput(initialLimits.diskBytes)
  )
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
      memoryTemplate: "",
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
    const minecraftVersion = variables.version
    const unavailableJavaVersion =
      typeof minecraftVersion === "string"
        ? unavailableMinecraftJavaVersion(
            view.id,
            view.variables,
            minecraftVersion,
            variables.java_version
          )
        : null
    if (unavailableJavaVersion) {
      setError(
        `Minecraft ${minecraftVersion} requires Java ${unavailableJavaVersion}, but that Ember is not published yet.`
      )
      return
    }
    const diskLimitBytes = gibibytesToBytes(diskLimitGiB)
    if (diskLimitBytes === null) {
      setError("Enter a valid disk quota in GiB.")
      return
    }
    if (
      diskLimitBytes > 0 &&
      diskLimitBytes > allocation.storage.availableBytes
    ) {
      setError(
        `Disk quota exceeds the ${formatResourceBytes(allocation.storage.availableBytes)} available to this server.`
      )
      return
    }
    const memoryLimitBytes = resolvedMemoryBytes(view.memoryTemplate, variables)
    if (
      memoryLimitBytes !== null &&
      memoryLimitBytes > allocation.memory.availableBytes
    ) {
      setError(
        `Container memory exceeds the ${formatResourceBytes(allocation.memory.availableBytes)} available to this server.`
      )
      return
    }
    submittingRef.current = true
    await Effect.runPromise(
      Effect.tryPromise({
        try: () =>
          saveMutation.mutateAsync({
            data: {
              diskLimitBytes,
              instanceId,
              recipe: view.source,
              relayId,
              start: startAfterSave,
              variables,
            },
          }),
        catch: (cause) => cause,
      }).pipe(
        Effect.catch((cause) =>
          Effect.sync(() =>
            setError(
              cause instanceof Error ? cause.message : "Could not apply Startup"
            )
          )
        ),
        Effect.ensuring(
          Effect.sync(() => {
            submittingRef.current = false
          })
        )
      )
    )
  }

  const configuredMemoryBytes =
    resolvedMemoryBytes(view.memoryTemplate, variables) ??
    initialLimits.memoryBytes
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

        <BrickSummary
          view={view}
          canEdit={canEdit}
          pending={pending}
          onSwap={() => setSwapOpen(true)}
        />

        <StartupSettingsForm
          allocation={allocation}
          canEdit={canEdit}
          configuredMemoryBytes={configuredMemoryBytes}
          diskLimitGiB={diskLimitGiB}
          error={error}
          pending={pending}
          saved={saved}
          startAfterSave={startAfterSave}
          variableDefinitions={view.variables}
          variables={variables}
          onDiskLimitChange={setDiskLimitGiB}
          onStartAfterSaveChange={setStartAfterSave}
          onSubmit={onSubmit}
          onVariableChange={(name, value) => {
            if (!canEdit) return
            setVariables((current) => {
              const updated = updateBrickVariable(current, name, value)
              return name === "version"
                ? withRecommendedMinecraftJava(view.id, view.variables, updated)
                : updated
            })
          }}
        />
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

function StartupSettingsForm({
  allocation,
  canEdit,
  configuredMemoryBytes,
  diskLimitGiB,
  error,
  pending,
  saved,
  startAfterSave,
  variableDefinitions,
  variables,
  onDiskLimitChange,
  onStartAfterSaveChange,
  onSubmit,
  onVariableChange,
}: {
  allocation: StartupResourceAllocation
  canEdit: boolean
  configuredMemoryBytes: number
  diskLimitGiB: string
  error: string | null
  pending: boolean
  saved: boolean
  startAfterSave: boolean
  variableDefinitions: Brick["variables"]
  variables: Record<string, BrickVariableValue>
  onDiskLimitChange: (value: string) => void
  onStartAfterSaveChange: (value: boolean) => void
  onSubmit: React.FormEventHandler<HTMLFormElement>
  onVariableChange: (
    name: string,
    value: BrickVariableValue | undefined
  ) => void
}) {
  const entries = Object.entries(variableDefinitions)
  return (
    <form className="mt-5 space-y-4" onSubmit={onSubmit}>
      <ResourceAllocationCard
        allocation={allocation}
        configuredMemoryBytes={configuredMemoryBytes}
        diskLimitGiB={diskLimitGiB}
        disabled={!canEdit || pending}
        onDiskLimitChange={onDiskLimitChange}
      />

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
              onChange={(value) => onVariableChange(name, value)}
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
          onChange={(event) => onStartAfterSaveChange(event.target.checked)}
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
            Connect the Relay and use an account with settings access to change
            Startup.
          </p>
        ) : null}
      </div>
    </form>
  )
}

function BrickSummary({
  view,
  canEdit,
  pending,
  onSwap,
}: {
  view: BrickView
  canEdit: boolean
  pending: boolean
  onSwap: () => void
}) {
  return (
    <WorkspaceSummaryCard
      action={
        canEdit ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={pending}
            onClick={onSwap}
          >
            <ArrowLeftRight />
            Swap Brick
          </Button>
        ) : null
      }
      className="mt-6 bg-background/45"
      icon={<ServerTypeIcon implementation={view.id} className="size-5" />}
      title={view.name}
      titleAccessory={
        <Badge variant="outline" className="font-mono text-[9px]">
          {view.game}
        </Badge>
      }
    >
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
        {view.description}
      </p>
      <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground/70">
        {view.source}
      </p>
    </WorkspaceSummaryCard>
  )
}

function resolvedMemoryBytes(
  template: string,
  variables: Readonly<Record<string, BrickVariableValue>>
): number | null {
  const variable = template.match(
    /^\{\{\s*variables\.([a-z][a-z0-9_]{0,47})\s*\}\}$/u
  )?.[1]
  const value = variable ? variables[variable] : template
  return typeof value === "string" ? dockerMemoryBytes(value) : null
}

function dockerMemoryBytes(value: string): number | null {
  const match = value.trim().match(/^(\d+)([bkmgt])$/iu)
  if (!match?.[1] || !match[2]) return null
  const amount = Number(match[1])
  const unit = match[2].toLowerCase()
  const exponent =
    unit === "b"
      ? 0
      : unit === "k"
        ? 1
        : unit === "m"
          ? 2
          : unit === "g"
            ? 3
            : 4
  const bytes = amount * 1024 ** exponent
  return Number.isSafeInteger(bytes) ? bytes : null
}

function gibibytesToBytes(value: string): number | null {
  const gibibytes = Number(value)
  if (!Number.isFinite(gibibytes) || gibibytes <= 0) return null
  const bytes = Math.round(gibibytes * 1024 ** 3)
  return Number.isSafeInteger(bytes) ? bytes : null
}

function bytesToGiBInput(bytes: number): string {
  return String(Number((bytes / 1024 ** 3).toFixed(2)))
}

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
