import * as React from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import {
  Check,
  CircleAlert,
  Clipboard,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Network,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { dismissToast, showToast } from "@workspace/ui/components/sonner"

import { RelayToastTitle } from "@/components/relay-toast-title"
import { queryKeys, relaysQueryOptions } from "@/lib/query-options"
import type {
  PersistedRelay,
  RelayAdministration,
  RelayClientAdministration,
} from "@/lib/relay-registry"
import {
  addRelay,
  checkRelay,
  createRelayInvitation,
  getRelayAdministration,
  getRelayProxy,
  previewRelayPairing,
  removeRelay,
  renameRelay,
  revokeHearthClient,
  revokeRelayInvitation,
  setRelayEnabled,
  updateRelayClient,
  updateRelay,
  updateRelayProxy,
} from "@/server/relays"

const relayConnectedFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
})
const invitationTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
})
const pendingRelayResumes = new Map<string, Promise<void>>()

function relayAdministrationKey(relayId: string) {
  return ["relays", "administration", relayId] as const
}

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
  const [reviewedPairing, setReviewedPairing] = React.useState<{
    pairingUri: string
    preview: {
      browserOrigin: string
      controlEndpoint: string
      expiresAt: number
      managedTls: boolean
      relayFingerprint: string
      relayName: string
    }
  } | null>(null)
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
  const renameMutation = useMutation({
    mutationFn: renameRelay,
    onSuccess: () => invalidateRelayQueries(queryClient),
  })

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setPending(true)
    setFeedback(null)
    try {
      if (!relay && !reviewedPairing) {
        const pairingUri = String(formData.get("pairingUri") ?? "").trim()
        const preview = await previewRelayPairing({ data: { pairingUri } })
        setReviewedPairing({ pairingUri, preview })
        return
      }
      const saved = relay
        ? await (async () => {
            const requestedName = String(formData.get("name") ?? "").trim()
            if (requestedName !== relay.name) {
              await renameMutation.mutateAsync({
                data: { name: requestedName, relayId: relay.id },
              })
            }
            try {
              return await updateMutation.mutateAsync({
                data: {
                  hostname: String(formData.get("hostname") ?? ""),
                  id: relay.id,
                  port: Number(formData.get("port")),
                  useTls: relay.useTls,
                },
              })
            } catch (cause) {
              if (requestedName !== relay.name) {
                try {
                  await renameMutation.mutateAsync({
                    data: { name: relay.name, relayId: relay.id },
                  })
                } catch {
                  throw new Error(
                    "The connection update failed, and the Relay name could not be restored. Refresh to review its current state.",
                    { cause }
                  )
                }
              }
              throw cause
            }
          })()
        : await addMutation.mutateAsync({
            data: {
              pairingUri: reviewedPairing?.pairingUri ?? "",
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
      if (!relay) {
        formRef.current?.reset()
        setReviewedPairing(null)
      }
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
            <Field label="Relay name" htmlFor="relay-name">
              <Input
                id="relay-name"
                name="name"
                defaultValue={relay.name}
                maxLength={120}
                required
              />
            </Field>
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
        ) : reviewedPairing ? (
          <PairingReview
            pairing={reviewedPairing.preview}
            onBack={() => setReviewedPairing(null)}
          />
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
          {relay
            ? "Save Relay"
            : reviewedPairing
              ? "Confirm and pair"
              : "Review pairing"}
        </Button>
      </form>

      {relay ? (
        <>
          <RelayProxyConfiguration relay={relay} />
          <RelayBrowserTrust relay={relay} />
          <RelayAdministrationPanel relay={relay} />
        </>
      ) : null}

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

function PairingReview({
  pairing,
  onBack,
}: {
  pairing: {
    browserOrigin: string
    controlEndpoint: string
    expiresAt: number
    managedTls: boolean
    relayFingerprint: string
    relayName: string
  }
  onBack: () => void
}) {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/[0.045] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[9px] tracking-[0.14em] text-primary uppercase">
            Verify identity
          </p>
          <p className="mt-1 text-sm font-semibold">{pairing.relayName}</p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onBack}>
          <X /> Back
        </Button>
      </div>
      <dl className="mt-4 space-y-3 text-[10px]">
        <div>
          <dt className="text-muted-foreground">Relay fingerprint</dt>
          <dd className="mt-1 font-mono break-all text-foreground">
            {pairing.relayFingerprint}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Control endpoint</dt>
          <dd className="mt-1 font-mono break-all text-foreground">
            {pairing.controlEndpoint}
          </dd>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-muted-foreground">TLS trust</dt>
            <dd className="mt-1 text-foreground">
              {pairing.managedTls ? "Relay-managed CA" : "System trust"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Invitation expires</dt>
            <dd className="mt-1 text-foreground">
              {invitationTimeFormatter.format(new Date(pairing.expiresAt))}
            </dd>
          </div>
        </div>
      </dl>
      <p className="mt-4 text-[10px] leading-4 text-muted-foreground">
        Confirm this fingerprint against the Relay terminal before pairing.
        Hearth will generate a unique key that is never shared with another
        Hearth.
      </p>
    </div>
  )
}

function RelayAdministrationPanel({ relay }: { relay: PersistedRelay }) {
  const queryClient = useQueryClient()
  const query = useQuery({
    enabled: relay.enabled && !relay.lastError,
    queryFn: () => getRelayAdministration({ data: { id: relay.id } }),
    queryKey: relayAdministrationKey(relay.id),
    retry: false,
    staleTime: 10_000,
  })
  const [role, setRole] = React.useState<"full_access" | "read_only">(
    "full_access"
  )
  const [createdInvitation, setCreatedInvitation] = React.useState<{
    uri: string
    envelope: { expiresAt: number; invitationId: string }
  } | null>(null)
  const [pendingInvitation, setPendingInvitation] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function createInvitation() {
    setPendingInvitation(true)
    setError(null)
    try {
      const invitation = await createRelayInvitation({
        data: { relayId: relay.id, role },
      })
      setCreatedInvitation(invitation)
      await queryClient.invalidateQueries({
        queryKey: relayAdministrationKey(relay.id),
      })
    } catch (cause) {
      setError(messageFrom(cause, "Could not create pairing invitation"))
    } finally {
      setPendingInvitation(false)
    }
  }

  if (!relay.enabled) return null
  return (
    <div className="mt-5 space-y-4 border-t pt-5">
      <div>
        <p className="font-mono text-[9px] tracking-[0.16em] text-primary uppercase">
          Relay access
        </p>
        <h3 className="mt-1 text-sm font-semibold">Hearth clients & SFTP</h3>
      </div>
      {query.isPending ? (
        <div className="flex items-center gap-2 rounded-lg border p-3 text-[10px] text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" /> Loading Relay
          policy…
        </div>
      ) : query.error ? (
        <div className="rounded-lg border border-destructive/25 bg-destructive/[0.05] p-3 text-[10px] text-destructive">
          {messageFrom(query.error, "Could not load Relay administration")}
        </div>
      ) : query.data ? (
        <>
          <SftpConnectionDetails administration={query.data} />
          <div className="rounded-lg border border-border/70 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="New Hearth access" htmlFor="new-hearth-role">
                <select
                  id="new-hearth-role"
                  className="h-8 rounded-md border border-input bg-background px-2 text-[10px]"
                  value={role}
                  onChange={(event) =>
                    setRole(
                      event.target.value === "read_only"
                        ? "read_only"
                        : "full_access"
                    )
                  }
                >
                  <option value="full_access">Full access</option>
                  <option value="read_only">Read only</option>
                </select>
              </Field>
              <Button
                type="button"
                size="sm"
                disabled={pendingInvitation}
                onClick={() => void createInvitation()}
              >
                {pendingInvitation ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <KeyRound />
                )}
                Create invitation
              </Button>
            </div>
            {createdInvitation ? (
              <div className="mt-3 rounded-md border border-primary/20 bg-primary/[0.045] p-3">
                <p className="text-[10px] font-semibold">
                  Copy this one-time URI now
                </p>
                <p className="mt-1 text-[9px] text-muted-foreground">
                  Expires{" "}
                  {invitationTimeFormatter.format(
                    new Date(createdInvitation.envelope.expiresAt)
                  )}
                  . Relay will never return its token again.
                </p>
                <textarea
                  aria-label="One-time pairing URI"
                  className="mt-2 min-h-24 w-full resize-y rounded-md border bg-background/70 p-2 font-mono text-[9px]"
                  readOnly
                  value={createdInvitation.uri}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void navigator.clipboard.writeText(createdInvitation.uri)
                  }
                >
                  <Clipboard /> Copy URI
                </Button>
              </div>
            ) : null}
            {error ? (
              <p className="mt-2 text-[10px] text-destructive">{error}</p>
            ) : null}
            <PendingInvitations
              invitations={query.data.invitations}
              relayId={relay.id}
            />
          </div>
          <div className="space-y-2">
            {query.data.clients.map((client) => (
              <RelayClientCard
                key={clientPolicyKey(client)}
                client={client}
                currentClientId={relay.clientId}
                relayId={relay.id}
              />
            ))}
          </div>
          <RelayAuditTrail audits={query.data.audits} />
        </>
      ) : null}
    </div>
  )
}

function RelayAuditTrail({
  audits,
}: {
  audits: RelayAdministration["audits"]
}) {
  return (
    <details className="rounded-lg border border-border/70 bg-background/30 p-3">
      <summary className="cursor-pointer text-xs font-semibold">
        Recent security activity ({audits.length})
      </summary>
      {audits.length ? (
        <ol className="mt-3 max-h-64 space-y-2 overflow-y-auto">
          {audits.map((audit) => (
            <li key={audit.id} className="border-l border-primary/25 pl-2.5">
              <p className="font-mono text-[9px] text-foreground">
                {audit.event}
              </p>
              <p className="mt-0.5 font-mono text-[8px] text-muted-foreground">
                {invitationTimeFormatter.format(new Date(audit.occurredAt))}
                {audit.clientId ? ` · ${audit.clientId.slice(0, 8)}` : ""}
                {audit.requestId ? ` · ${audit.requestId.slice(0, 8)}` : ""}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-[9px] text-muted-foreground">
          No security events have been recorded yet.
        </p>
      )}
    </details>
  )
}

function SftpConnectionDetails({
  administration,
}: {
  administration: RelayAdministration
}) {
  const sftp = administration.service?.sftp
  if (!sftp) return null
  return (
    <div className="rounded-lg border border-border/70 bg-background/30 p-3">
      <div className="flex items-center gap-2">
        <KeyRound className="size-3.5 text-primary" />
        <p className="text-xs font-semibold">SFTP endpoint</p>
      </div>
      <p className="mt-2 font-mono text-[10px] text-foreground">
        {sftp.host}:{sftp.port}
      </p>
      <p className="mt-1 font-mono text-[9px] break-all text-muted-foreground">
        {sftp.hostKeyFingerprint}
      </p>
      {sftp.developmentAuthentication ? (
        <p className="mt-2 text-[10px] leading-4 text-amber-300">
          Development only: use your Hearth email as the username and dev123 as
          the password. Set the username separately because email contains @.
        </p>
      ) : null}
    </div>
  )
}

function PendingInvitations({
  invitations,
  relayId,
}: {
  invitations: RelayAdministration["invitations"]
  relayId: string
}) {
  const queryClient = useQueryClient()
  if (!invitations.length) return null
  return (
    <div className="mt-3 space-y-1.5 border-t pt-3">
      <p className="text-[9px] font-medium text-muted-foreground">
        Pending invitations
      </p>
      {invitations.map((invitation) => (
        <div
          key={invitation.id}
          className="flex items-center justify-between gap-2 text-[9px]"
        >
          <span className="truncate font-mono text-muted-foreground">
            {invitation.id.slice(0, 8)} · {invitation.role.replace("_", " ")} ·{" "}
            {invitationTimeFormatter.format(new Date(invitation.expiresAt))}
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Revoke pairing invitation"
            onClick={() =>
              void revokeRelayInvitation({
                data: { invitationId: invitation.id, relayId },
              }).then(() =>
                queryClient.invalidateQueries({
                  queryKey: relayAdministrationKey(relayId),
                })
              )
            }
          >
            <X />
          </Button>
        </div>
      ))}
    </div>
  )
}

function RelayClientCard({
  client,
  currentClientId,
  relayId,
}: {
  client: RelayClientAdministration
  currentClientId: string
  relayId: string
}) {
  const queryClient = useQueryClient()
  const cidrInputRef = React.useRef<HTMLTextAreaElement>(null)
  const [pending, setPending] = React.useState<"revoke" | "save" | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const isCurrent = client.id === currentClientId

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const formData = new FormData(event.currentTarget)
    const roleValue = String(formData.get("role"))
    const role =
      roleValue === "read_only"
        ? "read_only"
        : roleValue === "custom"
          ? "custom"
          : "full_access"
    setPending("save")
    setError(null)
    try {
      await updateRelayClient({
        data: {
          actions:
            role === "custom"
              ? splitLines(String(formData.get("actions") ?? ""))
              : undefined,
          clientId: client.id,
          name: String(formData.get("name") ?? ""),
          relayId,
          role,
          sourceCidrs: splitLines(String(formData.get("sourceCidrs") ?? "")),
        },
      })
      await Promise.all([
        invalidateRelayQueries(queryClient),
        queryClient.invalidateQueries({
          queryKey: relayAdministrationKey(relayId),
        }),
      ])
    } catch (cause) {
      setError(messageFrom(cause, "Could not update Hearth client"))
    } finally {
      setPending(null)
    }
  }

  async function revoke() {
    if (pending) return
    if (
      !window.confirm(
        isCurrent
          ? "Revoke this Hearth? It will immediately lose access to the Relay."
          : `Revoke ${client.name}?`
      )
    )
      return
    setPending("revoke")
    try {
      await revokeHearthClient({ data: { clientId: client.id, relayId } })
      await queryClient.invalidateQueries({
        queryKey: relayAdministrationKey(relayId),
      })
    } catch (cause) {
      setError(messageFrom(cause, "Could not revoke Hearth client"))
    } finally {
      setPending(null)
    }
  }

  const observedCidr = client.lastAddress
    ? exactAddressCidr(client.lastAddress)
    : null
  return (
    <form
      className="rounded-lg border border-border/70 p-3"
      onSubmit={(event) => void save(event)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <UserRound className="size-3.5 text-primary" />
            <p className="truncate text-xs font-semibold">{client.name}</p>
            {isCurrent ? (
              <span className="rounded border px-1.5 py-0.5 font-mono text-[8px] text-muted-foreground">
                this Hearth
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">
            {client.id.slice(0, 16)}…
          </p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={pending !== null}
          aria-label={`Revoke ${client.name}`}
          onClick={() => void revoke()}
        >
          {pending === "revoke" ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <Trash2 />
          )}
        </Button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Client name" htmlFor={`client-name-${client.id}`}>
          <Input
            id={`client-name-${client.id}`}
            name="name"
            defaultValue={client.name}
            maxLength={120}
            required
          />
        </Field>
        <Field label="Relay role" htmlFor={`client-role-${client.id}`}>
          <select
            id={`client-role-${client.id}`}
            name="role"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-[10px]"
            defaultValue={client.role}
          >
            <option value="full_access">Full access</option>
            <option value="read_only">Read only</option>
            <option value="custom">Custom actions</option>
          </select>
        </Field>
      </div>
      <div className="mt-3">
        <Field
          label="Custom action keys (used only by the custom role)"
          htmlFor={`client-actions-${client.id}`}
        >
          <textarea
            id={`client-actions-${client.id}`}
            name="actions"
            className="min-h-24 w-full rounded-md border bg-transparent p-2 font-mono text-[9px]"
            defaultValue={client.actions.join("\n")}
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field
          label="Allowed source CIDRs (empty allows any source)"
          htmlFor={`client-cidrs-${client.id}`}
        >
          <textarea
            ref={cidrInputRef}
            id={`client-cidrs-${client.id}`}
            name="sourceCidrs"
            className="min-h-16 w-full rounded-md border bg-transparent p-2 font-mono text-[9px]"
            placeholder="203.0.113.8/32"
            defaultValue={client.sourceCidrs.join("\n")}
          />
        </Field>
        {observedCidr ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-1"
            onClick={() => {
              if (cidrInputRef.current)
                cidrInputRef.current.value = observedCidr
            }}
          >
            <ShieldCheck /> Restrict to observed {observedCidr}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="mt-2 text-[10px] text-destructive">{error}</p>
      ) : null}
      <Button
        type="submit"
        size="sm"
        className="mt-3"
        disabled={pending !== null}
      >
        {pending === "save" ? (
          <LoaderCircle className="animate-spin" />
        ) : (
          <Check />
        )}
        Save client policy
      </Button>
    </form>
  )
}

function splitLines(value: string): Array<string> {
  return [
    ...new Set(
      value
        .split(/[,\n]/u)
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ]
}

function clientPolicyKey(client: RelayClientAdministration): string {
  return [
    client.id,
    client.name,
    client.role,
    client.actions.join(","),
    client.sourceCidrs.join(","),
    client.lastAddress ?? "",
  ].join(":")
}

function exactAddressCidr(value: string): string {
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1]
  const address = mapped ?? value.split("%")[0] ?? value
  return `${address}/${address.includes(":") ? 128 : 32}`
}

function RelayProxyConfiguration({ relay }: { relay: PersistedRelay }) {
  const queryClient = useQueryClient()
  const queryKey = React.useMemo(
    () => ["relays", "proxy", relay.id] as const,
    [relay.id]
  )
  const query = useQuery({
    enabled: relay.enabled,
    queryFn: () => getRelayProxy({ data: { id: relay.id } }),
    queryKey,
    retry: false,
    staleTime: 10_000,
  })
  const update = useMutation({
    mutationFn: updateRelayProxy,
    onSuccess: (result) => queryClient.setQueryData(queryKey, result),
  })
  const [probe, setProbe] = React.useState<
    "checking" | "idle" | "reachable" | "unreachable"
  >("idle")
  const settings = query.data?.settings
  const diagnostics = query.data?.diagnostics

  async function verifyPublicEdge() {
    setProbe("checking")
    const origin =
      settings?.mode === "traefik"
        ? `https://${relay.hostname.includes(":") ? `[${relay.hostname}]` : relay.hostname}`
        : relay.browserOrigin
    try {
      const response = await fetch(new URL("/v1/trust", origin), {
        cache: "no-store",
        mode: "cors",
      })
      setProbe(response.ok ? "reachable" : "unreachable")
    } catch {
      setProbe("unreachable")
    }
  }

  return (
    <section className="mt-5 border-t pt-5">
      <div className="flex items-start gap-2">
        <Network className="mt-0.5 size-4 text-primary" />
        <div>
          <p className="text-xs font-semibold">Relay edge</p>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Choose how browsers reach high-volume Relay streams and files. Small
            control operations continue through Hearth in every mode.
          </p>
        </div>
      </div>

      {query.isPending ? (
        <div className="mt-3 flex items-center gap-2 border p-3 text-[10px] text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" /> Reading edge
          configuration…
        </div>
      ) : query.error ? (
        <p className="mt-3 border border-destructive/20 bg-destructive/5 p-3 text-[10px] text-destructive">
          {messageFrom(query.error, "Could not read Relay edge configuration")}
        </p>
      ) : settings && diagnostics ? (
        <form
          key={`${relay.id}:${settings.mode}:${settings.traefikImage}:${settings.acmeEmail ?? ""}`}
          className="mt-3 space-y-3 border border-border/70 bg-background/30 p-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Proxy mode" htmlFor={`relay-proxy-mode-${relay.id}`}>
              <select
                id={`relay-proxy-mode-${relay.id}`}
                name="mode"
                defaultValue={settings.mode}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-[10px]"
              >
                <option value="none">None / existing Traefik</option>
                <option value="hearth">Hearth proxy</option>
                <option value="traefik">Bundled Traefik</option>
              </select>
            </Field>
            <Field
              label="Pinned Traefik image"
              htmlFor={`traefik-image-${relay.id}`}
            >
              <Input
                id={`traefik-image-${relay.id}`}
                name="traefikImage"
                defaultValue={settings.traefikImage}
                required
              />
            </Field>
          </div>
          <Field
            label="ACME account email (recommended)"
            htmlFor={`acme-email-${relay.id}`}
          >
            <Input
              id={`acme-email-${relay.id}`}
              name="acmeEmail"
              type="email"
              defaultValue={settings.acmeEmail ?? ""}
              placeholder="admin@example.com"
            />
          </Field>

          <div
            className={`border px-3 py-2 text-[10px] leading-4 ${
              diagnostics.status === "blocked"
                ? "border-destructive/25 bg-destructive/5 text-destructive"
                : "border-border/70 text-muted-foreground"
            }`}
          >
            <p className="font-medium text-foreground">
              {diagnostics.status === "blocked"
                ? "Bundled Traefik is blocked"
                : diagnostics.mode === "traefik" && diagnostics.containerRunning
                  ? "kiln-traefik is running"
                  : diagnostics.mode === "hearth"
                    ? "Kiln traffic is routed through Hearth"
                    : "External/manual edge selected"}
            </p>
            <p className="mt-1">
              Ports 80 / 443:{" "}
              {diagnostics.ports
                .map(
                  (port) =>
                    `${port.port} ${port.owner === "kiln-traefik" ? "served by kiln-traefik" : port.available ? "available" : `used by ${port.owner ?? "another process"}`}`
                )
                .join(" · ")}
            </p>
            {diagnostics.warnings.map((warning) => (
              <p key={warning} className="mt-1">
                {warning}
              </p>
            ))}
            {probe === "unreachable" ? (
              <p className="mt-1 text-destructive">
                The browser cannot reach a trusted public Relay edge. Check DNS,
                NAT/firewall rules, and ACME issuance.
              </p>
            ) : probe === "reachable" ? (
              <p className="mt-1 text-emerald-300">
                This browser can reach and trust the Relay edge.
              </p>
            ) : null}
          </div>

          {update.error ? (
            <p className="text-[10px] text-destructive">
              {messageFrom(update.error, "Could not update Relay edge")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={update.isPending}
              onClick={(event) => {
                const formElement = event.currentTarget.form
                if (!formElement) return
                const form = new FormData(formElement)
                update.mutate({
                  data: {
                    acmeEmail:
                      String(form.get("acmeEmail") ?? "").trim() || null,
                    mode:
                      form.get("mode") === "traefik"
                        ? "traefik"
                        : form.get("mode") === "hearth"
                          ? "hearth"
                          : "none",
                    relayId: relay.id,
                    traefikImage: String(form.get("traefikImage") ?? ""),
                  },
                })
              }}
            >
              {update.isPending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Check />
              )}
              Save edge mode
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={probe === "checking"}
              onClick={() => void verifyPublicEdge()}
            >
              {probe === "checking" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              Test public access
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  )
}

function RelayBrowserTrust({ relay }: { relay: PersistedRelay }) {
  const proxy = useQuery({
    enabled: relay.enabled,
    queryFn: () => getRelayProxy({ data: { id: relay.id } }),
    queryKey: ["relays", "proxy", relay.id] as const,
    retry: false,
    staleTime: 10_000,
  })
  const proxyMode = proxy.data?.settings.mode ?? "none"
  const [state, setState] = React.useState<
    "idle" | "checking" | "trusted" | "untrusted"
  >("idle")
  const trustOrigin = React.useMemo(() => {
    if (proxyMode === "traefik") {
      return new URL(
        `https://${relay.hostname.includes(":") ? `[${relay.hostname}]` : relay.hostname}`
      )
    }
    const url = new URL(relay.browserOrigin)
    if (url.protocol === "wss:") url.protocol = "https:"
    if (url.protocol === "ws:") url.protocol = "http:"
    return url
  }, [proxyMode, relay.browserOrigin, relay.hostname])
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

  if (proxyMode === "hearth") {
    return (
      <div className="mt-5 rounded-lg border border-border/70 bg-background/30 p-3 text-left">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold">Browser transport</p>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              Direct Relay trust is not required in Hearth proxy mode. Console,
              resource, and supported file traffic stays on this trusted Hearth
              origin.
            </p>
          </div>
          <span className="font-mono text-[9px] text-emerald-300">
            HEARTH SECURED
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-5 rounded-lg border border-border/70 bg-background/30 p-3 text-left">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold">Browser trust</p>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            {proxyMode === "traefik"
              ? "Bundled Traefik must present a public ACME certificate on port 443."
              : `Required for direct console streams and file transfers on port ${relay.port}.`}
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
        {proxyMode === "traefik"
          ? "Traefik requests and renews the public certificate automatically after DNS points here and ports 80/443 are publicly reachable. No Relay CA installation is needed."
          : relay.managedTls
            ? "Install the Relay CA once on each device. Relay keeps that CA stable and renews its short-lived server certificate automatically."
            : "This Relay uses an external certificate. Its public CA or reverse proxy must already be trusted by this browser."}
      </p>
      {state === "untrusted" ? (
        <p className="mt-2 text-[10px] leading-4 text-destructive">
          {proxyMode === "traefik"
            ? "This browser could not reach a trusted Traefik edge. Check DNS, public ports 80/443, and ACME issuance, then verify again."
            : "This browser could not establish trusted HTTPS to the Relay. Install the CA or correct the external certificate, then verify again."}
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
        {proxyMode === "none" && relay.managedTls ? (
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
    previous.relay.enabled === next.relay.enabled &&
    previous.relay.lastError === next.relay.lastError &&
    previous.relay.browserOrigin === next.relay.browserOrigin &&
    previous.relay.managedTls === next.relay.managedTls
  )
}

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
