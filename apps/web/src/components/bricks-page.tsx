import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  Boxes,
  Check,
  ChevronRight,
  CircleAlert,
  Cpu,
  FileCode2,
  Gauge,
  LoaderCircle,
  Network,
  PackagePlus,
  Plus,
  RadioTower,
  Server,
} from "lucide-react"
import type {
  Brick,
  BrickVariable,
  BrickVariableValue,
  RelayInstance,
  RelayNetworking,
} from "@workspace/contracts"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import { GlobalPageToolbar } from "@/components/global-page-toolbar"
import { ServerTypeIcon } from "@/components/server-type-icon"
import { updateBrickVariable } from "@/lib/brick-variables"
import type { PersistedRelay } from "@/lib/relay-registry"
import {
  brickStudioQueryOptions,
  queryKeys,
  relayConnectionQueryOptions,
} from "@/lib/query-options"
import type { RelayConnection } from "@/lib/query-options"
import {
  configureBrickNetworking,
  createBrickInstance,
  loadBrickRecipe,
} from "@/server/bricks"

type Studio = {
  relays: Array<PersistedRelay>
  relayId: string | null
  bricks: Array<Brick>
  instances: Array<RelayInstance>
  networking: RelayNetworking | null
}

type PendingAction = "deploy" | "network" | "recipe" | null

type DeploymentForm = {
  name: string
  relayId: string
  start: boolean
}

export function BricksPage() {
  const studioQuery = useQuery(brickStudioQueryOptions())
  if (!studioQuery.data) {
    return (
      <main className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
        <GlobalPageToolbar label="Infrastructure / Bricks" />
        <div className="grid min-h-[24rem] place-items-center px-6 text-center">
          <div className="max-w-sm">
            {studioQuery.isPending ? (
              <LoaderCircle className="mx-auto size-5 animate-spin text-primary" />
            ) : (
              <CircleAlert className="mx-auto size-5 text-amber-300" />
            )}
            <p className="mt-3 text-sm font-semibold">
              {studioQuery.isPending
                ? "Loading Brick studio"
                : "Brick studio unavailable"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {studioQuery.error?.message ??
                "Hearth has no cached Brick catalog for this Relay yet."}
            </p>
          </div>
        </div>
      </main>
    )
  }
  return <BrickStudio studio={studioQuery.data} />
}

function BrickStudio({ studio }: { studio: Studio }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const createInstanceMutation = useMutation({
    mutationFn: createBrickInstance,
    onSuccess: async (instance) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.bricks }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.relay.connection,
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.relay.snapshot }),
      ])
      await navigate({
        to: "/$serverId/console",
        params: { serverId: instance.shortId },
      })
    },
  })
  const configureNetworkingMutation = useMutation({
    mutationFn: configureBrickNetworking,
    onSuccess: (saved) => {
      queryClient.setQueryData<Studio>(queryKeys.bricks, (current) =>
        current ? { ...current, networking: saved } : current
      )
    },
  })
  const [selected, setSelected] = React.useState<Brick | null>(
    () => studio.bricks.at(0) ?? null
  )
  const [pending, setPending] = React.useState<PendingAction>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [networkSaved, setNetworkSaved] = React.useState(false)
  const [customSource, setCustomSource] = React.useState("")
  const [variables, setVariables] = React.useState<
    Record<string, BrickVariableValue>
  >(selected ? defaultVariables(selected) : {})
  const [form, setForm] = React.useState({
    name: selected ? defaultInstanceName(selected) : "",
    relayId: studio.relayId ?? "",
    start: true,
  })
  const [networking, setNetworking] = React.useState({
    enabled: studio.networking?.enabled ?? false,
    domain: studio.networking?.domain ?? "test",
    address: studio.networking?.address ?? "",
    dnsPort: String(studio.networking?.dnsPort ?? 53),
    proxyPort: String(studio.networking?.proxyPort ?? 25_565),
  })
  const selectRelayConnected = React.useCallback(
    (connection: RelayConnection) =>
      connection.status === "connected" &&
      connection.relays.some(
        (relay) => relay.id === form.relayId && relay.status === "connected"
      ),
    [form.relayId]
  )
  const { data: relayConnected = false } = useQuery({
    ...relayConnectionQueryOptions(queryClient),
    select: selectRelayConnected,
  })

  function chooseBrick(brick: Brick) {
    setSelected(brick)
    setVariables(defaultVariables(brick))
    setForm((current) => ({
      ...current,
      name: defaultInstanceName(brick),
    }))
    setError(null)
  }

  async function loadCustomRecipe(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending("recipe")
    setError(null)
    try {
      const loaded = await loadBrickRecipe({
        data: { relayId: form.relayId, source: customSource },
      })
      chooseBrick(loaded)
    } catch (cause) {
      setError(messageFrom(cause, "Could not load Brick recipe"))
    } finally {
      setPending(null)
    }
  }

  async function deploy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    setPending("deploy")
    setError(null)
    try {
      await createInstanceMutation.mutateAsync({
        data: {
          name: form.name,
          recipe: selected.source,
          relayId: form.relayId,
          start: form.start,
          variables,
        },
      })
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
      await configureNetworkingMutation.mutateAsync({
        data: {
          relayId: form.relayId,
          enabled: networking.enabled,
          domain: networking.domain,
          address: networking.address,
          dnsPort: Number(networking.dnsPort),
          proxyPort: Number(networking.proxyPort),
        },
      })
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

      <fieldset
        disabled={!relayConnected}
        className="mx-auto block max-w-7xl border-0 px-5 py-9 lg:px-8"
      >
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
                  Versioned recipes pair reusable Embers with deployment-time
                  configuration. Relay can run any v1 recipe without an update.
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

            <CustomRecipeForm
              source={customSource}
              relayId={form.relayId}
              pending={pending}
              onSourceChange={setCustomSource}
              onSubmit={loadCustomRecipe}
            />

            <BrickPicker
              bricks={studio.bricks}
              selected={selected}
              onSelect={chooseBrick}
            />

            <RelayInstanceList instances={studio.instances} />
          </div>

          <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            <BrickDeploymentForm
              selected={selected}
              relays={studio.relays}
              form={form}
              variables={variables}
              pending={pending}
              onFormChange={setForm}
              onVariablesChange={setVariables}
              onSubmit={deploy}
            />

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
      </fieldset>
    </main>
  )
}

