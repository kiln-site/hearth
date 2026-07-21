import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Box,
  Check,
  Copy,
  Cpu,
  Fingerprint,
  Globe2,
  HardDrive,
  LoaderCircle,
  Network,
  Save,
  Server,
  Tags,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import { queryKeys, replaceRelaySnapshotInstance } from "@/lib/query-options"
import type { RelayFleetSnapshot } from "@/lib/relay-fleet"
import type {
  InstanceSettingsInstance,
  RelayNodeSummary,
} from "@/lib/relay-selectors"
import { updateInstanceName } from "@/server/relay"

export function SettingsWorkspace({
  instance,
  node,
  canRename,
  relayConnected,
}: {
  instance: InstanceSettingsInstance
  node: RelayNodeSummary
  canRename: boolean
  relayConnected: boolean
}) {
  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-card">
      <div className="mx-auto max-w-5xl px-5 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[9px] tracking-[0.18em] text-primary uppercase">
            Instance info
          </p>
          <h2 className="font-heading text-xl font-semibold tracking-[-0.03em]">
            Server identity & runtime
          </h2>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Runtime facts are inferred by Relay from the managed container and
            its writable{" "}
            <code className="font-mono text-foreground/80">/server</code> mount.
          </p>
        </div>

        <div className="mt-7 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="overflow-hidden rounded-xl border bg-background/45">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Fingerprint className="size-4 text-primary" />
                <h3 className="text-sm font-semibold">Identity</h3>
              </div>
              <Badge variant="outline" className="font-mono text-[9px]">
                {instance.game}
              </Badge>
            </div>
            <InstanceNameForm
              instance={instance}
              canRename={canRename && relayConnected}
            />
            <MetaRow
              icon={Fingerprint}
              label="Server ID"
              value={instance.shortId}
              mono
            />
            <MetaRow
              icon={Box}
              label="Server type"
              value={instance.implementation}
            />
            <MetaRow
              icon={Tags}
              label={instance.game}
              value={instance.version}
              mono
            />
            <MetaRow
              icon={Cpu}
              label="Runtime"
              value={instance.javaVersion}
              mono
            />
          </div>

          <CopyAddressCard instance={instance} />
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border bg-background/45">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Network className="size-4 text-primary" />
              <h3 className="text-sm font-semibold">Relay placement</h3>
            </div>
            <span
              className={`flex items-center gap-1.5 font-mono text-[9px] ${relayConnected ? "text-emerald-400" : "text-amber-300"}`}
            >
              <span
                className={`size-1.5 rounded-full ${relayConnected ? "bg-emerald-400" : "bg-amber-300"}`}
              />
              {relayConnected ? "DISCOVERED" : "LAST KNOWN"}
            </span>
          </div>
          <div className="grid sm:grid-cols-2">
            <MetaRow
              icon={HardDrive}
              label="Node"
              value={`${node.name} · ${node.id}`}
            />
            <MetaRow
              icon={Box}
              label="Container"
              value={instance.containerId ?? "Not created"}
              mono
            />
            <MetaRow
              icon={Tags}
              label="Compose service"
              value={instance.service}
              mono
            />
            <MetaRow
              icon={HardDrive}
              label="Data directory"
              value={instance.directory}
              mono
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-xl border border-dashed bg-muted/10 px-4 py-3">
          <div>
            <p className="text-xs font-semibold">Kiln-managed container</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Relay discovered this server from its management and identity
              labels.
            </p>
          </div>
          <code className="rounded-md border bg-background px-2 py-1.5 font-mono text-[9px] text-primary">
            kiln.relay.managed=true · kiln.server.id={instance.shortId}…
          </code>
        </div>
      </div>
    </section>
  )
}

