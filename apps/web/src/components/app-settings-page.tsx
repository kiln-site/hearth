import * as React from "react"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import {
  Check,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Trash2,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { dismissToast, showToast } from "@workspace/ui/components/sonner"

import { RelayToastTitle } from "@/components/relay-toast-title"
import { queryKeys, relaysQueryOptions } from "@/lib/query-options"
import type { PersistedRelay } from "@/lib/relay-registry"
import {
  addRelay,
  checkRelay,
  removeRelay,
  setRelayEnabled,
  updateRelay,
} from "@/server/relays"

const relayConnectedFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
})
const pendingRelayResumes = new Map<string, Promise<void>>()

export function AppSettingsPage() {
  const { data: relays } = useSuspenseQuery(relaysQueryOptions())
  const selection = React.useMemo(createRelaySelectionStore, [])

  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-10">
      <div className="grid gap-5 lg:grid-cols-[minmax(17rem,0.72fr)_minmax(27rem,1.28fr)]">
        <RelayList relays={relays} selection={selection} />
        <SelectedRelayEditor relays={relays} selection={selection} />
      </div>
    </div>
  )
}

interface RelaySelectionStore {
  clearIfSelected: (id: string) => void
  getSnapshot: () => string | null
  select: (id: string | null) => void
  subscribe: (listener: () => void) => () => void
}