function CustomRecipeForm({
  source,
  relayId,
  pending,
  onSourceChange,
  onSubmit,
}: {
  source: string
  relayId: string
  pending: PendingAction
  onSourceChange: (source: string) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="mt-7 flex flex-col gap-2 rounded-2xl border border-dashed border-primary/25 bg-primary/[0.035] p-3 sm:flex-row sm:items-end"
    >
      <Field label="Custom HTTPS recipe">
        <Input
          type="url"
          value={source}
          onChange={(event) => onSourceChange(event.target.value)}
          placeholder="https://example.com/my-brick.yml"
          className="sm:min-w-96"
          required
        />
      </Field>
      <Button
        type="submit"
        variant="outline"
        disabled={pending !== null || !relayId}
      >
        {pending === "recipe" ? (
          <LoaderCircle className="animate-spin" />
        ) : (
          <PackagePlus />
        )}
        Load recipe
      </Button>
      <p className="pb-1 text-[9px] leading-4 text-muted-foreground sm:ml-auto sm:max-w-48">
        Recipes select executable images. Load only sources you trust.
      </p>
    </form>
  )
}

function BrickPicker({
  bricks,
  selected,
  onSelect,
}: {
  bricks: Array<Brick>
  selected: Brick | null
  onSelect: (brick: Brick) => void
}) {
  return (
    <div className="mt-8 grid gap-3 sm:grid-cols-2">
      {bricks.map((brick, index) => {
        const active = selected?.source === brick.source
        return (
          <button
            key={brick.source}
            type="button"
            onClick={() => onSelect(brick)}
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
                implementation={brick.metadata.id}
                className="size-5"
              />
            </div>
            <h2 className="mt-5 font-heading text-xl font-semibold tracking-[-0.035em]">
              {brick.metadata.name}
            </h2>
            <p className="mt-1.5 max-w-sm text-[11px] leading-5 text-muted-foreground">
              {brick.metadata.description}
            </p>
            <div className="mt-4 flex items-center gap-2 font-mono text-[9px] text-muted-foreground/75">
              <span>{brickRuntime(brick)}</span>
              <span className="text-border">/</span>
              <span>{defaultMemory(brick)}</span>
              <span className="text-border">/</span>
              <span>{primaryPort(brick)}</span>
              <ChevronRight
                className={`ml-auto size-3.5 transition-transform ${active ? "translate-x-0 text-primary" : "-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"}`}
              />
            </div>
          </button>
        )
      })}
    </div>
  )
}

