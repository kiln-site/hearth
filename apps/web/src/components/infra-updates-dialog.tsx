import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  CloudDownload,
  Container,
  ExternalLink,
  History,
  LoaderCircle,
  RefreshCw,
  ServerCog,
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
import { Skeleton } from "@workspace/ui/components/skeleton"

import type { PublicKilnRelease } from "@/effect/github-releases"
import { queryKeys, updateOverviewQueryOptions } from "@/lib/query-options"
import {
  compareLatestReleaseVersion,
  compareReleaseVersions,
  isKilnReleaseVersion,
} from "@/lib/release-version"
import type { UpdateOverview } from "@/server/updates"
import { getSystemUpdateStatus, startSystemUpdate } from "@/server/updates"

type UpdateTarget = {
  component: "hearth" | "relay"
  currentVersion: string | null
  eligible: boolean
  key: string
  name: string
  reason: string | null
  relayId: string | null
}

type ActiveUpdate = {
  component: "hearth" | "relay"
  operationId: string
  relayId: string
}

type DialogView = "changelog" | "overview"

const activeUpdateStorageKey = "kiln.active-system-update"
const releaseDateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
})
const lastCheckedFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
})

export const InfraUpdatesDialog = React.memo(function InfraUpdatesDialog({
  initialRelayId,
  open,
  onOpenChange,
}: {
  initialRelayId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const overviewQuery = useQuery({
    ...updateOverviewQueryOptions(),
    enabled: open,
  })
  const [view, setView] = React.useState<DialogView>("overview")
  const [changelogTargetKey, setChangelogTargetKey] = React.useState(() =>
    initialRelayId ? relayTargetKey(initialRelayId) : "hearth"
  )
  const [pending, setPending] = React.useState<UpdateTarget | null>(null)
  const [active, setActive] = React.useState<ActiveUpdate | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [lastCheckedAt, setLastCheckedAt] = React.useState("Not yet")

  React.useEffect(() => {
    if (overviewQuery.dataUpdatedAt === 0) return
    setLastCheckedAt(
      lastCheckedFormatter.format(new Date(overviewQuery.dataUpdatedAt))
    )
  }, [overviewQuery.dataUpdatedAt])

  React.useEffect(() => {
    const stored = window.localStorage.getItem(activeUpdateStorageKey)
    if (!stored) return
    try {
      const parsed: unknown = JSON.parse(stored)
      if (isActiveUpdate(parsed)) setActive(parsed)
    } catch {
      window.localStorage.removeItem(activeUpdateStorageKey)
    }
  }, [])

  const updateMutation = useMutation({
    mutationFn: (target: UpdateTarget) =>
      startSystemUpdate({
        data: {
          component: target.component,
          relayId: target.relayId,
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
    setMessage(
      `${displayComponent(operation.component)} is now running v${operation.version}.`
    )
    setActive(null)
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.updates }),
      queryClient.invalidateQueries({ queryKey: queryKeys.relays }),
    ])
    if (operation.component === "hearth") {
      window.setTimeout(() => window.location.reload(), 750)
    }
  }, [active, operationQuery.data, operationQuery.isSuccess, queryClient])

  const overview = overviewQuery.data
  const targets = React.useMemo(
    () => (overview ? updateTargets(overview) : []),
    [overview]
  )
  const selectedChangelogTarget =
    targets.find((target) => target.key === changelogTargetKey) ??
    targets[0] ??
    null

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          aria-describedby={undefined}
          className="h-[min(46rem,calc(100dvh-2rem))] max-h-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[calc(100%-2rem)] xl:max-w-5xl"
        >
          <div className="border-b bg-background/35 px-5 pt-5">
            <DialogHeader className="flex-row items-center justify-between gap-3 pr-10">
              <DialogTitle className="flex items-center gap-2.5 text-2xl text-white">
                <CloudDownload className="size-5 text-primary" />
                Kiln Updater
              </DialogTitle>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Button
                  aria-busy={overviewQuery.isFetching}
                  aria-label={
                    overviewQuery.isFetching
                      ? "Checking for updates"
                      : "Check for updates"
                  }
                  disabled={overviewQuery.isFetching}
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => void overviewQuery.refetch()}
                >
                  <RefreshCw
                    className={overviewQuery.isFetching ? "animate-spin" : ""}
                  />
                  <span className="hidden sm:inline">
                    {overviewQuery.isFetching
                      ? "Checking..."
                      : "Check for updates"}
                  </span>
                </Button>
                <p className="hidden text-[9px] text-muted-foreground sm:block">
                  Last Checked: {lastCheckedAt}
                </p>
              </div>
            </DialogHeader>

            <div
              aria-label="Update dialog views"
              className="mt-4 flex gap-1"
              role="tablist"
            >
              <ViewButton
                active={view === "overview"}
                label="Overview"
                onClick={() => setView("overview")}
              />
              <ViewButton
                active={view === "changelog"}
                icon={History}
                label="Changelog"
                onClick={() => setView("changelog")}
              />
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto overscroll-contain">
            {overviewQuery.isPending ? (
              <UpdateDialogSkeleton />
            ) : overviewQuery.isError ? (
              <UpdateDialogError
                message={
                  overviewQuery.error instanceof Error
                    ? overviewQuery.error.message
                    : "Update information is unavailable."
                }
                onRetry={() => void overviewQuery.refetch()}
              />
            ) : overview ? (
              view === "overview" ? (
                <UpdateOverviewView
                  active={active}
                  focusedRelayId={initialRelayId}
                  overview={overview}
                  targets={targets}
                  onChangelog={(targetKey) => {
                    setChangelogTargetKey(targetKey)
                    setView("changelog")
                  }}
                  onUpdate={setPending}
                />
              ) : (
                <UpdateChangelogView
                  overview={overview}
                  selectedTarget={selectedChangelogTarget}
                  targets={targets}
                  onTargetChange={setChangelogTargetKey}
                />
              )
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {message ? (
        <UpdateMessage message={message} onDismiss={() => setMessage(null)} />
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
        latestVersion={overview?.releases[0]?.version ?? null}
        open={pending !== null}
        pending={updateMutation.isPending}
        target={pending}
        onConfirm={() => {
          if (pending) updateMutation.mutate(pending)
        }}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !updateMutation.isPending) {
            updateMutation.reset()
            setPending(null)
          }
        }}
      />
    </>
  )
})

function ViewButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon?: typeof History
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-selected={active}
      className={`relative flex h-9 items-center gap-1.5 px-3 text-xs font-medium transition-colors outline-none after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 focus-visible:text-foreground ${
        active
          ? "text-foreground after:bg-primary"
          : "text-muted-foreground after:bg-transparent hover:text-foreground"
      }`}
      role="tab"
      type="button"
      onClick={onClick}
    >
      {Icon ? <Icon className="size-3.5" /> : null}
      {label}
    </button>
  )
}

function UpdateOverviewView({
  active,
  focusedRelayId,
  overview,
  targets,
  onChangelog,
  onUpdate,
}: {
  active: ActiveUpdate | null
  focusedRelayId: string | null
  overview: UpdateOverview
  targets: Array<UpdateTarget>
  onChangelog: (targetKey: string) => void
  onUpdate: (target: UpdateTarget) => void
}) {
  const latestRelease = overview.releases[0] ?? null

  return (
    <div className="p-4 sm:p-5">
      <section className="overflow-hidden rounded-xl border bg-card/45">
        {latestRelease ? (
          <div className="divide-y divide-border/70">
            {targets.map((target, index) => (
              <UpdateTargetRow
                active={active}
                focused={
                  target.component === "relay" &&
                  target.relayId === focusedRelayId
                }
                key={target.key}
                latestVersion={latestRelease.version}
                releases={overview.releases}
                target={target}
                first={index === 0}
                onChangelog={onChangelog}
                onUpdate={onUpdate}
              />
            ))}
          </div>
        ) : (
          <p className="px-4 py-6 text-xs text-amber-300">
            No public Kiln releases are available yet.
          </p>
        )}
      </section>
    </div>
  )
}

