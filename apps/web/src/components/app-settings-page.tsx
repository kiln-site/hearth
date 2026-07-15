import * as React from "react"
import { Link } from "@tanstack/react-router"
import {
  Check,
  CircleAlert,
  Copy,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  PlugZap,
  RefreshCw,
  ServerCog,
  Trash2,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import { GlobalPageToolbar } from "@/components/global-page-toolbar"
import {
  addRelay,
  checkRelay,
  getRelays,
  removeRelay,
  selectRelay,
} from "@/server/relays"

type Relay = Awaited<ReturnType<typeof getRelays>>[number]

export function AppSettingsPage({
  initialRelays,
}: {
  initialRelays: Array<Relay>
}) {
  const [relays, setRelays] = React.useState(initialRelays)
  const [pending, setPending] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [form, setForm] = React.useState({
    name: "",
    hostname: "",
    port: "4100",
    token: "",
    useTls: false,
  })
  const [copied, setCopied] = React.useState(false)

  async function refresh() {
    setRelays(await getRelays())
  }

  async function createRelay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending("add")
    setError(null)
    try {
      await addRelay({
        data: {
          name: form.name,
          hostname: form.hostname,
          port: Number(form.port),
          token: form.token,
          useTls: form.useTls,
        },
      })
      setForm({
        name: "",
        hostname: "",
        port: "4100",
        token: "",
        useTls: false,
      })
      await refresh()
    } catch (cause) {
      setError(messageFrom(cause, "Could not save Relay"))
    } finally {
      setPending(null)
    }
  }

  async function act(id: string, action: "check" | "select" | "remove") {
    setPending(`${action}:${id}`)
    setError(null)
    try {
      if (action === "check") await checkRelay({ data: { id } })
      if (action === "select") await selectRelay({ data: { id } })
      if (action === "remove") await removeRelay({ data: { id } })
      await refresh()
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
              Relay endpoints are stored in MySQL and survive app restarts.
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

        <div className="mt-7 grid gap-5 lg:grid-cols-[1fr_20rem]">
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
                        {new Date(relay.lastConnectedAt).toLocaleString()}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!relay.isPrimary ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void act(relay.id, "select")}
                        disabled={pending !== null}
                      >
                        <PlugZap /> Use Relay
                      </Button>
                    ) : null}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      title="Check connection"
                      onClick={() => void act(relay.id, "check")}
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
                        onClick={() => void act(relay.id, "remove")}
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

          <section className="rounded-xl border bg-card/45 p-4">
            <div className="flex items-center gap-2">
              <PlugZap className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">Add a Relay</h2>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              Generate a one-time enrollment key, start Relay with it, then
              enter the node endpoint.
            </p>
            <form className="mt-5 space-y-3" onSubmit={createRelay}>
              <Field label="Enrollment key">
                <div className="flex gap-1.5">
                  <Input
                    value={form.token}
                    readOnly
                    placeholder="Generate a key"
                    className="font-mono text-[10px]"
                    required
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    title={
                      form.token
                        ? "Copy enrollment key"
                        : "Generate enrollment key"
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
                  Start the Relay image with this value as KILN_RELAY_KEY, then
                  save its reachable address below.
                </div>
              ) : null}
              <Field label="Name">
                <Input
                  value={form.name}
                  onChange={(event) =>
                    setForm((value) => ({ ...value, name: event.target.value }))
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
                    setForm((value) => ({ ...value, port: event.target.value }))
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
                    setForm((value) => ({
                      ...value,
                      useTls: event.target.checked,
                    }))
                  }
                  className="accent-primary"
                />
                Connect with HTTPS
              </label>
              <Button className="w-full" disabled={pending !== null}>
                {pending === "add" ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Check />
                )}
                Save Relay
              </Button>
            </form>
          </section>
        </div>
      </div>
    </main>
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
