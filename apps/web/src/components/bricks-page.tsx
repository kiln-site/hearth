import * as React from "react"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  Boxes,
  Check,
  ChevronRight,
  CircleAlert,
  Cpu,
  Gauge,
  LoaderCircle,
  Network,
  Plus,
  RadioTower,
  Server,
} from "lucide-react"
import type {
  Brick,
  RelayInstance,
  RelayNetworking,
} from "@workspace/contracts"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import { GlobalPageToolbar } from "@/components/global-page-toolbar"
import { ServerTypeIcon } from "@/components/server-type-icon"
import type { PersistedRelay } from "@/lib/relay-registry"
import { brickStudioQueryOptions, queryKeys } from "@/lib/query-options"
import { configureBrickNetworking, createBrickInstance } from "@/server/bricks"

type Studio = {
  relays: Array<PersistedRelay>
  relayId: string | null
  bricks: Array<Brick>
  instances: Array<RelayInstance>
  networking: RelayNetworking | null
}

export function BricksPage() {
  const queryClient = useQueryClient()
  const { data: studio } = useSuspenseQuery(brickStudioQueryOptions())
  const createInstanceMutation = useMutation({
    mutationFn: createBrickInstance,
  })
  const configureNetworkingMutation = useMutation({
    mutationFn: configureBrickNetworking,
  })
  const [selected, setSelected] = React.useState<Brick | null>(
    studio.bricks.at(0) ?? null
  )
  const [pending, setPending] = React.useState<"deploy" | "network" | null>(
    null
  )
  const [error, setError] = React.useState<string | null>(null)
  const [networkSaved, setNetworkSaved] = React.useState(false)
  const [form, setForm] = React.useState({
    memory: selected?.defaultMemory ?? "2G",
    name: selected ? `${selected.name} ${selected.defaultVersion}` : "",
    relayId: studio.relayId ?? "",
    start: true,
    version: selected?.defaultVersion ?? "",
  })
  const [networking, setNetworking] = React.useState({
    enabled: studio.networking?.enabled ?? false,
    domain: studio.networking?.domain ?? "test",
    address: studio.networking?.address ?? "",
    dnsPort: String(studio.networking?.dnsPort ?? 53),
    proxyPort: String(studio.networking?.proxyPort ?? 25_565),
  })

  function chooseBrick(brick: Brick) {
    setSelected(brick)
    setForm((current) => ({
      ...current,
      memory: brick.defaultMemory,
      name: `${brick.name} ${brick.defaultVersion}`,
      version: brick.defaultVersion,
    }))
    setError(null)
  }

  async function deploy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    setPending("deploy")
    setError(null)
    try {
      const instance = await createInstanceMutation.mutateAsync({
        data: {
          brickId: selected.id,
          memory: form.memory,
          name: form.name,
          relayId: form.relayId,
          start: form.start,
          version: form.version,
        },
      })
      window.location.assign(`/${instance.shortId}/console`)
    } catch (cause) {
      setError(messageFrom(cause, "Could not deploy Brick"))
      setPending(null)
    }
  }

  async function saveNetworking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending("network")
    setNetworkSaved(false)
    setError(null)
    try {
      const saved = await configureNetworkingMutation.mutateAsync({
        data: {
          relayId: form.relayId,
          enabled: networking.enabled,
          domain: networking.domain,
          address: networking.address,
          dnsPort: Number(networking.dnsPort),
          proxyPort: Number(networking.proxyPort),
        },
      })
      queryClient.setQueryData<Studio>(queryKeys.bricks, (current) =>
        current ? { ...current, networking: saved } : current
      )
      setNetworkSaved(true)
      window.setTimeout(() => setNetworkSaved(false), 2_000)
    } catch (cause) {
      setError(messageFrom(cause, "Could not configure node networking"))
    } finally {
      setPending(null)
    }
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <GlobalPageToolbar label="Infrastructure / Bricks" />

      <div className="mx-auto max-w-7xl px-5 py-9 lg:px-8">
        <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_23rem]">
          <div className="min-w-0">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <div className="mb-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] text-primary uppercase">
                  <span className="size-1.5 rounded-full bg-primary shadow-[0_0_12px_var(--primary)]" />
                  Official catalog
                </div>
                <h1 className="font-heading text-4xl font-semibold tracking-[-0.055em]">
                  Fire a new Brick.
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  Reproducible game runtimes, provisioned and owned by Relay. No
                  Compose service or per-instance daemon required.
                </p>
              </div>
              <div className="flex gap-5 border-l border-border/70 pl-5 text-[10px] text-muted-foreground">
                <Metric
                  value={String(studio.bricks.length)}
                  label="Brick types"
                />
                <Metric
                  value={String(studio.instances.length)}
                  label="Instances"
                />
              </div>
            </div>

            {error ? (
              <div className="mt-6 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-xs text-destructive">
                <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
              </div>
            ) : null}

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {studio.bricks.map((brick, index) => {
                const active = selected?.id === brick.id
                return (
                  <button
                    key={brick.id}
                    type="button"
                    onClick={() => chooseBrick(brick)}
                    className={`group relative min-h-44 overflow-hidden rounded-2xl border p-5 text-left transition-[color,background-color,border-color,box-shadow,transform] duration-200 outline-none focus-visible:border-ring/70 focus-visible:ring-2 focus-visible:ring-ring/35 ${
                      active
                        ? "border-primary/55 bg-primary/[0.07] shadow-[0_0_0_1px_color-mix(in_oklch,var(--primary)_18%,transparent)]"
                        : "border-border/75 bg-card/35 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-accent/25"
                    }`}
                  >
                    <span className="absolute top-4 right-4 font-mono text-[9px] text-muted-foreground/60">
                      0{index + 1}
                    </span>
                    <div
                      className={`grid size-10 place-items-center rounded-xl border ${active ? "border-primary/30 bg-primary/12 text-primary" : "border-border bg-background/70 text-muted-foreground"}`}
                    >
                      <ServerTypeIcon
                        implementation={brick.id}
                        className="size-5"
                      />
                    </div>
                    <h2 className="mt-5 font-heading text-xl font-semibold tracking-[-0.035em]">
                      {brick.name}
                    </h2>
                    <p className="mt-1.5 max-w-sm text-[11px] leading-5 text-muted-foreground">
                      {brick.description}
                    </p>
                    <div className="mt-4 flex items-center gap-2 font-mono text-[9px] text-muted-foreground/75">
                      <span>{brickRuntime(brick)}</span>
                      <span className="text-border">/</span>
                      <span>{brick.defaultMemory}</span>
                      {brick.id === "palworld" ? (
                        <>
                          <span className="text-border">/</span>
                          <span>UDP 8211</span>
                        </>
                      ) : null}
                      <ChevronRight
                        className={`ml-auto size-3.5 transition-transform ${active ? "translate-x-0 text-primary" : "-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"}`}
                      />
                    </div>
                  </button>
                )
              })}
            </div>

            <section className="mt-8 overflow-hidden rounded-2xl border border-border/75 bg-card/35">
              <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
                <div className="flex items-center gap-3">
                  <Boxes className="size-4 text-primary" />
                  <div>
                    <h2 className="text-sm font-semibold">
                      Relay-owned instances
                    </h2>
                    <p className="text-[10px] text-muted-foreground">
                      Docker is the runtime manifest; data survives in Relay
                      storage.
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className="font-mono text-[9px]">
                  {studio.instances.length} total
                </Badge>
              </div>
              <div className="divide-y divide-border/60">
                {studio.instances.length ? (
                  studio.instances.slice(0, 6).map((instance) => (
                    <Link
                      key={instance.id}
                      to="/$serverId/console"
                      params={{ serverId: instance.shortId }}
                      className="flex items-center gap-3 px-5 py-3 transition-colors outline-none hover:bg-accent/35 focus-visible:bg-accent/45 focus-visible:ring-1 focus-visible:ring-ring/35 focus-visible:ring-inset"
                    >
                      <ServerTypeIcon
                        implementation={instance.implementation}
                        className="size-4 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">
                          {instance.name}
                        </span>
                        <span className="block truncate font-mono text-[9px] text-muted-foreground">
                          {instance.implementation} {instance.version} ·{" "}
                          {instance.shortId}
                        </span>
                      </span>
                      <span
                        className={`size-1.5 rounded-full ${instance.observedState === "running" ? "bg-emerald-400" : "bg-muted-foreground/35"}`}
                      />
                    </Link>
                  ))
                ) : (
                  <div className="px-5 py-9 text-center text-xs text-muted-foreground">
                    No Bricks have been deployed on this Relay.
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            <section className="rounded-2xl border border-border/80 bg-card/55 p-5 shadow-2xl shadow-black/10">
              <div className="flex items-center gap-2">
                <Plus className="size-4 text-primary" />
                <h2 className="text-sm font-semibold">
                  Deploy {selected?.name ?? "Brick"}
                </h2>
              </div>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                Relay creates the volume, labels, network attachment, and
                container.
              </p>
              {selected?.id === "palworld" ? (
                <div className="mt-4 rounded-lg border border-primary/20 bg-primary/[0.06] px-3 py-2.5">
                  <p className="font-mono text-[9px] tracking-[0.12em] text-primary uppercase">
                    Native Linux · AMD64 only
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                    Tracks the latest Steam build, listens on UDP 8211, and
                    needs at least 16 GB RAM. One Palworld server can run per
                    Relay.
                  </p>
                </div>
              ) : null}
              <form className="mt-5 space-y-3.5" onSubmit={deploy}>
                <Field label="Relay">
                  <select
                    value={form.relayId}
                    onChange={(event) =>
                      setForm((value) => ({
                        ...value,
                        relayId: event.target.value,
                      }))
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-ring"
                    required
                  >
                    {studio.relays.map((relay) => (
                      <option key={relay.id} value={relay.id}>
                        {relay.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Display name">
                  <Input
                    value={form.name}
                    onChange={(event) =>
                      setForm((value) => ({
                        ...value,
                        name: event.target.value,
                      }))
                    }
                    maxLength={120}
                    placeholder="Survival SMP"
                    required
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Version">
                    <Input
                      value={form.version}
                      onChange={(event) =>
                        setForm((value) => ({
                          ...value,
                          version: event.target.value,
                        }))
                      }
                      placeholder="1.21.11"
                      readOnly={selected?.id === "palworld"}
                      required
                    />
                  </Field>
                  <Field
                    label={selected?.id === "palworld" ? "Memory" : "Max heap"}
                  >
                    <Input
                      value={form.memory}
                      onChange={(event) =>
                        setForm((value) => ({
                          ...value,
                          memory: event.target.value.toUpperCase(),
                        }))
                      }
                      pattern="[0-9]+[MG]"
                      placeholder="2G"
                      required
                    />
                  </Field>
                </div>
                <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border/75 bg-background/45 px-3 py-2.5 text-xs">
                  <span>
                    <span className="block font-medium">
                      Start after provisioning
                    </span>
                    <span className="mt-0.5 block text-[9px] text-muted-foreground">
                      Download happens on first boot.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={form.start}
                    onChange={(event) =>
                      setForm((value) => ({
                        ...value,
                        start: event.target.checked,
                      }))
                    }
                    className="accent-primary"
                  />
                </label>
                <Button
                  className="h-11 w-full"
                  disabled={!selected || pending !== null || !form.relayId}
                >
                  {pending === "deploy" ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Plus />
                  )}
                  Deploy Brick
                </Button>
              </form>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/60 pt-4 text-center">
                <TinyStat
                  icon={Cpu}
                  label={selected?.id === "palworld" ? "1 process" : "1 JVM"}
                />
                <TinyStat icon={Gauge} label="No sidecar" />
                <TinyStat icon={Server} label="1 volume" />
              </div>
            </section>

            <section className="rounded-2xl border border-border/80 bg-card/35 p-5">
              <div className="flex items-center gap-2">
                <RadioTower className="size-4 text-primary" />
                <h2 className="text-sm font-semibold">Tailnet routing</h2>
              </div>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                Relay owns node DNS, private game networking, and the Minecraft
                entrypoint.
              </p>
              <form className="mt-4 space-y-3" onSubmit={saveNetworking}>
                <label className="flex items-center justify-between text-xs">
                  <span>Enable node networking</span>
                  <input
                    type="checkbox"
                    checked={networking.enabled}
                    onChange={(event) =>
                      setNetworking((value) => ({
                        ...value,
                        enabled: event.target.checked,
                      }))
                    }
                    className="accent-primary"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="DNS domain">
                    <Input
                      value={networking.domain}
                      onChange={(event) =>
                        setNetworking((value) => ({
                          ...value,
                          domain: event.target.value.toLowerCase(),
                        }))
                      }
                      placeholder="test"
                      required
                    />
                  </Field>
                  <Field label="Node address">
                    <Input
                      value={networking.address}
                      onChange={(event) =>
                        setNetworking((value) => ({
                          ...value,
                          address: event.target.value,
                        }))
                      }
                      placeholder="100.64.0.10"
                      required
                    />
                  </Field>
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  className="w-full"
                  disabled={pending !== null || !form.relayId}
                >
                  {pending === "network" ? (
                    <LoaderCircle className="animate-spin" />
                  ) : networkSaved ? (
                    <Check />
                  ) : (
                    <Network />
                  )}
                  {networkSaved ? "Networking saved" : "Apply networking"}
                </Button>
              </form>
            </section>
          </aside>
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

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <span>
      <strong className="block font-mono text-lg font-medium text-foreground">
        {value}
      </strong>
      <span>{label}</span>
    </span>
  )
}

function TinyStat({ icon: Icon, label }: { icon: typeof Cpu; label: string }) {
  return (
    <span className="text-[9px] text-muted-foreground">
      <Icon className="mx-auto mb-1 size-3.5" />
      {label}
    </span>
  )
}

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

function brickRuntime(brick: Brick): string {
  return brick.id === "palworld" ? "STEAMCMD" : `JAVA ${brick.javaVersion}`
}
