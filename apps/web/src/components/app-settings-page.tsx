import * as React from "react"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  Copy,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  PlugZap,
  RadioTower,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Trash2,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import { GlobalPageToolbar } from "@/components/global-page-toolbar"
import { queryKeys, relaysQueryOptions } from "@/lib/query-options"
import type { PersistedRelay } from "@/lib/relay-registry"
import { addRelay, checkRelay, removeRelay, selectRelay } from "@/server/relays"

type RelayForm = {
  name: string
  hostname: string
  port: string
  token: string
  useTls: boolean
}

type RelayAction = (
  id: string,
  action: "check" | "select" | "remove"
) => Promise<void>

const relayConnectedFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
})

export function AppSettingsPage() {
  const queryClient = useQueryClient()
  const { data: relays } = useSuspenseQuery(relaysQueryOptions())
  const checkRelayMutation = useMutation({
    mutationFn: checkRelay,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.relays }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.relay.connection,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.access.capabilities,
        }),
      ]),
  })
  const removeRelayMutation = useMutation({
    mutationFn: removeRelay,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.relays }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.relay.connection,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.access.capabilities,
        }),
      ]),
  })
  const selectRelayMutation = useMutation({
    mutationFn: selectRelay,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.relays }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.relay.connection,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.access.capabilities,
        }),
      ]),
  })
  const [pending, setPending] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  async function act(id: string, action: "check" | "select" | "remove") {
    setPending(`${action}:${id}`)
    setError(null)
    setNotice(null)
    try {
      if (action === "check")
        await checkRelayMutation.mutateAsync({ data: { id } })
      if (action === "select")
        await selectRelayMutation.mutateAsync({ data: { id } })
      if (action === "remove")
        await removeRelayMutation.mutateAsync({ data: { id } })
      if (action === "check") setNotice("Relay connection check completed.")
      if (action === "select") window.location.assign("/")
    } catch (cause) {
      setError(messageFrom(cause, `Could not ${action} Relay`))
    } finally {
      setPending(null)
    }
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-background">
      <GlobalPageToolbar label="Infrastructure / Relays" />

      <div className="mx-auto max-w-5xl px-5 py-10">
        <p className="font-mono text-[10px] tracking-[0.18em] text-primary uppercase">
          Application settings
        </p>
        <div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-[-0.04em]">
              Relay connections
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Connect Hearth to one or more independently deployed Relay nodes.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/security">
              <Fingerprint /> Account security
            </Link>
          </Button>
        </div>

        {error ? (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
          </div>
        ) : null}
        {notice ? (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/7 px-3 py-2 text-xs text-foreground">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {notice}
          </div>
        ) : null}

        {relays.length === 0 ? (
          <section className="relative mt-7 overflow-hidden rounded-xl border border-primary/20 bg-card/55 p-5 sm:p-6">
            <div className="absolute inset-y-0 left-0 w-0.5 bg-primary" />
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <div className="grid size-10 shrink-0 place-items-center border border-primary/25 bg-primary/8 text-primary">
                  <RadioTower className="size-4" />
                </div>
                <div>
                  <p className="font-mono text-[9px] tracking-[0.16em] text-primary uppercase">
                    First-run infrastructure
                  </p>
                  <h2 className="mt-1 font-heading text-lg font-semibold">
                    Hearth is ready for its first Relay
                  </h2>
                  <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                    Relay can run on a different node. Configure the same access
                    key on both sides, then enter an address reachable from this
                    Hearth container.
                  </p>
                </div>
              </div>
              <span className="shrink-0 font-mono text-[9px] text-amber-400 uppercase">
                0 nodes connected
              </span>
            </div>
          </section>
        ) : null}

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_21rem]">
          <RelayList relays={relays} pending={pending} onAction={act} />
          <AddRelaySection onError={setError} onNotice={setNotice} />
        </div>
      </div>
    </main>
  )
}