function InstanceNameForm({
  instance,
  canRename,
}: {
  instance: InstanceSettingsInstance
  canRename: boolean
}) {
  const queryClient = useQueryClient()
  const updateNameMutation = useMutation({
    mutationFn: updateInstanceName,
    onSuccess: (updated) => {
      queryClient.setQueryData<RelayFleetSnapshot>(
        queryKeys.relay.snapshot,
        (snapshot) => replaceRelaySnapshotInstance(snapshot, updated)
      )
    },
  })
  const [draftName, setDraftName] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const name = draftName ?? instance.name

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextName = name.trim()
    if (!nextName || nextName === instance.name || pending) return
    setPending(true)
    setSaved(false)
    setError(null)
    try {
      await updateNameMutation.mutateAsync({
        data: {
          instanceId: instance.id,
          relayId: instance.relayId,
          name: nextName,
        },
      })
      setDraftName(null)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1800)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save instance name"
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="border-b px-4 py-3"
      onSubmit={(event) => void saveName(event)}
    >
      <div className="flex items-center gap-2">
        <Server className="size-3.5 shrink-0 text-muted-foreground" />
        <label
          htmlFor="instance-display-name"
          className="text-[9px] tracking-wider text-muted-foreground uppercase"
        >
          Display name
        </label>
      </div>
      <div className="mt-2 flex gap-2">
        <Input
          id="instance-display-name"
          value={name}
          onChange={(event) => {
            setDraftName(event.target.value)
            setSaved(false)
            setError(null)
          }}
          maxLength={120}
          disabled={!canRename || pending}
          aria-invalid={Boolean(error)}
          className="h-9 min-w-0 flex-1"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="h-9 shrink-0"
          disabled={
            !canRename ||
            pending ||
            !name.trim() ||
            name.trim() === instance.name
          }
        >
          {pending ? (
            <LoaderCircle className="animate-spin" />
          ) : saved ? (
            <Check />
          ) : (
            <Save />
          )}
          {pending ? "Saving" : saved ? "Saved" : "Save"}
        </Button>
      </div>
      <p
        className={`mt-1.5 text-[9px] ${error ? "text-destructive" : "text-muted-foreground"}`}
      >
        {error ??
          (canRename
            ? "Stored by Hearth; the Relay and container keep their stable ID."
            : "You do not have permission to rename this instance.")}
      </p>
    </form>
  )
}

function CopyAddressCard({ instance }: { instance: InstanceSettingsInstance }) {
  return (
    <div className="rounded-xl border bg-background/45 p-4">
      <div className="flex items-center gap-2">
        <Globe2 className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">Connect</h3>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {instance.game === "Palworld"
          ? "Direct UDP endpoint on the Relay node."
          : "Routed through Velocity and the existing CoreDNS wildcard."}
      </p>
      <CopyAddressControl address={instance.connectAddress} />
    </div>
  )
}

function CopyAddressControl({ address }: { address: string }) {
  const [copied, setCopied] = React.useState(false)
  const resetTimer = React.useRef<number | null>(null)
  React.useEffect(
    () => () => {
      if (resetTimer.current) window.clearTimeout(resetTimer.current)
    },
    []
  )

  async function copyAddress() {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    if (resetTimer.current) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <>
      <button
        type="button"
        className="group mt-5 flex w-full items-center justify-between rounded-lg border border-primary/25 bg-primary/7 px-3 py-3 text-left transition-[background-color,border-color,box-shadow] outline-none hover:border-primary/40 hover:bg-primary/12 focus-visible:border-ring/70 focus-visible:ring-2 focus-visible:ring-ring/35"
        onClick={copyAddress}
      >
        <span>
          <span className="block font-mono text-[9px] tracking-wider text-primary uppercase">
            Server address
          </span>
          <span className="mt-1 block font-mono text-sm font-semibold">
            {address}
          </span>
        </span>
        <span className="grid size-8 place-items-center rounded-md bg-background/70 text-muted-foreground group-hover:text-foreground">
          {copied ? (
            <Check className="size-4 text-emerald-400" />
          ) : (
            <Copy className="size-4" />
          )}
        </span>
      </button>
      <p className="mt-3 font-mono text-[9px] text-muted-foreground/75">
        {copied ? "Address copied to clipboard" : "Click to copy"}
      </p>
    </>
  )
}

function MetaRow({
  icon: Icon,
  label,
  value,
  mono = false,
}: {
  icon: typeof Server
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 border-b px-4 py-3 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-[9px] tracking-wider text-muted-foreground uppercase">
          {label}
        </span>
        <span
          className={`mt-0.5 block truncate text-xs ${mono ? "font-mono" : "font-medium"}`}
        >
          {value}
        </span>
      </span>
    </div>
  )
}
