import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Globe2, LoaderCircle, Plus, Trash2 } from "lucide-react"
import { relayInstanceWebRouteSchema } from "@workspace/contracts"
import type { RelayInstanceWebRoute } from "@workspace/contracts"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import {
  useInstanceIdentity,
  useInstancePermissions,
} from "@/components/instance-workspace-context"
import { getInstanceWebRoutes, updateInstanceWebRoutes } from "@/server/relay"

export function InstanceNetworkPage() {
  const instance = useInstanceIdentity()
  const permissions = useInstancePermissions()
  const queryClient = useQueryClient()
  const queryKey = React.useMemo(
    () => ["relay", instance.relayId, "web-routes", instance.id] as const,
    [instance.id, instance.relayId]
  )
  const routes = useQuery({
    enabled: permissions.networkRead,
    queryFn: () =>
      getInstanceWebRoutes({
        data: { instanceId: instance.id, relayId: instance.relayId },
      }),
    queryKey,
  })
  const update = useMutation({
    mutationFn: (next: Array<RelayInstanceWebRoute>) =>
      updateInstanceWebRoutes({
        data: {
          instanceId: instance.id,
          relayId: instance.relayId,
          routes: next,
        },
      }),
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
  })

  if (!permissions.networkRead) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center bg-background/55">
        <p className="text-sm text-muted-foreground">
          You do not have permission to view network routes.
        </p>
      </div>
    )
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background/55 p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <header className="border border-border/80 bg-card/55 p-4">
          <div className="flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center border border-primary/25 bg-primary/10 text-primary">
              <Globe2 className="size-4" />
            </div>
            <div>
              <h1 className="font-heading text-lg font-semibold tracking-tight">
                Web routes
              </h1>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                Route a public hostname—or a path on one—to an HTTP service
                running inside this Ember. Kiln does not create DNS records for
                you.
              </p>
            </div>
          </div>
          <div className="mt-4 flex gap-2 border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] leading-relaxed text-amber-100/80">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
            Point the hostname at this Relay first. Kiln applies route changes
            dynamically; the Ember does not need to restart.
          </div>
        </header>

        {permissions.networkWrite ? (
          <RouteForm
            disabled={update.isPending}
            onAdd={async (route) => {
              await update.mutateAsync([...(routes.data ?? []), route])
            }}
          />
        ) : null}

        <section className="border border-border/80 bg-card/45">
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
            <h2 className="text-sm font-semibold">Configured routes</h2>
            <span className="font-mono text-[10px] text-muted-foreground">
              {routes.data?.length ?? 0} / 16
            </span>
          </div>
          {routes.isLoading ? (
            <div className="flex h-28 items-center justify-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin text-primary" />
              Reading routes from Relay
            </div>
          ) : routes.error ? (
            <p className="px-4 py-8 text-center text-xs text-destructive">
              {errorMessage(routes.error)}
            </p>
          ) : routes.data?.length ? (
            <div className="divide-y divide-border/65">
              {routes.data.map((route) => (
                <RouteRow
                  key={route.id}
                  route={route}
                  removing={update.isPending}
                  canRemove={permissions.networkWrite}
                  onRemove={() =>
                    update.mutateAsync(
                      (routes.data ?? []).filter((item) => item.id !== route.id)
                    )
                  }
                />
              ))}
            </div>
          ) : (
            <p className="px-4 py-10 text-center text-xs text-muted-foreground">
              No public web routes are configured for this Ember.
            </p>
          )}
          {update.error ? (
            <p className="border-t border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
              {errorMessage(update.error)}
            </p>
          ) : null}
        </section>
      </div>
    </main>
  )
}

function RouteForm({
  disabled,
  onAdd,
}: {
  disabled: boolean
  onAdd: (route: RelayInstanceWebRoute) => Promise<void>
}) {
  const [error, setError] = React.useState<string | null>(null)
  return (
    <form
      className="border border-border/80 bg-card/45 p-4"
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const path = String(form.get("path") ?? "").trim()
        const parsed = relayInstanceWebRouteSchema.safeParse({
          hostname: String(form.get("hostname") ?? ""),
          id: crypto.randomUUID(),
          path: path || null,
          stripPrefix: form.get("stripPrefix") === "on",
          targetPort: Number(form.get("targetPort")),
        })
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Route is invalid")
          return
        }
        setError(null)
        const formElement = event.currentTarget
        void onAdd(parsed.data)
          .then(() => formElement.reset())
          .catch((cause) => setError(errorMessage(cause)))
      }}
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(9rem,0.45fr)_7rem]">
        <label className="space-y-1.5 text-[11px] font-medium">
          Hostname
          <Input
            name="hostname"
            placeholder="map.donutsmp.com"
            autoCapitalize="none"
            autoCorrect="off"
            required
          />
        </label>
        <label className="space-y-1.5 text-[11px] font-medium">
          Path (optional)
          <Input name="path" placeholder="/map" />
        </label>
        <label className="space-y-1.5 text-[11px] font-medium">
          Ember port
          <Input
            name="targetPort"
            type="number"
            min={1}
            max={65_535}
            placeholder="8080"
            required
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            name="stripPrefix"
            defaultChecked
            className="accent-primary"
          />
          Strip the configured path before forwarding
        </label>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="submit" size="sm" disabled={disabled}>
              {disabled ? <LoaderCircle className="animate-spin" /> : <Plus />}
              Add route
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Applies dynamically without restarting the Ember
          </TooltipContent>
        </Tooltip>
      </div>
      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
    </form>
  )
}

const RouteRow = React.memo(function RouteRow({
  route,
  removing,
  canRemove,
  onRemove,
}: {
  route: RelayInstanceWebRoute
  removing: boolean
  canRemove: boolean
  onRemove: () => Promise<unknown>
}) {
  const publicUrl = `https://${route.hostname}${route.path ?? ""}`
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span
        className="size-2 shrink-0 bg-amber-300"
        aria-label="DNS unverified"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[11px] text-foreground">
          {publicUrl}
        </p>
        <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">
          HTTP → :{route.targetPort}
          {route.path && route.stripPrefix ? " · prefix stripped" : ""}
          {" · DNS / TLS unverified"}
        </p>
      </div>
      {canRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${publicUrl}`}
          disabled={removing}
          onClick={() => void onRemove().catch(() => undefined)}
        >
          <Trash2 />
        </Button>
      ) : null}
    </div>
  )
})

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The network route failed."
}
