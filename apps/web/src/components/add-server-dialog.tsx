import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Effect } from "effect"
import { CircleAlert, HardDrive, LoaderCircle, Rocket } from "lucide-react"
import {
  DEFAULT_INSTANCE_DISK_LIMIT_BYTES,
  type Brick,
  type BrickVariable,
  type BrickVariableValue,
} from "@workspace/contracts"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import {
  BrickCatalogBrowser,
  type BrickSelection,
} from "@/components/brick-selector"
import {
  MinecraftJavaVersionFields,
  javaVersionDefinition,
} from "@/components/minecraft-java-version-fields"
import {
  defaultBrickInstanceName,
  defaultBrickVariables,
  missingRequiredBrickVersion,
  recommendedSupportedJavaVersion,
  stringVariableAllows,
  supportedJavaVersions,
  unavailableMinecraftJavaVersion,
  withRecommendedMinecraftJava,
} from "@/lib/brick-variables"
import {
  addRelayInstanceToSnapshot,
  relayInstanceRouteId,
  type RelayFleetSnapshot,
} from "@/lib/relay-fleet"
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
const GIBIBYTE_BYTES = 1024 ** 3
const NO_RELAY_OPTION_VALUE = "__no-relay-option__"

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
                <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                  {catalogQuery.error?.message ??
                    "Connect a Relay to load verified Bricks."}
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
      const relay = relays.find((item) => item.id === variables.data.relayId)
      if (!relay) throw new Error("Provisioning Relay is no longer available")

      const addInstance = (snapshot: RelayFleetSnapshot | undefined) =>
        addRelayInstanceToSnapshot(snapshot, instance, relay)
      queryClient.setQueryData(queryKeys.relay.snapshot, addInstance)
      queryClient.setQueryData<RelayConnection>(
        queryKeys.relay.connection,
        (connection) =>
          connection?.status === "connected"
            ? { ...connection, snapshot: addInstance(connection.snapshot)! }
            : connection
      )
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.bricks }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.relay.connection,
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.relay.snapshot }),
      ])
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
  const versionDefinition = minecraftVersionDefinition(selection)

  const relayConnected = useSelectedRelayConnected(relayId)

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
    const formData = new FormData(event.currentTarget)
    const submittedName = formData.get("name")
    const name = typeof submittedName === "string" ? submittedName.trim() : ""
    const diskLimitBytes = diskLimitBytesFromFormValue(
      formData.get("diskLimitGiB")
    )
    if (diskLimitBytes === null) {
      setFailure({
        selectionIdentity,
        message: "Enter a disk quota greater than 0 GiB",
      })
      return
    }
    const submittedVersion = formData.get("version")
    const submittedJavaVersion = formData.get("java_version")
    if (selection.kind === "catalog") {
      const versionDefinition = selection.brick.variables.version
      if (missingRequiredBrickVersion(versionDefinition, submittedVersion)) {
        setFailure({
          selectionIdentity,
          message: "Select a Minecraft version",
        })
        return
      }
      const version =
        typeof submittedVersion === "string" ? submittedVersion.trim() : ""
      if (
        version &&
        versionDefinition &&
        !stringVariableAllows(versionDefinition, version)
      ) {
        setFailure({
          selectionIdentity,
          message: "Enter a valid Minecraft version",
        })
        return
      }
    }
    const configured =
      selection.kind === "catalog"
        ? catalogVariablesForVersion(
            selection.brick,
            submittedVersion,
            submittedJavaVersion
          )
        : { unavailableJavaVersion: null, variables: {}, version: null }
    if (configured.unavailableJavaVersion && configured.version) {
      setFailure({
        selectionIdentity,
        message: `Minecraft ${configured.version} requires Java ${configured.unavailableJavaVersion}, but that Ember is not published yet.`,
      })
      return
    }
    const variables = configured.variables

    submittingRef.current = true
    await Effect.runPromise(
      Effect.tryPromise({
        try: () =>
          onProvision({
            data: {
              diskLimitBytes,
              name: name.trim() || "New server",
              recipe,
              relayId,
              start: false,
              variables,
            },
          }),
        catch: (cause) => cause,
      }).pipe(
        Effect.catch((cause) =>
          Effect.sync(() =>
            setFailure({
              selectionIdentity,
              message:
                cause instanceof Error ? cause.message : "Could not provision",
            })
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
      <p className="font-mono text-[0.625rem] tracking-[0.14em] text-muted-foreground uppercase">
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
      {versionDefinition ? (
        <MinecraftVersionField
          key={`${selectionIdentity}:version`}
          definition={versionDefinition}
          disabled={pending}
          selection={selection}
        />
      ) : null}
      <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
        <span className="flex items-center justify-between gap-3">
          <span>Disk quota</span>
          <span className="font-mono text-[0.5625rem] font-normal tracking-[0.06em] text-muted-foreground/60 uppercase">
            25 GiB default
          </span>
        </span>
        <span className="relative block">
          <HardDrive className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-emerald-300/75" />
          <Input
            name="diskLimitGiB"
            type="number"
            min={0.1}
            step={0.1}
            defaultValue={DEFAULT_INSTANCE_DISK_LIMIT_BYTES / GIBIBYTE_BYTES}
            disabled={pending}
            className="pr-11 pl-8 font-mono tabular-nums"
            required
          />
          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-[0.5625rem] text-muted-foreground/65">
            GiB
          </span>
        </span>
      </label>
      <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
        <span>Relay</span>
        <Select
          value={relayId}
          onValueChange={(value) => {
            if (value !== NO_RELAY_OPTION_VALUE) onRelayIdChange(value)
          }}
          disabled={pending}
          required
        >
          <SelectTrigger className="h-8 w-full [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:flex-1 [&_[data-slot=select-value]]:overflow-hidden [&_[data-slot=select-value]]:text-left [&_[data-slot=select-value]]:text-ellipsis [&_[data-slot=select-value]]:whitespace-nowrap">
            <SelectValue
              placeholder={
                relays.length === 0
                  ? "No Relays available"
                  : compatibleRelays.length === 0
                    ? "No compatible Relays"
                    : "Select a Relay"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {relays.length === 0 ? (
              <SelectItem value={NO_RELAY_OPTION_VALUE} disabled>
                No Relays available
              </SelectItem>
            ) : (
              <>
                {compatibleRelays.length === 0 ? (
                  <SelectItem value={NO_RELAY_OPTION_VALUE} disabled>
                    No compatible Relays
                  </SelectItem>
                ) : null}
                {relays.map((relay) => {
                  const compatible = relaySupportsSelection(relay, selection)
                  return (
                    <SelectItem
                      key={relay.id}
                      value={relay.id}
                      disabled={!compatible}
                    >
                      {relay.name}
                      {compatible
                        ? ""
                        : ` — incompatible (${displayArchitecture(relay.nodeArch)})`}
                    </SelectItem>
                  )
                })}
              </>
            )}
          </SelectContent>
        </Select>
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

function useSelectedRelayConnected(relayId: string): boolean {
  const queryClient = useQueryClient()
  const selectRelayConnected = React.useCallback(
    (connection: RelayConnection) =>
      connection.status === "connected" &&
      connection.relays.some(
        (relay) => relay.id === relayId && relay.status === "connected"
      ),
    [relayId]
  )
  const { data = false } = useQuery({
    ...relayConnectionQueryOptions(queryClient),
    select: selectRelayConnected,
  })
  return data
}

function diskLimitBytesFromFormValue(
  value: FormDataEntryValue | null
): number | null {
  if (typeof value !== "string") return null
  const gibibytes = Number(value)
  if (!Number.isFinite(gibibytes) || gibibytes <= 0) return null
  const bytes = Math.round(gibibytes * GIBIBYTE_BYTES)
  return Number.isSafeInteger(bytes) ? bytes : null
}

function catalogVariablesForVersion(
  brick: Brick,
  value: FormDataEntryValue | null,
  javaValue: FormDataEntryValue | null
): {
  unavailableJavaVersion: string | null
  variables: Record<string, BrickVariableValue>
  version: string | null
} {
  const variables = defaultBrickVariables(brick)
  const version = typeof value === "string" ? value.trim() : ""
  const javaVersion = typeof javaValue === "string" ? javaValue.trim() : ""
  if (!version) {
    return { unavailableJavaVersion: null, variables, version: null }
  }
  variables.version = version
  if (javaVersion) variables.java_version = javaVersion
  const unavailableJavaVersion = unavailableMinecraftJavaVersion(
    brick.metadata.id,
    brick.variables,
    version,
    javaVersion || undefined
  )
  return {
    unavailableJavaVersion,
    variables:
      javaVersion || unavailableJavaVersion
        ? variables
        : withRecommendedMinecraftJava(
            brick.metadata.id,
            brick.variables,
            variables
          ),
    version,
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

const MinecraftVersionField = React.memo(function MinecraftVersionField({
  definition,
  disabled,
  selection,
}: {
  definition: BrickVariable
  disabled: boolean
  selection: BrickSelection | null
}) {
  const brick = selection?.kind === "catalog" ? selection.brick : null
  const defaultVersion =
    definition.default === undefined ? "" : String(definition.default)
  const javaDefinition = brick ? javaVersionDefinition(brick) : null
  const javaVersions = React.useMemo(
    () => (javaDefinition ? supportedJavaVersions(javaDefinition) : []),
    [javaDefinition]
  )
  const [version, setVersion] = React.useState(defaultVersion)
  const recommendedJava =
    brick && javaDefinition
      ? recommendedSupportedJavaVersion(
          brick.metadata.id,
          javaDefinition,
          version
        )
      : null
  const [javaVersion, setJavaVersion] = React.useState(
    recommendedJava ?? javaVersions.at(-1) ?? ""
  )

  if (!brick) return null

  return (
    <MinecraftJavaVersionFields
      brickId={brick.metadata.id}
      disabled={disabled}
      environment={brick.runtime.environment}
      javaInputName="java_version"
      javaVersion={javaVersion}
      onJavaVersionChange={setJavaVersion}
      onVersionChange={setVersion}
      variableDefinitions={brick.variables}
      version={version}
      versionInputName="version"
    />
  )
})

function minecraftVersionDefinition(selection: BrickSelection | null) {
  if (
    selection?.kind !== "catalog" ||
    selection.brick.metadata.game.trim().toLowerCase() !== "minecraft"
  ) {
    return null
  }
  const definition = selection.brick.variables.version
  return definition?.type === "string" ? definition : null
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