function UpdateTargetRow({
  active,
  first,
  focused,
  latestVersion,
  releases,
  target,
  onChangelog,
  onUpdate,
}: {
  active: ActiveUpdate | null
  first: boolean
  focused: boolean
  latestVersion: string
  releases: ReadonlyArray<PublicKilnRelease>
  target: UpdateTarget
  onChangelog: (targetKey: string) => void
  onUpdate: (target: UpdateTarget) => void
}) {
  const rowRef = React.useRef<HTMLDivElement>(null)
  const comparison = compareLatestReleaseVersion(
    target.currentVersion,
    releases
  )
  const updating =
    active?.component === target.component &&
    (target.component === "hearth" || active.relayId === target.relayId)
  const updateAvailable =
    target.eligible && (target.currentVersion === null || comparison === 1)
  const status = targetStatus(target, comparison)
  const Icon = first ? ServerCog : Container

  React.useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ block: "nearest" })
  }, [focused])

  return (
    <div
      ref={rowRef}
      className={`grid gap-3 px-4 py-4 transition-colors sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${
        focused
          ? "bg-amber-400/[0.055] ring-1 ring-amber-400/20 ring-inset"
          : ""
      }`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-lg border ${
            first
              ? "border-primary/25 bg-primary/[0.07] text-primary"
              : "bg-background/55 text-muted-foreground"
          }`}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{target.name}</h3>
            {first ? (
              <Badge variant="outline" className="font-mono text-[8px]">
                HEARTH
              </Badge>
            ) : null}
            <span className={`text-[10px] font-medium ${status.tone}`}>
              {status.label}
            </span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            {displayVersion(target.currentVersion)}
            <span className="mx-2 text-border">→</span>v{latestVersion}
          </p>
          {!target.eligible && target.reason ? (
            <p className="mt-1.5 flex max-w-2xl gap-1.5 text-[10px] leading-4 text-muted-foreground">
              <WifiOff className="mt-px size-3 shrink-0" />
              {target.reason}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2 pl-12 sm:pl-0">
        <Button
          size="sm"
          type="button"
          variant="ghost"
          onClick={() => onChangelog(target.key)}
        >
          <History />
          Changes
        </Button>
        <Button
          size="sm"
          type="button"
          disabled={!updateAvailable || active !== null}
          onClick={() => onUpdate(target)}
        >
          {updating ? (
            <LoaderCircle className="animate-spin" />
          ) : updateAvailable ? (
            <CloudDownload />
          ) : (
            <Check />
          )}
          {updating
            ? "Updating"
            : updateAvailable
              ? "Update"
              : comparison === 0
                ? "Current"
                : "Unavailable"}
        </Button>
      </div>
    </div>
  )
}

function UpdateChangelogView({
  overview,
  selectedTarget,
  targets,
  onTargetChange,
}: {
  overview: UpdateOverview
  selectedTarget: UpdateTarget | null
  targets: Array<UpdateTarget>
  onTargetChange: (targetKey: string) => void
}) {
  const releases = selectedTarget
    ? changelogReleases(overview.releases, selectedTarget.currentVersion)
    : []
  const latestVersion = overview.releases[0]?.version ?? null

  return (
    <div className="p-4 sm:p-5">
      <div
        aria-label="Changelog target"
        className="mb-5 no-scrollbar flex gap-2 overflow-x-auto pb-1"
      >
        {targets.map((target, index) => (
          <button
            aria-pressed={target.key === selectedTarget?.key}
            className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 ${
              target.key === selectedTarget?.key
                ? "border-primary/35 bg-primary/[0.08] text-foreground"
                : "bg-background/35 text-muted-foreground hover:text-foreground"
            }`}
            key={target.key}
            type="button"
            onClick={() => onTargetChange(target.key)}
          >
            {index === 0 ? (
              <ServerCog className="size-3.5 text-primary" />
            ) : (
              <Container className="size-3.5" />
            )}
            <span>
              <span className="block text-xs font-semibold">{target.name}</span>
              <span className="block font-mono text-[8px]">
                {displayVersion(target.currentVersion)}
              </span>
            </span>
          </button>
        ))}
      </div>

      {selectedTarget && latestVersion ? (
        <div className="rounded-xl border bg-card/40 p-4 sm:p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b pb-4">
            <div>
              <p className="text-sm font-semibold">{selectedTarget.name}</p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {displayVersion(selectedTarget.currentVersion)}
                <span className="mx-2 text-border">→</span>v{latestVersion}
              </p>
            </div>
            <Badge variant="outline">
              {releases.length} {releases.length === 1 ? "release" : "releases"}
            </Badge>
          </div>

          {releases.length > 0 ? (
            <div className="relative ml-1 space-y-6 border-l border-border/80 pl-5">
              {releases.map((release, index) => (
                <ChangelogRelease
                  key={release.tag}
                  latest={index === 0}
                  release={release}
                  installed={release.version === selectedTarget.currentVersion}
                />
              ))}
            </div>
          ) : (
            <div className="grid min-h-40 place-items-center text-center">
              <div>
                <Check className="mx-auto size-5 text-emerald-400" />
                <p className="mt-3 text-sm font-semibold">
                  Already on the latest release
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  No newer release notes are waiting for this component.
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
          Changelog information is unavailable.
        </p>
      )}
    </div>
  )
}

