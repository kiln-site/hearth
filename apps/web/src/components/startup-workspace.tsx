import * as React from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  CircleAlert,
  LoaderCircle,
  Play,
  Rocket,
  Save,
} from "lucide-react"
import type { Brick, BrickVariableValue } from "@workspace/contracts"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

import { BrickVariableField } from "@/components/brick-variable-fields"
import {
  useInstanceIdentity,
  useInstancePermissions,
  useInstanceRelayConnected,
} from "@/components/instance-workspace-context"
import { updateBrickVariable } from "@/lib/brick-variables"
import {
  instanceStartupQueryOptions,
  queryKeys,
  replaceRelaySnapshotInstance,
} from "@/lib/query-options"
import type { RelayFleetSnapshot } from "@/lib/relay-fleet"
import { updateInstanceStartup } from "@/server/bricks"

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
      brickName={startupQuery.data.brick.metadata.name}
      brickSource={startupQuery.data.brickSource}
      canEdit={permissions.settings && relayConnected}
      definitions={startupQuery.data.brick.variables}
      initialVariables={startupQuery.data.variables}
      instanceId={instance.id}
      observedState={startupQuery.data.instance.observedState}
      relayId={instance.relayId}
    />
  )
}

const StartupForm = React.memo(function StartupForm({
  brickName,
  brickSource,
  canEdit,
  definitions,
  initialVariables,
  instanceId,
  observedState,
  relayId,
}: {
  brickName: string
  brickSource: string
  canEdit: boolean
  definitions: Brick["variables"]
  initialVariables: Record<string, BrickVariableValue>
  instanceId: string
  observedState: string
  relayId: string
}) {
  const queryClient = useQueryClient()
  const [variables, setVariables] =
    React.useState<Record<string, BrickVariableValue>>(initialVariables)
  const [startAfterSave, setStartAfterSave] = React.useState(
    () => observedState !== "running"
  )
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)

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

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canEdit) return
    setError(null)
    try {
      await saveMutation.mutateAsync({
        data: {
          instanceId,
          recipe: brickSource,
          relayId,
          start: startAfterSave,
          variables,
        },
      })
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not apply Startup"
      )
    }
  }

  const entries = Object.entries(definitions)
  const pending = saveMutation.isPending

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-card">
      <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[9px] tracking-[0.18em] text-primary uppercase">
            Startup
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-xl font-semibold tracking-[-0.03em]">
              Brick configuration
            </h2>
            <Badge variant="outline" className="font-mono text-[9px]">
              {brickName}
            </Badge>
          </div>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            These options come from the Brick recipe. Saving rebuilds the
            container with the same data volume
            {startAfterSave ? " and starts it" : ""}.
          </p>
          <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground/70">
            {brickSource}
          </p>
        </div>

        <form className="mt-7 space-y-4" onSubmit={onSubmit}>
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
    </section>
  )
})