function createRelaySelectionStore(): RelaySelectionStore {
  let selectedId: string | null = null
  const listeners = new Set<() => void>()
  const select = (id: string | null) => {
    if (id === selectedId) return
    selectedId = id
    for (const listener of listeners) listener()
  }
  return {
    clearIfSelected: (id) => {
      if (selectedId === id) select(null)
    },
    getSnapshot: () => selectedId,
    select,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const SelectedRelayEditor = React.memo(function SelectedRelayEditor({
  relays,
  selection,
}: {
  relays: Array<PersistedRelay>
  selection: RelaySelectionStore
}) {
  const selectedId = React.useSyncExternalStore(
    selection.subscribe,
    selection.getSnapshot,
    selection.getSnapshot
  )
  const selectedRelay = relays.find((relay) => relay.id === selectedId) ?? null
  const startAdding = React.useCallback(
    () => selection.select(null),
    [selection]
  )
  return (
    <RelayEditor
      key={selectedRelay?.id ?? "new-relay"}
      relay={selectedRelay}
      onStartAdding={startAdding}
    />
  )
})

const RelayList = React.memo(function RelayList({
  relays,
  selection,
}: {
  relays: Array<PersistedRelay>
  selection: RelaySelectionStore
}) {
  return (
    <section className="self-start overflow-hidden rounded-xl border bg-card/45">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <ServerCog className="size-4 text-primary" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Known Relays</h2>
          <p className="text-[10px] text-muted-foreground">
            Pause a Relay to suspend Hearth requests without stopping it.
          </p>
        </div>
      </div>
      <div className="divide-y">
        {relays.length === 0 ? <EmptyRelayList /> : null}
        {relays.map((relay) => (
          <RelayRow key={relay.id} relay={relay} selection={selection} />
        ))}
      </div>
    </section>
  )
})

const RelayRow = React.memo(function RelayRow({
  relay,
  selection,
}: {
  relay: PersistedRelay
  selection: RelaySelectionStore
}) {
  const queryClient = useQueryClient()
  const getSelectedSnapshot = React.useCallback(
    () => selection.getSnapshot() === relay.id,
    [relay.id, selection]
  )
  const selected = React.useSyncExternalStore(
    selection.subscribe,
    getSelectedSnapshot,
    getSelectedSnapshot
  )
  const [pending, setPending] = React.useState<
    "check" | "pause" | "remove" | "resume" | null
  >(null)
  const [error, setError] = React.useState<string | null>(null)
  const checkMutation = useMutation({
    mutationFn: checkRelay,
    onSuccess: () => invalidateRelayQueries(queryClient),
  })
  const removeMutation = useMutation({
    mutationFn: removeRelay,
    onSuccess: () => invalidateRelayQueries(queryClient),
  })

  async function refresh(event: React.MouseEvent) {
    event.stopPropagation()
    setPending("check")
    setError(null)
    try {
      await checkMutation.mutateAsync({ data: { id: relay.id } })
    } catch (cause) {
      setError(messageFrom(cause, "Could not check Relay"))
    } finally {
      setPending(null)
    }
  }

  async function remove(event: React.MouseEvent) {
    event.stopPropagation()
    if (!window.confirm(`Remove ${relay.name} from Hearth?`)) return
    setPending("remove")
    setError(null)
    try {
      await removeMutation.mutateAsync({ data: { id: relay.id } })
      dismissToast(relayPausedToastId(relay.id))
      dismissToast(relayResumedToastId(relay.id))
      dismissToast(relayResumeErrorToastId(relay.id))
      selection.clearIfSelected(relay.id)
    } catch (cause) {
      setError(messageFrom(cause, "Could not remove Relay"))
    } finally {
      setPending(null)
    }
  }

  async function togglePaused(event: React.MouseEvent) {
    event.stopPropagation()
    setPending(relay.enabled ? "pause" : "resume")
    setError(null)
    try {
      if (relay.enabled) {
        await pauseRelay(queryClient, relay)
      } else {
        await resumeRelay(queryClient, relay)
      }
    } catch (cause) {
      setError(
        messageFrom(
          cause,
          relay.enabled ? "Could not pause Relay" : "Could not resume Relay"
        )
      )
    } finally {
      setPending(null)
    }
  }

  return (
    <div
      className={`group relative cursor-pointer px-4 py-4 transition-colors ${
        selected ? "bg-primary/[0.07]" : "hover:bg-accent/35"
      }`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => selection.select(relay.id)}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault()
          selection.select(relay.id)
        }
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-1.5 size-2 shrink-0 rounded-full ${!relay.enabled ? "bg-sky-400" : relay.lastError ? "bg-destructive" : relay.lastConnectedAt ? "bg-emerald-400" : "bg-muted-foreground/30"}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-semibold">{relay.name}</span>
            <Pencil className="size-3 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
            {relay.useTls ? "https" : "http"}://{relay.hostname}:{relay.port}
          </p>
          <RelayMetadata relay={relay} />
          {error ? (
            <p className="mt-2 text-[10px] leading-4 text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            size="icon-sm"
            variant="ghost"
            title="Check connection"
            aria-label={`Check ${relay.name} connection`}
            disabled={pending !== null || !relay.enabled}
            onClick={(event) => void refresh(event)}
          >
            {pending === "check" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            title={relay.enabled ? "Pause Relay" : "Resume Relay"}
            aria-label={`${relay.enabled ? "Pause" : "Resume"} ${relay.name}`}
            disabled={pending !== null}
            onClick={(event) => void togglePaused(event)}
          >
            {pending === "pause" || pending === "resume" ? (
              <LoaderCircle className="animate-spin" />
            ) : relay.enabled ? (
              <Pause />
            ) : (
              <Play />
            )}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            title="Remove Relay"
            aria-label={`Remove ${relay.name}`}
            disabled={pending !== null}
            onClick={(event) => void remove(event)}
          >
            {pending === "remove" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Trash2 />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
})

function RelayMetadata({ relay }: { relay: PersistedRelay }) {
  if (!relay.enabled) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-[10px] leading-4 text-sky-300/85">
        <Pause className="size-3" /> Hearth requests are paused
      </p>
    )
  }
  if (relay.lastError) {
    return (
      <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-destructive/85">
        {relay.lastError}
      </p>
    )
  }
  if (!relay.lastConnectedAt) return null
  return (
    <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 font-mono text-[9px] text-muted-foreground">
      <span>{relay.managedEmberCount ?? 0} active Embers</span>
      <span aria-hidden="true">·</span>
      <span>{relay.nodeVersion ?? "version unknown"}</span>
      {relay.nodePlatform && relay.nodeArch ? (
        <>
          <span aria-hidden="true">·</span>
          <span>
            {relay.nodePlatform}/{relay.nodeArch}
          </span>
        </>
      ) : null}
      <span className="basis-full text-muted-foreground/70">
        Checked{" "}
        {relayConnectedFormatter.format(new Date(relay.lastConnectedAt))} UTC
      </span>
    </div>
  )
}

function EmptyRelayList() {
  return (
    <div className="px-4 py-10 text-center">
      <ServerCog className="mx-auto size-5 text-muted-foreground/45" />
      <p className="mt-3 text-xs font-semibold">No saved Relays</p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Add the first Relay from the connection editor.
      </p>
    </div>
  )
}

interface RelayEditorProps {
  relay: PersistedRelay | null
  onStartAdding: () => void
}

const RelayEditor = React.memo(function RelayEditor({
  relay,
  onStartAdding,
}: RelayEditorProps) {
  const queryClient = useQueryClient()
  const formRef = React.useRef<HTMLFormElement>(null)
  const [pending, setPending] = React.useState(false)
  const [feedback, setFeedback] = React.useState<{
    tone: "error" | "success"
    message: string
  } | null>(null)
  const addMutation = useMutation({
    mutationFn: addRelay,
    onSuccess: () => invalidateRelayQueries(queryClient),
  })
  const updateMutation = useMutation({
    mutationFn: updateRelay,
    onSuccess: () => invalidateRelayQueries(queryClient),
  })

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setPending(true)
    setFeedback(null)
    try {
      const saved = relay
        ? await updateMutation.mutateAsync({
            data: {
              hostname: String(formData.get("hostname") ?? ""),
              id: relay.id,
              port: Number(formData.get("port")),
              useTls: relay.useTls,
            },
          })
        : await addMutation.mutateAsync({
            data: {
              pairingUri: String(formData.get("pairingUri") ?? "").trim(),
            },
          })
      if (!saved.enabled) {
        setFeedback({
          tone: "success",
          message: `${saved.name} was saved without a connection check because it was paused.`,
        })
      } else {
        setFeedback({
          tone: saved.lastError ? "error" : "success",
          message: saved.lastError
            ? `${saved.name} was saved, but Hearth could not connect.`
            : `${saved.name} is saved and connected.`,
        })
      }
      if (!relay) formRef.current?.reset()
    } catch (cause) {
      setFeedback({
        tone: "error",
        message: messageFrom(cause, "Could not save Relay"),
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="self-start rounded-xl border bg-card/45 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[9px] tracking-[0.16em] text-primary uppercase">
            {relay ? "Edit connection" : "New connection"}
          </p>
          <h2 className="mt-1 font-heading text-xl font-semibold tracking-[-0.03em]">
            {relay ? relay.name : "Add a Relay"}
          </h2>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            {relay
              ? "Update where Hearth reaches this paired Relay."
              : "Paste the one-time URI printed by Relay to pair securely."}
          </p>
        </div>
        {relay ? (
          <Button size="sm" variant="outline" onClick={onStartAdding}>
            <Plus /> Add Relay
          </Button>
        ) : null}
      </div>

      <form
        ref={formRef}
        className="mt-6 space-y-4"
        onSubmit={(event) => void save(event)}
      >
        {relay ? (
          <>
            <div className="rounded-lg border border-primary/15 bg-primary/[0.045] px-3 py-2 font-mono text-[9px] leading-4 text-muted-foreground">
              Relay identity {relay.id.slice(0, 12)}… ·{" "}
              {relay.role.replace("_", " ")}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
              <Field label="Host" htmlFor="relay-hostname">
                <div className="flex items-center rounded-md border border-input bg-transparent shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                  <span className="pl-3 font-mono text-[10px] text-muted-foreground">
                    {relay.useTls ? "wss://" : "ws://"}
                  </span>
                  <Input
                    id="relay-hostname"
                    name="hostname"
                    defaultValue={relay.hostname}
                    placeholder="relay.example.com"
                    className="border-0 pl-1 shadow-none focus-visible:border-0 focus-visible:ring-0"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                  />
                </div>
              </Field>
              <Field label="Port" htmlFor="relay-port">
                <Input
                  id="relay-port"
                  name="port"
                  defaultValue={String(relay.port)}
                  type="number"
                  min={1}
                  max={65_535}
                  required
                />
              </Field>
            </div>
          </>
        ) : (
          <Field label="One-time pairing URI" htmlFor="relay-pairing-uri">
            <textarea
              id="relay-pairing-uri"
              name="pairingUri"
              className="min-h-36 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-[10px] leading-4 shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              placeholder="kiln-relay://pair/v1?payload=…"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </Field>
        )}

        {feedback ? (
          <div
            role="status"
            className={`flex min-h-9 items-start gap-2 rounded-lg border px-3 py-2 text-[10px] ${
              feedback.tone === "error"
                ? "border-destructive/25 bg-destructive/[0.06] text-destructive"
                : "border-emerald-400/20 bg-emerald-400/[0.055] text-emerald-200"
            }`}
          >
            {feedback.tone === "error" ? (
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <Check className="mt-0.5 size-3.5 shrink-0" />
            )}
            {feedback.message}
          </div>
        ) : null}

        <Button className="w-full" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : <Check />}
          {relay ? "Save endpoint" : "Pair Relay"}
        </Button>
      </form>

      {relay ? <RelayBrowserTrust relay={relay} /> : null}

      <div className="mt-5 flex gap-2.5 border-t pt-4 text-[9px] leading-4 text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
        <p>
          TLS is independent of port: HTTPS works on 443 or any other port when
          the Relay endpoint or its proxy presents a valid certificate.
        </p>
      </div>
    </section>
  )
}, relayEditorPropsEqual)

function RelayBrowserTrust({ relay }: { relay: PersistedRelay }) {
  const [state, setState] = React.useState<
    "idle" | "checking" | "trusted" | "untrusted"
  >("idle")
  const trustOrigin = React.useMemo(() => {
    const url = new URL(relay.browserOrigin)
    if (url.protocol === "wss:") url.protocol = "https:"
    if (url.protocol === "ws:") url.protocol = "http:"
    return url
  }, [relay.browserOrigin])
  const verify = React.useCallback(async () => {
    setState("checking")
    try {
      const response = await fetch(new URL("/v1/trust", trustOrigin), {
        cache: "no-store",
        mode: "cors",
      })
      setState(response.ok ? "trusted" : "untrusted")
    } catch {
      setState("untrusted")
    }
  }, [trustOrigin])

  return (
    <div className="mt-5 rounded-lg border border-border/70 bg-background/30 p-3 text-left">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold">Browser trust</p>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Required for direct console streams and file transfers on port{" "}
            {relay.port}.
          </p>
        </div>
        <span
          className={`mt-0.5 size-2 shrink-0 rounded-full ${
            state === "trusted"
              ? "bg-emerald-400"
              : state === "untrusted"
                ? "bg-destructive"
                : "bg-muted-foreground/35"
          }`}
          aria-label={
            state === "trusted"
              ? "Browser trusts Relay"
              : "Browser trust not verified"
          }
        />
      </div>
      <p className="mt-3 text-[10px] leading-4 text-muted-foreground">
        {relay.managedTls
          ? "Install the Relay CA once on each device. Relay keeps that CA stable and renews its short-lived server certificate automatically."
          : "This Relay uses an external certificate. Its public CA or reverse proxy must already be trusted by this browser."}
      </p>
      {state === "untrusted" ? (
        <p className="mt-2 text-[10px] leading-4 text-destructive">
          This browser could not establish trusted HTTPS to the Relay. Install
          the CA or correct the external certificate, then verify again.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={state === "checking"}
          onClick={() => void verify()}
        >
          {state === "checking" ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <ShieldCheck />
          )}
          {state === "trusted" ? "Trusted" : "Verify access"}
        </Button>
        {relay.managedTls ? (
          <Button size="sm" variant="outline" asChild>
            <a
              href={new URL("/v1/trust/ca.pem", trustOrigin).toString()}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink /> Download Relay CA
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-[10px] font-medium text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  )
}

async function invalidateRelayQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.relays }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.relay.connection,
      exact: true,
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.relay.snapshot,
      exact: true,
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.bricks }),
    queryClient.invalidateQueries({ queryKey: queryKeys.access.capabilities }),
  ])
}

async function pauseRelay(
  queryClient: QueryClient,
  relay: PersistedRelay
): Promise<void> {
  await queryClient.cancelQueries({
    predicate: ({ queryKey }) =>
      queryKey[0] === queryKeys.relay.all[0] &&
      (queryKey[1] === queryKeys.relay.connection[1] ||
        queryKey[1] === queryKeys.relay.snapshot[1] ||
        queryKey[1] === relay.id),
  })
  await setRelayEnabled({ data: { enabled: false, id: relay.id } })
  await invalidateRelayQueries(queryClient)
  dismissToast(relayResumedToastId(relay.id))
  showPausedRelayToast(queryClient, relay)
}

async function resumeRelay(
  queryClient: QueryClient,
  relay: PersistedRelay
): Promise<void> {
  const existing = pendingRelayResumes.get(relay.id)
  if (existing) return existing

  dismissToast(relayResumeErrorToastId(relay.id))
  const pending = performRelayResume(queryClient, relay)
  pendingRelayResumes.set(relay.id, pending)
  try {
    await pending
  } finally {
    if (pendingRelayResumes.get(relay.id) === pending) {
      pendingRelayResumes.delete(relay.id)
    }
  }
}

async function performRelayResume(
  queryClient: QueryClient,
  relay: PersistedRelay
): Promise<void> {
  await setRelayEnabled({ data: { enabled: true, id: relay.id } })
  await invalidateRelayQueries(queryClient)
  dismissToast(relayPausedToastId(relay.id))
  dismissToast(relayResumeErrorToastId(relay.id))
  showToast({
    type: "success",
    message: <RelayToastTitle name={relay.name} state="resumed" />,
    id: relayResumedToastId(relay.id),
    icon: <Play className="size-4 text-emerald-400" />,
    description: "Hearth has resumed requesting Relay data.",
    duration: 4_000,
  })
}

function showPausedRelayToast(
  queryClient: QueryClient,
  relay: PersistedRelay
): void {
  showToast({
    type: "info",
    message: <RelayToastTitle name={relay.name} state="paused" />,
    id: relayPausedToastId(relay.id),
    icon: <Pause className="size-4 text-sky-400" />,
    description: "Hearth stopped requesting data. The Relay remains online.",
    duration: Infinity,
    action: {
      label: "Reconnect",
      onClick: (event) => {
        event.preventDefault()
        void resumeRelay(queryClient, relay).catch((cause: unknown) => {
          showToast({
            type: "error",
            message: (
              <RelayToastTitle name={relay.name} state="could not be resumed" />
            ),
            id: relayResumeErrorToastId(relay.id),
            description: messageFrom(cause, "Try reconnecting again."),
            duration: 6_000,
          })
        })
      },
    },
  })
}

function relayPausedToastId(relayId: string): string {
  return `relay-paused:${relayId}`
}

function relayResumedToastId(relayId: string): string {
  return `relay-resumed:${relayId}`
}

function relayResumeErrorToastId(relayId: string): string {
  return `relay-resume-error:${relayId}`
}

function relayEditorPropsEqual(
  previous: RelayEditorProps,
  next: RelayEditorProps
): boolean {
  if (previous.onStartAdding !== next.onStartAdding) return false
  if (previous.relay === next.relay) return true
  if (!previous.relay || !next.relay) return false
  return (
    previous.relay.id === next.relay.id &&
    previous.relay.name === next.relay.name &&
    previous.relay.hostname === next.relay.hostname &&
    previous.relay.port === next.relay.port &&
    previous.relay.useTls === next.relay.useTls &&
    previous.relay.browserOrigin === next.relay.browserOrigin &&
    previous.relay.managedTls === next.relay.managedTls
  )
}

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
