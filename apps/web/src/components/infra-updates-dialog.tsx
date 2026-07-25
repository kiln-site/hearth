import * as React from "react"
import {
  queryOptions,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  Check,
  CloudDownload,
  ExternalLink,
  History,
  LoaderCircle,
  RadioTower,
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
import { dismissToast, showToast } from "@workspace/ui/components/sonner"

import type { PublicKilnRelease } from "@/effect/github-releases"
import { queryKeys, updateOverviewQueryOptions } from "@/lib/query-options"
import {
  compareLatestReleaseVersion,
  compareReleaseVersions,
  isKilnReleaseVersion,
} from "@/lib/release-version"
import {
  applicationConnectionToastId,
  applicationReconnectedToastId,
  clearSystemUpdateActive,
  markSystemUpdateActive,
  relayDisconnectToastId,
  relayReconnectToastId,
} from "@/lib/system-update-presence"
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
  name: string
  operationId: string
  previousVersion: string | null
  relayId: string
  targetKey: string
}

type PendingUpdate = {
  latestVersion: string
  targets: ReadonlyArray<UpdateTarget>
}

type DialogView = "changelog" | "overview"

type ViewVisibility = {
  changelogMounted: boolean
  view: DialogView
}

type UpdateDialogViewStore = ReturnType<typeof createUpdateDialogViewStore>

const activeUpdateStorageKey = "kiln.active-system-update"
const changelogRangeStorageKey = "kiln.system-update-changelog-ranges"
const completedUpdateStorageKey = "kiln.completed-system-update"
const updateFailureStorageKey = "kiln.system-update-failures"
const githubIssuesUrl = "https://github.com/kiln-site/hearth/issues/new/choose"
const githubReleasesUrl = "https://github.com/kiln-site/hearth/releases"
const minimumUpdateCheckDuration = 750
const releaseDateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
})
const lastCheckedFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
})

function activeUpdateQueryOptions(active: ActiveUpdate) {
  return queryOptions({
    queryKey: ["updates", "operation", active.relayId, active.operationId],
    queryFn: () =>
      getSystemUpdateStatus({
        data: {
          operationId: active.operationId,
          relayId: active.relayId,
        },
      }),
    refetchInterval: (query) =>
      query.state.data?.status === "failed" ||
      query.state.data?.status === "succeeded"
        ? false
        : 2_000,
    retry: true,
    retryDelay: 2_000,
  })
}

