import * as React from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import {
  ArrowDown,
  Check,
  CloudDownload,
  Container,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  WifiOff,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { queryKeys, updateOverviewQueryOptions } from "@/lib/query-options"
import { compareReleaseVersions } from "@/lib/release-version"
import { getSystemUpdateStatus, startSystemUpdate } from "@/server/updates"

type UpdateTarget = {
  component: "hearth" | "relay"
  currentVersion: string | null
  eligible: boolean
  name: string
  reason: string | null
  relayId: string | null
}
type PendingUpdate = UpdateTarget & {
  comparison: -1 | 0 | 1
  version: string
}
type ActiveUpdate = {
  component: "hearth" | "relay"
  operationId: string
  relayId: string
}

const activeUpdateStorageKey = "kiln.active-system-update"

export function InfraUpdatesPage() {
  const queryClient = useQueryClient()
  const { data: overview } = useSuspenseQuery(updateOverviewQueryOptions())
  const [selectedVersion, setSelectedVersion] = React.useState(
    () => overview.releases[0]?.version ?? ""
  )
  const [pending, setPending] = React.useState<PendingUpdate | null>(null)
  const [active, setActive] = React.useState<ActiveUpdate | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)

  React.useEffect(() => {
    const stored = window.localStorage.getItem(activeUpdateStorageKey)
    if (!stored) return
    try {
      const parsed = JSON.parse(stored) as Partial<ActiveUpdate>
      if (
        (parsed.component === "hearth" || parsed.component === "relay") &&
        typeof parsed.operationId === "string" &&
        typeof parsed.relayId === "string"
      ) {
        setActive({
          component: parsed.component,
          operationId: parsed.operationId,
          relayId: parsed.relayId,
        })
      }
    } catch {
      window.localStorage.removeItem(activeUpdateStorageKey)
    }
  }, [])

  const updateMutation = useMutation({
    mutationFn: (request: PendingUpdate) =>
      startSystemUpdate({
        data: {
          component: request.component,
          relayId: request.relayId,
          version: request.version,
        },
      }),
    onSuccess: ({ operation, relayId }) => {
      const next: ActiveUpdate = {
        component: operation.component,
        operationId: operation.id,
        relayId,
      }
      window.localStorage.setItem(activeUpdateStorageKey, JSON.stringify(next))
      setActive(next)
      setPending(null)
      setMessage(null)
    },
  })

  const operationQuery = useQuery({
    queryKey: active
      ? ["updates", "operation", active.relayId, active.operationId]
      : ["updates", "operation", "idle"],
    queryFn: () =>
      getSystemUpdateStatus({
        data: {
          operationId: active?.operationId ?? "",
          relayId: active?.relayId ?? "",
        },
      }),
    enabled: active !== null,
    refetchInterval: (query) =>
      query.state.data?.status === "failed" ||
      query.state.data?.status === "succeeded"
        ? false
        : 2_000,
    retry: true,
    retryDelay: 2_000,
  })

  React.useEffect(() => {
    const operation = operationQuery.data
    if (!active || !operationQuery.isSuccess) return
    if (operation === null) {
      window.localStorage.removeItem(activeUpdateStorageKey)
      setMessage(
        "The saved update operation could not be found. Check the target container before trying again."
      )
      setActive(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.updates })
      return
    }
    if (operation === undefined || operation.status === "running") return
    window.localStorage.removeItem(activeUpdateStorageKey)
    if (operation.status === "failed") {
      setMessage(
        operation.error ??
          "The update failed. The previous container was restored."
      )
      setActive(null)
      return
    }
    setMessage(`${displayComponent(operation.component)} is now updated.`)
    setActive(null)
    void queryClient.invalidateQueries({ queryKey: queryKeys.updates })
    if (operation.component === "hearth") {
      window.setTimeout(() => window.location.reload(), 750)
    }
  }, [active, operationQuery.data, operationQuery.isSuccess, queryClient])

  const selectedRelease = overview.releases.find(
    (release) => release.version === selectedVersion
  )
  const publishedAtByVersion = React.useMemo(
    () =>
      new Map(
        overview.releases.map(
          (release) => [release.version, release.publishedAt] as const
        )
      ),
    [overview.releases]
  )
  const hearth: UpdateTarget = {
    component: "hearth",
    currentVersion:
      overview.hearth?.currentVersion ?? overview.currentVersion ?? null,
    eligible: overview.hearth?.eligible ?? false,
    name: "Hearth",
    reason:
      overview.hearth?.reason ??
      "Pair a Relay running on Hearth's Docker host to enable updates.",
    relayId: overview.hearth?.relayId ?? null,
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-3 py-3 pb-12 sm:px-5 sm:py-5">
      <section className="overflow-hidden rounded-xl border bg-card/45">
        <div className="flex flex-col gap-4 border-b bg-background/30 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center gap-2 text-primary">
              <CloudDownload className="size-4" />
              <span className="text-[10px] font-semibold tracking-[0.14em] uppercase">
                Release control
              </span>
            </div>
            <h1 className="font-heading text-2xl font-semibold tracking-[-0.04em]">
              System updates
            </h1>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Update Hearth and its Relays from signed-in, public Kiln releases.
              Containers are replaced in place and rolled back when health
              checks fail.
            </p>
          </div>

          <label className="grid min-w-56 gap-1.5 text-[11px] font-medium text-muted-foreground">
            Target release
            <select
              className="h-9 rounded-md border border-input/90 bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              value={selectedVersion}
              onChange={(event) => setSelectedVersion(event.target.value)}
            >
              {overview.releases.map((release) => (
                <option key={release.tag} value={release.version}>
                  {release.version} · {release.channel}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selectedRelease ? (
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 text-[11px] text-muted-foreground sm:px-5">
            <Badge
              variant={
                selectedRelease.channel === "stable" ? "default" : "outline"
              }
            >
              {selectedRelease.channel}
            </Badge>
            <span>
              Published{" "}
              {selectedRelease.publishedAt
                ? new Date(selectedRelease.publishedAt).toLocaleString()
                : "recently"}
            </span>
            <a
              className="ml-auto inline-flex items-center gap-1 text-foreground/75 hover:text-primary"
              href={selectedRelease.url}
              rel="noreferrer"
              target="_blank"
            >
              Release notes <ExternalLink className="size-3" />
            </a>
          </div>
        ) : (
          <div className="border-b px-5 py-4 text-xs text-amber-300">
            No public Kiln releases are available yet.
          </div>
        )}

        <div className="grid gap-px bg-border/70 lg:grid-cols-2">
          <div className="bg-card/95 p-4 sm:p-5">
            <TargetCard
              active={active}
              publishedAtByVersion={publishedAtByVersion}
              selectedVersion={selectedVersion}
              target={hearth}
              onUpdate={setPending}
            />
          </div>
          <div className="bg-card/95 p-4 sm:p-5">
            <div className="mb-4 flex items-start gap-3">
              <div className="grid size-9 place-items-center rounded-lg border bg-background/50 text-muted-foreground">
                <Container className="size-4" />
              </div>
              <div>
                <h2 className="font-heading text-base font-semibold tracking-[-0.02em]">
                  Relays
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Each Relay updates through its own Docker socket.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {overview.relays.map((relay) => (
                <TargetCard
                  active={active}
                  compact
                  key={relay.relayId}
                  publishedAtByVersion={publishedAtByVersion}
                  selectedVersion={selectedVersion}
                  target={{
                    component: "relay",
                    currentVersion: relay.currentVersion,
                    eligible: relay.eligible,
                    name: relay.name,
                    reason: relay.reason,
                    relayId: relay.relayId,
                  }}
                  onUpdate={setPending}
                />
              ))}
              {overview.relays.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-background/30 p-4 text-xs text-muted-foreground">
                  No enabled Relays are paired with Hearth.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 rounded-xl border border-primary/15 bg-primary/[0.035] p-4 sm:grid-cols-[auto_1fr] sm:p-5">
        <ShieldCheck className="mt-0.5 size-5 text-primary" />
        <div>
          <h2 className="text-sm font-semibold">What Kiln preserves</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Update helpers retain Docker environment, mounts, labels, ports,
            restart policy, and networks. Coolify can continue managing the
            replacement container, but its next deployment remains the source of
            truth. Pinned image tags and digests stay read-only here.
          </p>
        </div>
      </section>

      {message ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-xs text-amber-200">
          <TriangleAlert className="mt-px size-4 shrink-0" />
          <span>{message}</span>
        </div>
      ) : null}

      {active ? (
        <UpdateProgress
          component={active.component}
          reconnecting={operationQuery.isError}
          status={operationQuery.data?.status ?? "running"}
        />
      ) : null}

      <UpdateConfirmation
        error={
          updateMutation.error instanceof Error
            ? updateMutation.error.message
            : null
        }
        open={pending !== null}
        pending={updateMutation.isPending}
        target={pending}
        onConfirm={() => {
          if (pending) updateMutation.mutate(pending)
        }}
        onOpenChange={(open) => {
          if (!open && !updateMutation.isPending) {
            updateMutation.reset()
            setPending(null)
          }
        }}
      />
    </div>
  )
}

function TargetCard({
  active,
  compact = false,
  publishedAtByVersion,
  selectedVersion,
  target,
  onUpdate,
}: {
  active: ActiveUpdate | null
  compact?: boolean
  publishedAtByVersion: ReadonlyMap<string, string | null>
  selectedVersion: string
  target: UpdateTarget
  onUpdate: (target: PendingUpdate) => void
}) {
  const isUpdating =
    active?.component === target.component &&
    (target.component === "hearth" || active.relayId === target.relayId)
  const comparison = compareReleaseVersions(
    selectedVersion,
    target.currentVersion,
    publishedAtByVersion
  )
  return (
    <div
      className={
        compact
          ? "rounded-lg border bg-background/35 p-3"
          : "flex min-h-44 flex-col rounded-lg border bg-background/35 p-4"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{target.name}</h3>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {target.currentVersion
              ? `v${target.currentVersion}`
              : "Version unavailable"}
          </p>
        </div>
        <Badge variant={target.eligible ? "outline" : "secondary"}>
          {target.eligible ? "Managed" : "External"}
        </Badge>
      </div>

      {!target.eligible ? (
        <p className="mt-3 flex gap-2 text-[11px] leading-4 text-muted-foreground">
          <WifiOff className="mt-px size-3.5 shrink-0" />
          {target.reason}
        </p>
      ) : (
        <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
          {comparison < 0
            ? "The selected release is older than this container."
            : comparison === 0
              ? "This release is already installed."
              : `Ready to install v${selectedVersion}.`}
        </p>
      )}

      <Button
        className={compact ? "mt-3 w-full" : "mt-auto w-full"}
        disabled={
          !target.eligible || !selectedVersion || isUpdating || active !== null
        }
        size="sm"
        variant={comparison < 0 ? "outline" : "default"}
        onClick={() =>
          onUpdate({ ...target, comparison, version: selectedVersion })
        }
      >
        {isUpdating ? (
          <LoaderCircle className="animate-spin" />
        ) : comparison < 0 ? (
          <ArrowDown />
        ) : comparison === 0 ? (
          <RefreshCw />
        ) : (
          <CloudDownload />
        )}
        {comparison < 0
          ? "Downgrade"
          : comparison === 0
            ? "Reinstall"
            : "Update"}
      </Button>
    </div>
  )
}

function UpdateProgress({
  component,
  reconnecting,
  status,
}: {
  component: "hearth" | "relay"
  reconnecting: boolean
  status: "failed" | "running" | "succeeded"
}) {
  return (
    <div className="fixed right-4 bottom-4 z-40 flex max-w-sm items-center gap-3 rounded-xl border border-primary/25 bg-popover px-4 py-3 shadow-2xl shadow-black/45">
      <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" />
      <div>
        <p className="text-xs font-semibold">
          Updating {displayComponent(component)}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {reconnecting
            ? "Waiting for the service to reconnect…"
            : status === "running"
              ? "Replacing and checking the container…"
              : "Finishing update…"}
        </p>
      </div>
    </div>
  )
}

function UpdateConfirmation({
  error,
  open,
  pending,
  target,
  onConfirm,
  onOpenChange,
}: {
  error: string | null
  open: boolean
  pending: boolean
  target: PendingUpdate | null
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  const downgrade = target?.comparison === -1
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {downgrade ? "Confirm downgrade" : "Confirm system update"}
          </DialogTitle>
          <DialogDescription>
            {target
              ? `${target.name} will restart on v${target.version}. Active connections may briefly disconnect while Docker replaces the container.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        {downgrade ? (
          <div className="flex gap-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-3 text-xs text-amber-100">
            <TriangleAlert className="size-4 shrink-0" />
            <p>
              Downgrades are not compatibility-checked. Data written by the
              newer release may not work with the older one.
            </p>
          </div>
        ) : null}
        {error ? (
          <p className="rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            disabled={pending}
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={pending}
            type="button"
            variant={downgrade ? "destructive" : "default"}
            onClick={onConfirm}
          >
            {pending ? (
              <LoaderCircle className="animate-spin" />
            ) : downgrade ? (
              <ArrowDown />
            ) : (
              <Check />
            )}
            {downgrade ? "Downgrade anyway" : "Begin update"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function displayComponent(component: "hearth" | "relay"): string {
  return component === "hearth" ? "Hearth" : "Relay"
}
