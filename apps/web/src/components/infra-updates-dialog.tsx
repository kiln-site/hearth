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

type PendingUpdate = {
  latestVersion: string
  target: UpdateTarget
}

type DialogView = "changelog" | "overview"

type ViewVisibility = {
  changelogMounted: boolean
  view: DialogView
}

type UpdateDialogViewStore = ReturnType<typeof createUpdateDialogViewStore>

const activeUpdateStorageKey = "kiln.active-system-update"
const minimumUpdateCheckDuration = 750
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
  const [pending, setPending] = React.useState<PendingUpdate | null>(null)
  const [active, setActive] = React.useState<ActiveUpdate | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const viewStoreRef = React.useRef<UpdateDialogViewStore | null>(null)
  if (viewStoreRef.current === null) {
    viewStoreRef.current = createUpdateDialogViewStore(
      initialRelayId ? relayTargetKey(initialRelayId) : "hearth"
    )
  }
  const viewStore = viewStoreRef.current

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

  const handleUpdate = React.useCallback(
    (target: UpdateTarget, latestVersion: string) =>
      setPending({ latestVersion, target }),
    []
  )

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          aria-describedby={undefined}
          className="h-[min(46rem,calc(100dvh-2rem))] max-h-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[calc(100%-2rem)] xl:max-w-5xl"
        >
          <div className="border-b bg-background/35 px-5 pt-5">
            <UpdaterTitleBar open={open} />
            <UpdaterViewTabs store={viewStore} />
          </div>
          <UpdateDialogData
            active={active}
            focusedRelayId={initialRelayId}
            open={open}
            store={viewStore}
            onUpdate={handleUpdate}
          />
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
        latestVersion={pending?.latestVersion ?? null}
        open={pending !== null}
        pending={updateMutation.isPending}
        target={pending?.target ?? null}
        onConfirm={() => {
          if (pending) updateMutation.mutate(pending.target)
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

const UpdateDialogData = React.memo(function UpdateDialogData({
  active,
  focusedRelayId,
  open,
  store,
  onUpdate,
}: {
  active: ActiveUpdate | null
  focusedRelayId: string | null
  open: boolean
  store: UpdateDialogViewStore
  onUpdate: (target: UpdateTarget, latestVersion: string) => void
}) {
  const overviewQuery = useQuery({
    ...updateOverviewQueryOptions(),
    enabled: open,
    notifyOnChangeProps: ["data", "error", "isError", "isPending"],
  })
  const overview = overviewQuery.data
  const targets = React.useMemo(
    () => (overview ? updateTargets(overview) : []),
    [overview]
  )

  return (
    <UpdateDialogBody
      active={active}
      errorMessage={
        overviewQuery.error instanceof Error
          ? overviewQuery.error.message
          : "Update information is unavailable."
      }
      failed={overviewQuery.isError}
      focusedRelayId={focusedRelayId}
      overview={overview}
      pending={overviewQuery.isPending}
      store={store}
      targets={targets}
      onRetry={() => void overviewQuery.refetch()}
      onUpdate={onUpdate}
    />
  )
})

const UpdateDialogBody = React.memo(function UpdateDialogBody({
  active,
  errorMessage,
  failed,
  focusedRelayId,
  overview,
  pending,
  store,
  targets,
  onRetry,
  onUpdate,
}: {
  active: ActiveUpdate | null
  errorMessage: string
  failed: boolean
  focusedRelayId: string | null
  overview: UpdateOverview | undefined
  pending: boolean
  store: UpdateDialogViewStore
  targets: Array<UpdateTarget>
  onRetry: () => void
  onUpdate: (target: UpdateTarget, latestVersion: string) => void
}) {
  const visibility = React.useSyncExternalStore(
    store.subscribeVisibility,
    store.getVisibilitySnapshot,
    store.getVisibilitySnapshot
  )

  return (
    <div className="relative min-h-0 overflow-hidden">
      {pending ? (
        <div className="h-full overflow-y-auto overscroll-contain">
          <UpdateDialogSkeleton />
        </div>
      ) : failed ? (
        <div className="h-full overflow-y-auto overscroll-contain">
          <UpdateDialogError message={errorMessage} onRetry={onRetry} />
        </div>
      ) : overview ? (
        <>
          <div
            aria-hidden={visibility.view !== "overview"}
            className={`absolute inset-0 overflow-y-auto overscroll-contain [will-change:opacity] [contain:strict] ${
              visibility.view === "overview"
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0"
            }`}
            inert={visibility.view !== "overview"}
            role="tabpanel"
          >
            <UpdateOverviewView
              active={active}
              focusedRelayId={focusedRelayId}
              overview={overview}
              targets={targets}
              onChangelog={store.openChangelog}
              onUpdate={onUpdate}
            />
          </div>

          {visibility.changelogMounted ? (
            <div
              aria-hidden={visibility.view !== "changelog"}
              className={`absolute inset-0 overflow-y-auto overscroll-contain [will-change:opacity] [contain:strict] ${
                visibility.view === "changelog"
                  ? "pointer-events-auto opacity-100"
                  : "pointer-events-none opacity-0"
              }`}
              inert={visibility.view !== "changelog"}
              role="tabpanel"
            >
              <UpdateChangelogView
                overview={overview}
                store={store}
                targets={targets}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
})

const UpdaterTitleBar = React.memo(function UpdaterTitleBar({
  open,
}: {
  open: boolean
}) {
  return (
    <DialogHeader className="flex-row items-center justify-between gap-3 pr-10">
      <DialogTitle className="flex items-center gap-2.5 text-2xl text-white">
        <CloudDownload className="size-5 text-primary" />
        Kiln Updater
      </DialogTitle>
      <UpdaterCheckControl open={open} />
    </DialogHeader>
  )
})

const UpdaterCheckControl = React.memo(function UpdaterCheckControl({
  open,
}: {
  open: boolean
}) {
  const overviewQuery = useQuery({
    ...updateOverviewQueryOptions(),
    enabled: open,
    notifyOnChangeProps: ["dataUpdatedAt", "isFetching"],
  })
  const [lastCheckedAt, setLastCheckedAt] = React.useState("Not yet")
  const [checking, setChecking] = React.useState(overviewQuery.isFetching)
  const checkStartedAtRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (overviewQuery.dataUpdatedAt === 0) return
    setLastCheckedAt(
      lastCheckedFormatter.format(new Date(overviewQuery.dataUpdatedAt))
    )
  }, [overviewQuery.dataUpdatedAt])

  React.useEffect(() => {
    if (overviewQuery.isFetching) {
      if (checkStartedAtRef.current === null) {
        checkStartedAtRef.current = performance.now()
      }
      setChecking(true)
      return
    }

    const checkStartedAt = checkStartedAtRef.current
    if (checkStartedAt === null) {
      setChecking(false)
      return
    }

    const remainingDuration = Math.max(
      0,
      minimumUpdateCheckDuration - (performance.now() - checkStartedAt)
    )
    const timeoutId = window.setTimeout(() => {
      checkStartedAtRef.current = null
      setChecking(false)
    }, remainingDuration)

    return () => window.clearTimeout(timeoutId)
  }, [overviewQuery.isFetching])

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button
        aria-busy={checking}
        aria-label={checking ? "Checking for updates" : "Check for updates"}
        disabled={checking}
        size="sm"
        type="button"
        variant="outline"
        onClick={() => void overviewQuery.refetch()}
      >
        <RefreshCw className={checking ? "animate-spin" : ""} />
        <span className="hidden sm:inline">Check for updates</span>
      </Button>
      <p className="hidden text-[9px] text-muted-foreground sm:block">
        Last Checked: {lastCheckedAt}
      </p>
    </div>
  )
})

const UpdaterViewTabs = React.memo(function UpdaterViewTabs({
  store,
}: {
  store: UpdateDialogViewStore
}) {
  const visibility = React.useSyncExternalStore(
    store.subscribeVisibility,
    store.getVisibilitySnapshot,
    store.getVisibilitySnapshot
  )

  return (
    <div
      aria-label="Update dialog views"
      className="mt-4 flex gap-1"
      role="tablist"
    >
      <ViewButton
        active={visibility.view === "overview"}
        label="Overview"
        onClick={store.showOverview}
      />
      <ViewButton
        active={visibility.view === "changelog"}
        icon={History}
        label="Changelog"
        onClick={store.showChangelog}
      />
    </div>
  )
})

const ViewButton = React.memo(function ViewButton({
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
})

const UpdateOverviewView = React.memo(function UpdateOverviewView({
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
  onUpdate: (target: UpdateTarget, latestVersion: string) => void
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
})

type UpdateTargetRowProps = {
  active: ActiveUpdate | null
  first: boolean
  focused: boolean
  latestVersion: string
  releases: ReadonlyArray<PublicKilnRelease>
  target: UpdateTarget
  onChangelog: (targetKey: string) => void
  onUpdate: (target: UpdateTarget, latestVersion: string) => void
}

const UpdateTargetRow = React.memo(function UpdateTargetRow({
  active,
  first,
  focused,
  latestVersion,
  releases,
  target,
  onChangelog,
  onUpdate,
}: UpdateTargetRowProps) {
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
          onClick={() => onUpdate(target, latestVersion)}
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
}, areUpdateTargetRowPropsEqual)

const UpdateChangelogView = React.memo(function UpdateChangelogView({
  overview,
  store,
  targets,
}: {
  overview: UpdateOverview
  store: UpdateDialogViewStore
  targets: Array<UpdateTarget>
}) {
  const latestVersion = overview.releases[0]?.version ?? null

  return (
    <div className="p-4 sm:p-5">
      <ChangelogTargetPicker store={store} targets={targets} />

      {targets.length > 0 && latestVersion ? (
        <div className="rounded-xl border bg-card/40 p-4 sm:p-5">
          <ChangelogSelectionHeader
            latestVersion={latestVersion}
            overview={overview}
            store={store}
            targets={targets}
          />
          <ChangelogTimeline
            releases={overview.releases}
            store={store}
            targets={targets}
          />
        </div>
      ) : (
        <p className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
          Changelog information is unavailable.
        </p>
      )}
    </div>
  )
})

const ChangelogTargetPicker = React.memo(function ChangelogTargetPicker({
  store,
  targets,
}: {
  store: UpdateDialogViewStore
  targets: Array<UpdateTarget>
}) {
  const selectedKey = React.useSyncExternalStore(
    store.subscribeTarget,
    store.getTargetSnapshot,
    store.getTargetSnapshot
  )

  return (
    <div
      aria-label="Changelog target"
      className="mb-5 no-scrollbar flex gap-2 overflow-x-auto pb-1"
    >
      {targets.map((target, index) => (
        <ChangelogTargetButton
          first={index === 0}
          key={target.key}
          selected={target.key === selectedKey}
          target={target}
          onSelect={store.setTarget}
        />
      ))}
    </div>
  )
})

const ChangelogTargetButton = React.memo(function ChangelogTargetButton({
  first,
  selected,
  target,
  onSelect,
}: {
  first: boolean
  selected: boolean
  target: UpdateTarget
  onSelect: (targetKey: string) => void
}) {
  return (
    <button
      aria-pressed={selected}
      className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 ${
        selected
          ? "border-primary/35 bg-primary/[0.08] text-foreground"
          : "bg-background/35 text-muted-foreground hover:text-foreground"
      }`}
      type="button"
      onClick={() => onSelect(target.key)}
    >
      {first ? (
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
  )
}, areChangelogTargetButtonPropsEqual)

const ChangelogSelectionHeader = React.memo(function ChangelogSelectionHeader({
  latestVersion,
  overview,
  store,
  targets,
}: {
  latestVersion: string
  overview: UpdateOverview
  store: UpdateDialogViewStore
  targets: Array<UpdateTarget>
}) {
  const selectedKey = React.useSyncExternalStore(
    store.subscribeTarget,
    store.getTargetSnapshot,
    store.getTargetSnapshot
  )
  const selectedTarget = findSelectedTarget(targets, selectedKey)
  const releaseCount = selectedTarget
    ? changelogReleases(overview.releases, selectedTarget.currentVersion).length
    : 0

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b pb-4">
      <div>
        <p className="text-sm font-semibold">{selectedTarget?.name}</p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {displayVersion(selectedTarget?.currentVersion ?? null)}
          <span className="mx-2 text-border">→</span>v{latestVersion}
        </p>
      </div>
      <Badge variant="outline">
        {releaseCount} {releaseCount === 1 ? "release" : "releases"}
      </Badge>
    </div>
  )
}, areChangelogSelectionHeaderPropsEqual)

const ChangelogTimeline = React.memo(function ChangelogTimeline({
  releases: availableReleases,
  store,
  targets,
}: {
  releases: ReadonlyArray<PublicKilnRelease>
  store: UpdateDialogViewStore
  targets: Array<UpdateTarget>
}) {
  const getCurrentVersionSnapshot = React.useCallback(() => {
    const selectedTarget = findSelectedTarget(
      targets,
      store.getTargetSnapshot()
    )
    return selectedTarget?.currentVersion ?? null
  }, [store, targets])
  const currentVersion = React.useSyncExternalStore(
    store.subscribeTarget,
    getCurrentVersionSnapshot,
    getCurrentVersionSnapshot
  )
  const releases = React.useMemo(
    () => changelogReleases(availableReleases, currentVersion),
    [availableReleases, currentVersion]
  )

  return releases.length > 0 ? (
    <div className="relative ml-1 space-y-6 border-l border-border/80 pl-5">
      {releases.map((release, index) => (
        <ChangelogRelease
          key={release.tag}
          latest={index === 0}
          release={release}
          installed={release.version === currentVersion}
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
  )
}, areChangelogTimelinePropsEqual)

const ChangelogRelease = React.memo(function ChangelogRelease({
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
        {release.notes ?? "No changes were specified."}
      </p>
    </article>
  )
})

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

function createUpdateDialogViewStore(initialTargetKey: string) {
  let visibility: ViewVisibility = {
    changelogMounted: false,
    view: "overview",
  }
  let targetKey = initialTargetKey
  const visibilityListeners = new Set<() => void>()
  const targetListeners = new Set<() => void>()

  const setVisibility = (next: ViewVisibility) => {
    if (
      next.view === visibility.view &&
      next.changelogMounted === visibility.changelogMounted
    ) {
      return
    }
    visibility = next
    visibilityListeners.forEach((listener) => listener())
  }

  const setTarget = (nextTargetKey: string) => {
    if (nextTargetKey === targetKey) return
    targetKey = nextTargetKey
    targetListeners.forEach((listener) => listener())
  }

  return {
    getTargetSnapshot: () => targetKey,
    getVisibilitySnapshot: () => visibility,
    openChangelog: (nextTargetKey: string) => {
      setTarget(nextTargetKey)
      setVisibility({ changelogMounted: true, view: "changelog" })
    },
    setTarget,
    showChangelog: () =>
      setVisibility({ changelogMounted: true, view: "changelog" }),
    showOverview: () =>
      setVisibility({
        changelogMounted: visibility.changelogMounted,
        view: "overview",
      }),
    subscribeTarget: (listener: () => void) => {
      targetListeners.add(listener)
      return () => targetListeners.delete(listener)
    },
    subscribeVisibility: (listener: () => void) => {
      visibilityListeners.add(listener)
      return () => visibilityListeners.delete(listener)
    },
  }
}

function findSelectedTarget(
  targets: ReadonlyArray<UpdateTarget>,
  selectedKey: string
): UpdateTarget | null {
  return (
    targets.find((target) => target.key === selectedKey) ?? targets[0] ?? null
  )
}

function areUpdateTargetRowPropsEqual(
  previous: UpdateTargetRowProps,
  next: UpdateTargetRowProps
): boolean {
  return (
    previous.first === next.first &&
    previous.focused === next.focused &&
    previous.latestVersion === next.latestVersion &&
    previous.releases === next.releases &&
    previous.onChangelog === next.onChangelog &&
    previous.onUpdate === next.onUpdate &&
    (previous.active === null) === (next.active === null) &&
    isTargetUpdating(previous.active, previous.target) ===
      isTargetUpdating(next.active, next.target) &&
    areUpdateTargetsEqual(previous.target, next.target)
  )
}

function areChangelogTargetButtonPropsEqual(
  previous: {
    first: boolean
    selected: boolean
    target: UpdateTarget
    onSelect: (targetKey: string) => void
  },
  next: {
    first: boolean
    selected: boolean
    target: UpdateTarget
    onSelect: (targetKey: string) => void
  }
): boolean {
  return (
    previous.first === next.first &&
    previous.selected === next.selected &&
    previous.onSelect === next.onSelect &&
    previous.target.currentVersion === next.target.currentVersion &&
    previous.target.key === next.target.key &&
    previous.target.name === next.target.name
  )
}

function areChangelogTimelinePropsEqual(
  previous: {
    releases: ReadonlyArray<PublicKilnRelease>
    store: UpdateDialogViewStore
    targets: Array<UpdateTarget>
  },
  next: {
    releases: ReadonlyArray<PublicKilnRelease>
    store: UpdateDialogViewStore
    targets: Array<UpdateTarget>
  }
): boolean {
  if (
    previous.releases !== next.releases ||
    previous.store !== next.store
  ) {
    return false
  }
  const selectedKey = next.store.getTargetSnapshot()
  return (
    findSelectedTarget(previous.targets, selectedKey)?.currentVersion ===
    findSelectedTarget(next.targets, selectedKey)?.currentVersion
  )
}

function areChangelogSelectionHeaderPropsEqual(
  previous: {
    latestVersion: string
    overview: UpdateOverview
    store: UpdateDialogViewStore
    targets: Array<UpdateTarget>
  },
  next: {
    latestVersion: string
    overview: UpdateOverview
    store: UpdateDialogViewStore
    targets: Array<UpdateTarget>
  }
): boolean {
  if (
    previous.latestVersion !== next.latestVersion ||
    previous.overview.releases !== next.overview.releases ||
    previous.store !== next.store
  ) {
    return false
  }
  const selectedKey = next.store.getTargetSnapshot()
  const previousTarget = findSelectedTarget(previous.targets, selectedKey)
  const nextTarget = findSelectedTarget(next.targets, selectedKey)
  return (
    previousTarget?.currentVersion === nextTarget?.currentVersion &&
    previousTarget?.name === nextTarget?.name
  )
}

function areUpdateTargetsEqual(
  previous: UpdateTarget,
  next: UpdateTarget
): boolean {
  return (
    previous.component === next.component &&
    previous.currentVersion === next.currentVersion &&
    previous.eligible === next.eligible &&
    previous.key === next.key &&
    previous.name === next.name &&
    previous.reason === next.reason &&
    previous.relayId === next.relayId
  )
}

function isTargetUpdating(
  active: ActiveUpdate | null,
  target: UpdateTarget
): boolean {
  return (
    active?.component === target.component &&
    (target.component === "hearth" || active.relayId === target.relayId)
  )
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