export const InfraUpdatesDialog = React.memo(function InfraUpdatesDialog({
  initialRelayId,
  open,
  onOpenChange,
  onRetryTarget,
}: {
  initialRelayId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRetryTarget: (relayId: string | null) => void
}) {
  const queryClient = useQueryClient()
  const [pending, setPending] = React.useState<PendingUpdate | null>(null)
  const [active, setActive] = React.useState<Array<ActiveUpdate>>([])
  const activeRef = React.useRef<ReadonlyArray<ActiveUpdate>>([])
  const completedOperations = React.useRef(new Set<string>())
  const reconnectingOperations = React.useRef(new Set<string>())
  const viewStoreRef = React.useRef<UpdateDialogViewStore | null>(null)
  if (viewStoreRef.current === null) {
    viewStoreRef.current = createUpdateDialogViewStore(
      initialRelayId ? relayTargetKey(initialRelayId) : "hearth"
    )
  }
  const viewStore = viewStoreRef.current
  const replaceActive = React.useCallback(
    (next: ReadonlyArray<ActiveUpdate>) => {
      const stored = [...next]
      activeRef.current = stored
      storeActiveUpdates(stored)
      setActive(stored)
    },
    []
  )

  React.useEffect(() => {
    const completedUpdate = readCompletedUpdate()
    if (completedUpdate) {
      showUpdateSuccess(completedUpdate, completedUpdate.version)
    }

    const stored = window.localStorage.getItem(activeUpdateStorageKey)
    if (!stored) return
    try {
      const parsed: unknown = JSON.parse(stored)
      const restored = parseActiveUpdates(parsed)
      if (restored.length > 0) {
        for (const update of restored) announceUpdateStarted(update)
        replaceActive(restored)
      } else window.localStorage.removeItem(activeUpdateStorageKey)
    } catch {
      window.localStorage.removeItem(activeUpdateStorageKey)
    }
  }, [replaceActive])

  const updateMutation = useMutation({
    mutationFn: startUpdates,
    onSuccess: ({ failures, started }) => {
      if (started.length > 0) {
        for (const update of started) announceUpdateStarted(update)
        replaceActive([...activeRef.current, ...started])
      }
      setPending(null)
      for (const failure of failures) {
        showUpdateFailure(failure.target, failure.message, onRetryTarget)
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.updates })
    },
  })

  const operationQueries = useQueries({
    queries: active.map(activeUpdateQueryOptions),
  })

  React.useEffect(() => {
    for (const [index, operationQuery] of operationQueries.entries()) {
      const update = active[index]
      if (!update) continue
      const reconnecting =
        operationQuery.isError || operationQuery.isRefetchError
      const wasReconnecting = reconnectingOperations.current.has(
        update.operationId
      )
      if (reconnecting === wasReconnecting) continue

      if (reconnecting) {
        reconnectingOperations.current.add(update.operationId)
      } else {
        reconnectingOperations.current.delete(update.operationId)
      }
      showUpdateProgress(update, reconnecting)
    }
  }, [active, operationQueries])

  React.useEffect(() => {
    for (const [index, operationQuery] of operationQueries.entries()) {
      const completed = active[index]
      if (!completed || !operationQuery.isSuccess) continue
      const operation = operationQuery.data
      if (operation?.status === "running") continue
      if (completedOperations.current.has(completed.operationId)) continue
      completedOperations.current.add(completed.operationId)

      replaceActive(
        activeRef.current.filter(
          (item) => item.operationId !== completed.operationId
        )
      )
      reconnectingOperations.current.delete(completed.operationId)
      clearSystemUpdateActive(completed)
      if (operation === null || operation === undefined) {
        showUpdateFailure(
          completed,
          `${completed.name}'s saved update operation could not be found. Check the target container before trying again.`,
          onRetryTarget
        )
        void queryClient.invalidateQueries({ queryKey: queryKeys.updates })
        continue
      }

      if (operation.status === "failed") {
        showUpdateFailure(
          completed,
          operation.error ??
            "The update failed. The previous container was restored.",
          onRetryTarget
        )
        void queryClient.invalidateQueries({ queryKey: queryKeys.updates })
        continue
      }
      resetUpdateFailureCount(completed.targetKey)
      storeChangelogRange(
        completed.targetKey,
        completed.previousVersion,
        operation.version
      )
      showUpdateSuccess(completed, operation.version)
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.updates }),
        queryClient.invalidateQueries({ queryKey: queryKeys.relays }),
      ])
      if (operation.component === "hearth") {
        storeCompletedUpdate(completed, operation.version)
        window.setTimeout(() => window.location.reload(), 750)
      }
    }
  }, [active, onRetryTarget, operationQueries, queryClient, replaceActive])

  const handleUpdate = React.useCallback(
    (targets: ReadonlyArray<UpdateTarget>, latestVersion: string) =>
      setPending({ latestVersion, targets }),
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

      <UpdateConfirmation
        error={
          updateMutation.error instanceof Error
            ? updateMutation.error.message
            : null
        }
        latestVersion={pending?.latestVersion ?? null}
        open={pending !== null}
        pending={updateMutation.isPending}
        targets={pending?.targets ?? []}
        onConfirm={() => {
          if (pending) updateMutation.mutate(pending.targets)
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
  active: ReadonlyArray<ActiveUpdate>
  focusedRelayId: string | null
  open: boolean
  store: UpdateDialogViewStore
  onUpdate: (
    targets: ReadonlyArray<UpdateTarget>,
    latestVersion: string
  ) => void
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
  active: ReadonlyArray<ActiveUpdate>
  errorMessage: string
  failed: boolean
  focusedRelayId: string | null
  overview: UpdateOverview | undefined
  pending: boolean
  store: UpdateDialogViewStore
  targets: Array<UpdateTarget>
  onRetry: () => void
  onUpdate: (
    targets: ReadonlyArray<UpdateTarget>,
    latestVersion: string
  ) => void
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
  active: ReadonlyArray<ActiveUpdate>
  focusedRelayId: string | null
  overview: UpdateOverview
  targets: Array<UpdateTarget>
  onChangelog: (targetKey: string) => void
  onUpdate: (
    targets: ReadonlyArray<UpdateTarget>,
    latestVersion: string
  ) => void
}) {
  const latestRelease = overview.releases[0] ?? null
  const hearthTarget = targets.find((target) => target.component === "hearth")
  const relayTargets = targets.filter((target) => target.component === "relay")
  const availableTargets = latestRelease
    ? targets.filter(
        (target) =>
          targetHasUpdate(target, overview.releases) &&
          !isTargetUpdating(active, target)
      )
    : []

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <section className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/[0.045] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <p className="text-xs font-semibold text-foreground">
              Game servers stay online
            </p>
            <p className="mt-0.5 max-w-2xl text-[10px] leading-4 text-muted-foreground">
              Updates do not restart running game servers or disconnect players.
              Only the Panel may be briefly unavailable.
            </p>
          </div>
        </div>
        <Button
          className="shrink-0"
          disabled={availableTargets.length === 0}
          size="sm"
          type="button"
          onClick={() => {
            if (latestRelease) {
              onUpdate(availableTargets, latestRelease.version)
            }
          }}
        >
          <CloudDownload />
          Update all
        </Button>
      </section>

      <section className="overflow-hidden rounded-xl border bg-card/45">
        {latestRelease ? (
          <>
            <UpdateSectionLabel component="hearth" />
            {hearthTarget ? (
              <UpdateTargetRow
                active={active}
                focused={false}
                key={hearthTarget.key}
                latestVersion={latestRelease.version}
                releases={overview.releases}
                target={hearthTarget}
                onChangelog={onChangelog}
                onUpdate={onUpdate}
              />
            ) : null}

            <div className="border-t border-border">
              <UpdateSectionLabel component="relay" />
              {relayTargets.length > 0 ? (
                <div className="divide-y divide-border/70">
                  {relayTargets.map((target) => (
                    <UpdateTargetRow
                      active={active}
                      focused={target.relayId === focusedRelayId}
                      key={target.key}
                      latestVersion={latestRelease.version}
                      releases={overview.releases}
                      target={target}
                      onChangelog={onChangelog}
                      onUpdate={onUpdate}
                    />
                  ))}
                </div>
              ) : (
                <p className="px-4 py-5 text-xs text-muted-foreground">
                  No Relays are paired with this Panel.
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="px-4 py-6 text-xs text-amber-300">
            No public Kiln releases are available yet.
          </p>
        )}
      </section>
    </div>
  )
})

const UpdateSectionLabel = React.memo(function UpdateSectionLabel({
  component,
}: {
  component: "hearth" | "relay"
}) {
  const Icon = component === "hearth" ? ServerCog : RadioTower

  return (
    <div className="flex items-center gap-2 border-b border-border/70 bg-background/35 px-4 py-2.5">
      <Icon
        className={`size-3.5 ${
          component === "hearth" ? "text-primary" : "text-muted-foreground"
        }`}
      />
      <p className="font-mono text-[9px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
        {component === "hearth" ? "Hearth" : "Relays"}
      </p>
    </div>
  )
})

type UpdateTargetRowProps = {
  active: ReadonlyArray<ActiveUpdate>
  focused: boolean
  latestVersion: string
  releases: ReadonlyArray<PublicKilnRelease>
  target: UpdateTarget
  onChangelog: (targetKey: string) => void
  onUpdate: (
    targets: ReadonlyArray<UpdateTarget>,
    latestVersion: string
  ) => void
}

const UpdateTargetRow = React.memo(function UpdateTargetRow({
  active,
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
  const updating = isTargetUpdating(active, target)
  const updateAvailable = targetHasUpdate(target, releases)
  const status = targetStatus(target, comparison)
  const Icon = target.component === "hearth" ? ServerCog : RadioTower

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
            target.component === "hearth"
              ? "border-primary/25 bg-primary/[0.07] text-primary"
              : "bg-background/55 text-muted-foreground"
          }`}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{target.name}</h3>
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
          View changes
        </Button>
        <Button
          size="sm"
          type="button"
          disabled={!updateAvailable || updating}
          onClick={() => onUpdate([target], latestVersion)}
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
      {targets.map((target) => (
        <ChangelogTargetButton
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
  selected,
  target,
  onSelect,
}: {
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
      {target.component === "hearth" ? (
        <ServerCog className="size-3.5 text-primary" />
      ) : (
        <RadioTower className="size-3.5" />
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
  const changelogStartVersion = selectedTarget
    ? previousChangelogVersion(selectedTarget, latestVersion)
    : null
  const releaseCount = selectedTarget
    ? changelogReleases(overview.releases, changelogStartVersion).length
    : 0

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b pb-4">
      <div>
        <p className="text-sm font-semibold">{selectedTarget?.name}</p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {displayVersion(changelogStartVersion)}
          <span className="mx-2 text-border">→</span>v{latestVersion}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline">
          {releaseCount} {releaseCount === 1 ? "release" : "releases"}
        </Badge>
        <a
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          href={githubReleasesUrl}
          rel="noreferrer"
          target="_blank"
        >
          View all changelogs
          <ExternalLink className="size-3" />
        </a>
      </div>
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
  const selectedKey = React.useSyncExternalStore(
    store.subscribeTarget,
    store.getTargetSnapshot,
    store.getTargetSnapshot
  )
  const selectedTarget = findSelectedTarget(targets, selectedKey)
  const currentVersion = selectedTarget?.currentVersion ?? null
  const changelogStartVersion = selectedTarget
    ? previousChangelogVersion(
        selectedTarget,
        availableReleases[0]?.version ?? null
      )
    : null
  const releases = React.useMemo(
    () => changelogReleases(availableReleases, changelogStartVersion),
    [availableReleases, changelogStartVersion, currentVersion]
  )

  return releases.length > 0 ? (
    <div className="relative ml-1 space-y-6 border-l border-border/80 pl-5">
      {releases.map((release, index) => (
        <ChangelogRelease
          key={release.tag}
          latest={index === 0}
          release={release}
          current={release.version === currentVersion}
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
  current,
  latest,
  release,
}: {
  current: boolean
  latest: boolean
  release: PublicKilnRelease
}) {
  return (
    <article>
      <span
        className={`absolute -left-[0.34rem] mt-1.5 size-2.5 rounded-full border-2 border-popover ${
          current ? "bg-emerald-400" : latest ? "bg-primary" : "bg-border"
        }`}
      />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{release.name}</h3>
            {latest ? <Badge>Latest</Badge> : null}
            {current ? <Badge variant="outline">Current</Badge> : null}
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
      <PlainReleaseNotes notes={release.notes} />
    </article>
  )
})

const PlainReleaseNotes = React.memo(function PlainReleaseNotes({
  notes,
}: {
  notes: string | null
}) {
  const lines = React.useMemo(() => markdownTextLines(notes), [notes])

  return (
    <div className="mt-3 max-w-3xl space-y-1.5 text-[11px] leading-5 text-muted-foreground">
      {lines.map((line) => (
        <p key={line.id}>{linkedMarkdownText(line.text)}</p>
      ))}
    </div>
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

function UpdateConfirmation({
  error,
  latestVersion,
  open,
  pending,
  targets,
  onConfirm,
  onOpenChange,
}: {
  error: string | null
  latestVersion: string | null
  open: boolean
  pending: boolean
  targets: ReadonlyArray<UpdateTarget>
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  const targetLabel =
    targets.length === 1 ? targets[0]?.name : `${targets.length} systems`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm system update</DialogTitle>
          <DialogDescription>
            {targets.length > 0 && latestVersion
              ? `${targetLabel} will update to the latest supported release, v${latestVersion}. Running game servers stay online and players remain connected.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-3 rounded-lg border border-primary/20 bg-primary/[0.05] p-3 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0 text-primary" />
          <p>
            Kiln verifies the replacement container and automatically restores
            the previous one if its health checks fail. The Panel may be briefly
            unavailable while its own container is replaced.
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
            {targets.length > 1 ? `Update ${targets.length} systems` : "Update"}
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
    name: "Panel",
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

type UpdateStartAttempt =
  | { active: ActiveUpdate; failure?: never }
  | {
      active?: never
      failure: { message: string; target: UpdateTarget }
    }

async function startUpdates(targets: ReadonlyArray<UpdateTarget>): Promise<{
  failures: Array<{ message: string; target: UpdateTarget }>
  started: Array<ActiveUpdate>
}> {
  const relayTargets = targets.filter((target) => target.component === "relay")
  const hearthTarget = targets.find((target) => target.component === "hearth")
  const relayAttempts = await Promise.all(relayTargets.map(startUpdate))
  const hearthAttempt = hearthTarget ? await startUpdate(hearthTarget) : null
  const attempts = hearthAttempt
    ? [...relayAttempts, hearthAttempt]
    : relayAttempts
  const failures: Array<{ message: string; target: UpdateTarget }> = []
  const started: Array<ActiveUpdate> = []

  for (const attempt of attempts) {
    if (attempt.active) started.push(attempt.active)
    else failures.push(attempt.failure)
  }

  return { failures, started }
}

async function startUpdate(target: UpdateTarget): Promise<UpdateStartAttempt> {
  try {
    const { operation, relayId } = await startSystemUpdate({
      data: {
        component: target.component,
        relayId: target.relayId,
      },
    })
    return {
      active: {
        component: operation.component,
        name: target.name,
        operationId: operation.id,
        previousVersion: target.currentVersion,
        relayId,
        targetKey: target.key,
      },
    }
  } catch (cause) {
    return {
      failure: {
        message:
          cause instanceof Error ? cause.message : "Update could not start.",
        target,
      },
    }
  }
}

function announceUpdateStarted(update: ActiveUpdate): void {
  markSystemUpdateActive(update)
  dismissConnectionToasts(update)
  showUpdateProgress(update, false)
}

function showUpdateProgress(
  update: Pick<ActiveUpdate, "name" | "targetKey">,
  reconnecting: boolean
): void {
  showToast({
    type: "loading",
    message: `Updating ${update.name}`,
    id: updateToastId(update.targetKey),
    description: reconnecting
      ? `Waiting for ${update.name} to reconnect…`
      : "Replacing and checking the container…",
    duration: Infinity,
  })
}

function showUpdateSuccess(
  update: Pick<ActiveUpdate, "component" | "name" | "relayId" | "targetKey">,
  version: string
): void {
  dismissConnectionToasts(update)
  showToast({
    type: "success",
    message: `${update.name} updated`,
    id: updateToastId(update.targetKey),
    description: `${update.name} is now running v${version}.`,
    duration: 5_000,
  })
}

type CompletedUpdate = Pick<
  ActiveUpdate,
  "component" | "name" | "relayId" | "targetKey"
> & {
  version: string
}

function storeCompletedUpdate(update: ActiveUpdate, version: string): void {
  const completed: CompletedUpdate = { ...update, version }
  window.sessionStorage.setItem(
    completedUpdateStorageKey,
    JSON.stringify(completed)
  )
}

function readCompletedUpdate(): CompletedUpdate | null {
  const stored = window.sessionStorage.getItem(completedUpdateStorageKey)
  if (!stored) return null
  window.sessionStorage.removeItem(completedUpdateStorageKey)
  try {
    const value: unknown = JSON.parse(stored)
    if (
      typeof value === "object" &&
      value !== null &&
      "component" in value &&
      (value.component === "hearth" || value.component === "relay") &&
      "name" in value &&
      typeof value.name === "string" &&
      "relayId" in value &&
      typeof value.relayId === "string" &&
      "targetKey" in value &&
      typeof value.targetKey === "string" &&
      "version" in value &&
      typeof value.version === "string"
    ) {
      return {
        component: value.component,
        name: value.name,
        relayId: value.relayId,
        targetKey: value.targetKey,
        version: value.version,
      }
    }
  } catch {
    return null
  }
  return null
}

function showUpdateFailure(
  target: Pick<UpdateTarget, "key" | "name" | "relayId"> | ActiveUpdate,
  message: string,
  onRetryTarget: (relayId: string | null) => void
): void {
  const targetKey = "targetKey" in target ? target.targetKey : target.key
  const failureCount = incrementUpdateFailureCount(targetKey)
  showToast({
    type: "error",
    message: `${target.name} update failed`,
    id: updateToastId(targetKey),
    description: message,
    duration: Infinity,
    action: {
      label: "Open updater",
      onClick: () => onRetryTarget(target.relayId),
    },
    cancel:
      failureCount > 1
        ? {
            label: "Report issue",
            onClick: () =>
              window.open(githubIssuesUrl, "_blank", "noopener,noreferrer"),
          }
        : undefined,
  })
}

function dismissConnectionToasts(
  update: Pick<ActiveUpdate, "component" | "relayId">
): void {
  if (update.component === "hearth") {
    dismissToast(applicationConnectionToastId)
    dismissToast(applicationReconnectedToastId)
    return
  }
  dismissToast(relayDisconnectToastId(update.relayId))
  dismissToast(relayReconnectToastId(update.relayId))
}

function updateToastId(targetKey: string): string {
  return `system-update:${targetKey}`
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
    previous.focused === next.focused &&
    previous.latestVersion === next.latestVersion &&
    previous.releases === next.releases &&
    previous.onChangelog === next.onChangelog &&
    previous.onUpdate === next.onUpdate &&
    isTargetUpdating(previous.active, previous.target) ===
      isTargetUpdating(next.active, next.target) &&
    areUpdateTargetsEqual(previous.target, next.target)
  )
}

function areChangelogTargetButtonPropsEqual(
  previous: {
    selected: boolean
    target: UpdateTarget
    onSelect: (targetKey: string) => void
  },
  next: {
    selected: boolean
    target: UpdateTarget
    onSelect: (targetKey: string) => void
  }
): boolean {
  return (
    previous.selected === next.selected &&
    previous.onSelect === next.onSelect &&
    previous.target.component === next.target.component &&
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
  if (previous.releases !== next.releases || previous.store !== next.store) {
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
  active: ReadonlyArray<ActiveUpdate>,
  target: UpdateTarget
): boolean {
  return active.some(
    (item) =>
      item.component === target.component &&
      (target.component === "hearth" || item.relayId === target.relayId)
  )
}

function targetHasUpdate(
  target: UpdateTarget,
  releases: ReadonlyArray<PublicKilnRelease>
): boolean {
  const comparison = compareLatestReleaseVersion(
    target.currentVersion,
    releases
  )
  return target.eligible && (target.currentVersion === null || comparison === 1)
}

function changelogReleases(
  releases: ReadonlyArray<PublicKilnRelease>,
  fromVersion: string | null
): Array<PublicKilnRelease> {
  if (!isKilnReleaseVersion(fromVersion)) return releases.slice(0, 1)
  const currentReleaseIndex = releases.findIndex(
    (release) => release.version === fromVersion
  )
  if (currentReleaseIndex >= 0) {
    return releases.slice(0, currentReleaseIndex + 1)
  }
  const publishedAtByVersion = releaseDates(releases)
  const relevantReleases = releases.filter(
    (release) =>
      compareReleaseVersions(
        release.version,
        fromVersion,
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

function parseActiveUpdates(value: unknown): Array<ActiveUpdate> {
  const values = Array.isArray(value) ? value : [value]
  const active: Array<ActiveUpdate> = []

  for (const item of values) {
    const parsed = parseActiveUpdate(item)
    if (parsed) active.push(parsed)
  }

  return active
}

function parseActiveUpdate(value: unknown): ActiveUpdate | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "component" in value &&
    (value.component === "hearth" || value.component === "relay") &&
    "operationId" in value &&
    typeof value.operationId === "string" &&
    "relayId" in value &&
    typeof value.relayId === "string"
  ) {
    const component = value.component
    const relayId = value.relayId
    return {
      component,
      name:
        "name" in value && typeof value.name === "string"
          ? value.name
          : displayComponent(component),
      operationId: value.operationId,
      previousVersion:
        "previousVersion" in value &&
        (typeof value.previousVersion === "string" ||
          value.previousVersion === null)
          ? value.previousVersion
          : null,
      relayId,
      targetKey:
        "targetKey" in value && typeof value.targetKey === "string"
          ? value.targetKey
          : component === "hearth"
            ? "hearth"
            : relayTargetKey(relayId),
    }
  }
  return null
}

function storeActiveUpdates(active: ReadonlyArray<ActiveUpdate>): void {
  if (active.length === 0) {
    window.localStorage.removeItem(activeUpdateStorageKey)
    return
  }
  window.localStorage.setItem(activeUpdateStorageKey, JSON.stringify(active))
}

type ChangelogRange = {
  fromVersion: string | null
  toVersion: string
}

function previousChangelogVersion(
  target: UpdateTarget,
  latestVersion: string | null
): string | null {
  const ranges = readStorageRecord<ChangelogRange>(changelogRangeStorageKey)
  const range = ranges[target.key]
  return range?.toVersion === target.currentVersion &&
    target.currentVersion === latestVersion
    ? range.fromVersion
    : target.currentVersion
}

function storeChangelogRange(
  targetKey: string,
  fromVersion: string | null,
  toVersion: string
): void {
  const ranges = readStorageRecord<ChangelogRange>(changelogRangeStorageKey)
  ranges[targetKey] = { fromVersion, toVersion }
  window.localStorage.setItem(changelogRangeStorageKey, JSON.stringify(ranges))
}

function incrementUpdateFailureCount(targetKey: string): number {
  const failures = readStorageRecord<number>(updateFailureStorageKey)
  const previousCount = failures[targetKey]
  const count =
    (typeof previousCount === "number" && Number.isFinite(previousCount)
      ? previousCount
      : 0) + 1
  failures[targetKey] = count
  window.localStorage.setItem(updateFailureStorageKey, JSON.stringify(failures))
  return count
}

function resetUpdateFailureCount(targetKey: string): void {
  const failures = readStorageRecord<number>(updateFailureStorageKey)
  if (!(targetKey in failures)) return
  delete failures[targetKey]
  if (Object.keys(failures).length === 0) {
    window.localStorage.removeItem(updateFailureStorageKey)
    return
  }
  window.localStorage.setItem(updateFailureStorageKey, JSON.stringify(failures))
}

function readStorageRecord<Value>(key: string): Record<string, Value> {
  try {
    const stored = window.localStorage.getItem(key)
    if (!stored) return {}
    const parsed: unknown = JSON.parse(stored)
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, Value>)
      : {}
  } catch {
    return {}
  }
}

function displayVersion(version: string | null): string {
  return version ? `v${version}` : "Version unavailable"
}

function displayComponent(component: "hearth" | "relay"): string {
  return component === "hearth" ? "Panel" : "Relay"
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

function markdownTextLines(
  notes: string | null
): Array<{ id: string; text: string }> {
  if (!notes?.trim()) {
    return [{ id: "no-changes", text: "No changes were specified." }]
  }

  const lines = notes
    .replaceAll("\r", "")
    .split("\n")
    .map((line) =>
      line.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/u, "").trim()
    )
    .filter(
      (line) =>
        line.length > 0 &&
        !/^(```|~~~)/u.test(line) &&
        !/^[-*_]{3,}$/u.test(line)
    )
  const occurrences = new Map<string, number>()

  return lines.map((text) => {
    const occurrence = (occurrences.get(text) ?? 0) + 1
    occurrences.set(text, occurrence)
    return { id: `${text}:${occurrence}`, text }
  })
}

function linkedMarkdownText(text: string): React.ReactNode {
  const linkPattern =
    /!?\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<]+)/gu
  const content: Array<React.ReactNode> = []
  let cursor = 0

  for (const match of text.matchAll(linkPattern)) {
    const index = match.index
    const markdownLabel = match[1]
    const markdownUrl = match[2]
    const bareUrl = match[3]
    if (index > cursor) {
      content.push(stripInlineMarkdown(text.slice(cursor, index)))
    }

    const rawUrl = markdownUrl ?? bareUrl
    if (!rawUrl) continue
    const url = bareUrl ? trimBareUrl(rawUrl) : rawUrl
    const label = markdownLabel ? stripInlineMarkdown(markdownLabel) : url
    content.push(
      <a
        className="text-primary underline decoration-primary/35 underline-offset-2 transition-colors hover:decoration-primary"
        href={url}
        key={`${index}:${url}`}
        rel="noreferrer"
        target="_blank"
      >
        {label}
      </a>
    )
    cursor =
      index + match[0].length - (bareUrl ? rawUrl.length - url.length : 0)
  }

  if (cursor < text.length) {
    content.push(stripInlineMarkdown(text.slice(cursor)))
  }
  return content.length > 0 ? content : stripInlineMarkdown(text)
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<\/?[^>]+>/gu, "")
    .replace(/[*_~`]+/gu, "")
}

function trimBareUrl(url: string): string {
  return url.replace(/[),.;:!?]+$/u, "")
}