function RelayInstanceList({ instances }: { instances: Array<RelayInstance> }) {
  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-border/75 bg-card/35">
      <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
        <div className="flex items-center gap-3">
          <Boxes className="size-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Relay-owned instances</h2>
            <p className="text-[10px] text-muted-foreground">
              Docker is the runtime manifest; data survives in Relay storage.
            </p>
          </div>
        </div>
        <Badge variant="outline" className="font-mono text-[9px]">
          {instances.length} total
        </Badge>
      </div>
      <div className="divide-y divide-border/60">
        {instances.length ? (
          instances.slice(0, 6).map((instance) => (
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
  )
}

function BrickDeploymentForm({
  selected,
  relays,
  form,
  variables,
  pending,
  onFormChange,
  onVariablesChange,
  onSubmit,
}: {
  selected: Brick | null
  relays: Array<PersistedRelay>
  form: DeploymentForm
  variables: Record<string, BrickVariableValue>
  pending: PendingAction
  onFormChange: React.Dispatch<React.SetStateAction<DeploymentForm>>
  onVariablesChange: React.Dispatch<
    React.SetStateAction<Record<string, BrickVariableValue>>
  >
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>
}) {
  return (
    <section className="rounded-2xl border border-border/80 bg-card/55 p-5 shadow-2xl shadow-black/10">
      <div className="flex items-center gap-2">
        <Plus className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">
          Deploy {selected?.metadata.name ?? "Brick"}
        </h2>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
        Relay creates the volume, labels, network attachment, and container.
      </p>
      {selected ? (
        <div className="mt-4 rounded-lg border border-primary/20 bg-primary/[0.06] px-3 py-2.5">
          <p className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.12em] text-primary uppercase">
            <FileCode2 className="size-3" /> {selected.format}
          </p>
          <p className="mt-1 truncate text-[10px] text-muted-foreground">
            {selected.metadata.author} · {selected.runtime.image}
          </p>
        </div>
      ) : null}
      <form className="mt-5 space-y-3.5" onSubmit={onSubmit}>
        <Field label="Relay">
          <select
            value={form.relayId}
            onChange={(event) =>
              onFormChange((value) => ({
                ...value,
                relayId: event.target.value,
              }))
            }
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-ring"
            required
          >
            {relays.map((relay) => (
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
              onFormChange((value) => ({
                ...value,
                name: event.target.value,
              }))
            }
            maxLength={120}
            placeholder="Survival SMP"
            required
          />
        </Field>
        {selected
          ? Object.entries(selected.variables).map(([name, definition]) => (
              <VariableField
                key={name}
                name={name}
                definition={definition}
                value={variables[name]}
                onChange={(value) =>
                  onVariablesChange((current) =>
                    updateBrickVariable(current, name, value)
                  )
                }
              />
            ))
          : null}
        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border/75 bg-background/45 px-3 py-2.5 text-xs">
          <span>
            <span className="block font-medium">Start after provisioning</span>
            <span className="mt-0.5 block text-[9px] text-muted-foreground">
              Download happens on first boot.
            </span>
          </span>
          <input
            type="checkbox"
            checked={form.start}
            onChange={(event) =>
              onFormChange((value) => ({
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
        <TinyStat icon={Cpu} label={selected?.runtime.name ?? "1 process"} />
        <TinyStat icon={Gauge} label="No sidecar" />
        <TinyStat icon={Server} label={selected?.network.mode ?? "1 volume"} />
      </div>
    </section>
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

function VariableField({
  name,
  definition,
  value,
  onChange,
}: {
  name: string
  definition: BrickVariable
  value: BrickVariableValue | undefined
  onChange: (value: BrickVariableValue | undefined) => void
}) {
  if (definition.type === "boolean") {
    return (
      <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border/75 bg-background/45 px-3 py-2.5 text-xs">
        <span>
          <span className="block font-medium">{definition.label}</span>
          <span className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">
            {definition.description}
          </span>
        </span>
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
          className="accent-primary"
        />
      </label>
    )
  }

  return (
    <label className="block space-y-1.5 text-[10px] font-medium text-muted-foreground">
      <span className="flex items-center justify-between gap-2">
        <span>{definition.label}</span>
        <span className="font-mono text-[8px] text-muted-foreground/55">
          {name}
        </span>
      </span>
      {definition.options ? (
        <select
          value={value === undefined ? "" : String(value)}
          onChange={(event) => {
            if (event.target.value === "" && !definition.required) {
              onChange(undefined)
              return
            }
            const option = definition.options?.find(
              (candidate) => String(candidate) === event.target.value
            )
            if (option !== undefined) onChange(option)
          }}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-ring"
          required={definition.required}
        >
          {!definition.required ? <option value="">Not set</option> : null}
          {definition.options.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      ) : (
        <Input
          type={
            definition.sensitive
              ? "password"
              : definition.type === "number"
                ? "number"
                : "text"
          }
          value={value === undefined ? "" : String(value)}
          onChange={(event) => {
            const next = event.target.value
            onChange(
              definition.type === "number"
                ? next === ""
                  ? undefined
                  : Number(next)
                : next
            )
          }}
          pattern={definition.rules?.pattern}
          min={definition.rules?.min}
          max={definition.rules?.max}
          minLength={definition.rules?.minLength}
          maxLength={definition.rules?.maxLength}
          required={definition.required}
        />
      )}
      <span className="block text-[9px] leading-4 font-normal">
        {definition.description}
      </span>
    </label>
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
  return brick.runtime.name.toUpperCase()
}

function defaultVariables(brick: Brick): Record<string, BrickVariableValue> {
  return Object.fromEntries(
    Object.entries(brick.variables).flatMap(([name, definition]) =>
      definition.default === undefined ? [] : [[name, definition.default]]
    )
  )
}

function defaultInstanceName(brick: Brick): string {
  const version = Object.hasOwn(brick.variables, "version")
    ? brick.variables.version.default
    : undefined
  return `${brick.metadata.name}${version === undefined ? "" : ` ${String(version)}`}`
}

function defaultMemory(brick: Brick): string {
  const memory = Object.hasOwn(brick.variables, "memory")
    ? brick.variables.memory.default
    : undefined
  return memory === undefined ? brick.runtime.resources.memory : String(memory)
}

function primaryPort(brick: Brick): string {
  const port = brick.network.ports.find(
    (candidate) => candidate.name === brick.network.primaryPort
  )
  return port
    ? `${port.protocol.toUpperCase()} ${port.host ?? port.container}`
    : "NO PORT"
}