function RelayList({
  relays,
  pending,
  onAction,
}: {
  relays: Array<PersistedRelay>
  pending: string | null
  onAction: RelayAction
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card/45">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <ServerCog className="size-4 text-primary" />
        <div>
          <h2 className="text-sm font-semibold">Known Relays</h2>
          <p className="text-[10px] text-muted-foreground">
            One Relay is active for the current control surface.
          </p>
        </div>
      </div>
      <div className="divide-y">
        {relays.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <ServerCog className="mx-auto size-5 text-muted-foreground/45" />
            <p className="mt-3 text-xs font-semibold">No saved Relays</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Use the enrollment form to add the first node.
            </p>
          </div>
        ) : null}
        {relays.map((relay) => (
          <div
            key={relay.id}
            className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center"
          >
            <span
              className={`size-2 shrink-0 rounded-full ${relay.lastError ? "bg-destructive" : relay.lastConnectedAt ? "bg-emerald-400" : "bg-muted-foreground/30"}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-xs font-semibold">
                  {relay.name}
                </span>
                {relay.isPrimary ? (
                  <span className="rounded border border-primary/25 bg-primary/8 px-1.5 py-0.5 font-mono text-[8px] text-primary uppercase">
                    Active
                  </span>
                ) : null}
              </div>
              <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                {relay.useTls ? "https" : "http"}://{relay.hostname}:
                {relay.port}
              </p>
              {relay.lastError ? (
                <p className="mt-1 truncate text-[10px] text-destructive/85">
                  {relay.lastError}
                </p>
              ) : relay.lastConnectedAt ? (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Connected{" "}
                  {relayConnectedFormatter.format(
                    new Date(relay.lastConnectedAt)
                  )}{" "}
                  UTC
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              {!relay.isPrimary ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void onAction(relay.id, "select")}
                  disabled={pending !== null}
                >
                  <PlugZap /> Use Relay
                </Button>
              ) : null}
              <Button
                size="icon-sm"
                variant="ghost"
                title="Check connection"
                onClick={() => void onAction(relay.id, "check")}
                disabled={pending !== null}
              >
                {pending === `check:${relay.id}` ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
              </Button>
              {!relay.isPrimary ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Remove Relay"
                  onClick={() => void onAction(relay.id, "remove")}
                  disabled={pending !== null}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function AddRelaySection({
  onError,
  onNotice,
}: {
  onError: (error: string | null) => void
  onNotice: (notice: string | null) => void
}) {
  const queryClient = useQueryClient()
  const addRelayMutation = useMutation({
    mutationFn: addRelay,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.relays }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.relay.connection,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.access.capabilities,
        }),
      ]),
  })
  const [form, setForm] = React.useState<RelayForm>({
    name: "",
    hostname: "",
    port: "4100",
    token: "",
    useTls: false,
  })
  const [copied, setCopied] = React.useState(false)

  async function createRelay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onError(null)
    onNotice(null)
    try {
      const created = await addRelayMutation.mutateAsync({
        data: {
          name: form.name,
          hostname: form.hostname,
          port: Number(form.port),
          token: form.token,
          useTls: form.useTls,
        },
      })
      onNotice(
        created.lastError
          ? `${created.name} was saved, but the first connection check failed.`
          : `${created.name} is connected and ready.`
      )
      setForm({
        name: "",
        hostname: "",
        port: "4100",
        token: "",
        useTls: false,
      })
    } catch (cause) {
      onError(messageFrom(cause, "Could not save Relay"))
    }
  }

  return (
    <section className="rounded-xl border bg-card/45 p-4">
      <div className="flex items-center gap-2">
        <PlugZap className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Add a Relay</h2>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
        Paste the key already configured on Relay, or generate a new shared key,
        then save the node endpoint.
      </p>
      <form
        className="mt-5 space-y-3"
        onSubmit={(event) => void createRelay(event)}
      >
        <Field label="Relay access key">
          <div className="flex gap-1.5">
            <Input
              value={form.token}
              onChange={(event) => {
                setCopied(false)
                setForm((value) => ({
                  ...value,
                  token: event.target.value,
                }))
              }}
              placeholder="Paste or generate access key"
              className="font-mono text-[10px]"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              minLength={32}
              maxLength={512}
              required
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              title={
                form.token
                  ? "Copy Relay access key"
                  : "Generate Relay access key"
              }
              onClick={() => {
                if (!form.token) {
                  setForm((value) => ({
                    ...value,
                    token: generateRelayKey(),
                  }))
                  return
                }
                void navigator.clipboard.writeText(form.token)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1_500)
              }}
            >
              {form.token ? copied ? <Check /> : <Copy /> : <KeyRound />}
            </Button>
          </div>
        </Field>
        {form.token ? (
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 font-mono text-[9px] leading-4 text-muted-foreground">
            Start the Relay image with this value as KILN_RELAY_KEY, then save
            its reachable address below. Hearth stores the key encrypted and
            never displays it again.
          </div>
        ) : null}
        <Field label="Name">
          <Input
            value={form.name}
            onChange={(event) =>
              setForm((value) => ({
                ...value,
                name: event.target.value,
              }))
            }
            placeholder="Production node"
            required
          />
        </Field>
        <Field label="Hostname">
          <Input
            value={form.hostname}
            onChange={(event) =>
              setForm((value) => ({
                ...value,
                hostname: event.target.value,
              }))
            }
            placeholder="relay.example.com"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </Field>
        <Field label="Port">
          <Input
            value={form.port}
            onChange={(event) =>
              setForm((value) => ({
                ...value,
                port: event.target.value,
              }))
            }
            type="number"
            min={1}
            max={65535}
            required
          />
        </Field>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={form.useTls}
            onChange={(event) =>
              setForm((value) => {
                const useTls = event.target.checked
                return {
                  ...value,
                  useTls,
                  port:
                    useTls && value.port === "4100"
                      ? "443"
                      : !useTls && value.port === "443"
                        ? "4100"
                        : value.port,
                }
              })
            }
            className="accent-primary"
          />
          Connect with HTTPS
        </label>
        <p className="text-[9px] leading-4 text-muted-foreground">
          Behind a reverse proxy, use HTTPS on public port 443. The proxy
          forwards traffic to Relay on its internal port, normally 4100.
        </p>
        <Button className="w-full" disabled={addRelayMutation.isPending}>
          {addRelayMutation.isPending ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <Check />
          )}
          Save Relay
        </Button>
      </form>

      <div className="mt-5 space-y-3 border-t pt-4">
        <RelayHint
          icon={ArrowUpRight}
          title="Hearth must reach it"
          detail="Use DNS or an IP visible from this container. localhost points back to Hearth."
        />
        <RelayHint
          icon={ShieldCheck}
          title="Protect the route"
          detail="Use HTTPS or a private network when Relay lives on another machine."
        />
      </div>
    </section>
  )
}

function RelayHint({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof ArrowUpRight
  title: string
  detail: string
}) {
  return (
    <div className="flex gap-2.5">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-primary" />
      <span>
        <span className="block text-[10px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">
          {detail}
        </span>
      </span>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1.5 text-[10px] font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  )
}

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

function generateRelayKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(48))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "")
}