function ChangelogRelease({
  installed,
  latest,
  release,
}: {
  installed: boolean
  latest: boolean
  release: PublicKilnRelease
}) {
  return (
    <article>
      <span
        className={`absolute -left-[0.34rem] mt-1.5 size-2.5 rounded-full border-2 border-popover ${
          latest ? "bg-primary" : installed ? "bg-emerald-400" : "bg-border"
        }`}
      />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{release.name}</h3>
            {latest ? <Badge>Latest</Badge> : null}
            {installed ? <Badge variant="outline">Installed</Badge> : null}
          </div>
          <p className="mt-1 font-mono text-[9px] text-muted-foreground">
            v{release.version} · {formatReleaseDate(release.publishedAt)}
          </p>
        </div>
        <a
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-primary"
          href={release.url}
          rel="noreferrer"
          target="_blank"
        >
          GitHub <ExternalLink className="size-3" />
        </a>
      </div>
      <p className="mt-3 max-w-3xl text-[11px] leading-5 whitespace-pre-wrap text-muted-foreground">
        {release.notes ?? "No release notes were published for this version."}
      </p>
    </article>
  )
}

function UpdateDialogSkeleton() {
  return (
    <div className="space-y-4 p-5">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

function UpdateDialogError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="grid min-h-80 place-items-center p-6 text-center">
      <div className="max-w-sm">
        <TriangleAlert className="mx-auto size-6 text-amber-300" />
        <p className="mt-3 text-sm font-semibold">
          Update information is unavailable
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {message}
        </p>
        <Button className="mt-4" size="sm" type="button" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  )
}

function UpdateMessage({
  message,
  onDismiss,
}: {
  message: string
  onDismiss: () => void
}) {
  return (
    <div className="fixed right-4 bottom-4 z-40 flex max-w-sm items-start gap-3 rounded-xl border border-amber-400/20 bg-popover px-4 py-3 shadow-2xl shadow-black/45">
      <TriangleAlert className="mt-px size-4 shrink-0 text-amber-300" />
      <p className="text-xs leading-5 text-muted-foreground">{message}</p>
      <button
        className="text-[10px] text-primary"
        type="button"
        onClick={onDismiss}
      >
        Dismiss
      </button>
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
  latestVersion,
  open,
  pending,
  target,
  onConfirm,
  onOpenChange,
}: {
  error: string | null
  latestVersion: string | null
  open: boolean
  pending: boolean
  target: UpdateTarget | null
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm system update</DialogTitle>
          <DialogDescription>
            {target && latestVersion
              ? `${target.name} will restart on the latest supported release, v${latestVersion}. Active connections may briefly disconnect while Docker replaces the container.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-3 rounded-lg border border-primary/20 bg-primary/[0.05] p-3 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0 text-primary" />
          <p>
            Kiln verifies the replacement container and automatically restores
            the previous one if its health checks fail.
          </p>
        </div>
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
          <Button disabled={pending} type="button" onClick={onConfirm}>
            {pending ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <CloudDownload />
            )}
            Update to latest
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function updateTargets(overview: UpdateOverview): Array<UpdateTarget> {
  const hearth: UpdateTarget = {
    component: "hearth",
    currentVersion:
      overview.hearth?.currentVersion ?? overview.currentVersion ?? null,
    eligible: overview.hearth?.eligible ?? false,
    key: "hearth",
    name: "Hearth",
    reason:
      overview.hearth?.reason ??
      "Pair a Relay running on Hearth's Docker host to enable updates.",
    relayId: overview.hearth?.relayId ?? null,
  }
  return [
    hearth,
    ...overview.relays.map(
      (relay): UpdateTarget => ({
        component: "relay",
        currentVersion: relay.currentVersion,
        eligible: relay.eligible,
        key: relayTargetKey(relay.relayId),
        name: relay.name,
        reason: relay.reason,
        relayId: relay.relayId,
      })
    ),
  ]
}

function changelogReleases(
  releases: ReadonlyArray<PublicKilnRelease>,
  currentVersion: string | null
): Array<PublicKilnRelease> {
  if (!isKilnReleaseVersion(currentVersion)) return releases.slice(0, 1)
  if (releases[0]?.version === currentVersion) return []
  const currentReleaseIndex = releases.findIndex(
    (release) => release.version === currentVersion
  )
  if (currentReleaseIndex > 0) {
    return releases.slice(0, currentReleaseIndex + 1)
  }
  const publishedAtByVersion = releaseDates(releases)
  const relevantReleases = releases.filter(
    (release) =>
      compareReleaseVersions(
        release.version,
        currentVersion,
        publishedAtByVersion
      ) >= 0
  )
  return relevantReleases.length > 0 ? relevantReleases : releases.slice(0, 1)
}

function releaseDates(
  releases: ReadonlyArray<PublicKilnRelease>
): ReadonlyMap<string, string | null> {
  return new Map(
    releases.map((release) => [release.version, release.publishedAt])
  )
}

function targetStatus(
  target: UpdateTarget,
  comparison: -1 | 0 | 1 | null
): { label: string; tone: string } {
  if (!target.eligible) {
    return { label: "Externally managed", tone: "text-muted-foreground" }
  }
  if (target.currentVersion === null) {
    return { label: "Version unknown", tone: "text-amber-300" }
  }
  if (comparison === null) {
    return { label: "Custom build", tone: "text-sky-300" }
  }
  if (comparison === 1) {
    return { label: "Update available", tone: "text-amber-300" }
  }
  if (comparison === 0) {
    return { label: "Up to date", tone: "text-emerald-300" }
  }
  return { label: "Ahead of latest", tone: "text-sky-300" }
}

function isActiveUpdate(value: unknown): value is ActiveUpdate {
  return (
    typeof value === "object" &&
    value !== null &&
    "component" in value &&
    (value.component === "hearth" || value.component === "relay") &&
    "operationId" in value &&
    typeof value.operationId === "string" &&
    "relayId" in value &&
    typeof value.relayId === "string"
  )
}

function displayVersion(version: string | null): string {
  return version ? `v${version}` : "Version unavailable"
}

function displayComponent(component: "hearth" | "relay"): string {
  return component === "hearth" ? "Hearth" : "Relay"
}

function relayTargetKey(relayId: string): string {
  return `relay:${relayId}`
}

function formatReleaseDate(publishedAt: string | null): string {
  if (!publishedAt) return "Recently published"
  const date = new Date(publishedAt)
  return Number.isFinite(date.getTime())
    ? releaseDateFormatter.format(date)
    : "Recently published"
}
