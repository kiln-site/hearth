import * as React from "react"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import {
  Check,
  CircleAlert,
  Cloud,
  Filter,
  KeyRound,
  LoaderCircle,
  Server,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import { showToast } from "@workspace/ui/components/sonner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import {
  WorkspaceTableCell,
  WorkspaceTableHead,
  WorkspaceTableHeading,
} from "@/components/workspace-data-table"
import {
  defaultDomainBlacklistPatterns,
  domainNameSchema,
  validateBlacklistPatterns,
} from "@/lib/domain-schemas"
import { domainSettingsQueryOptions, queryKeys } from "@/lib/query-options"
import {
  configureDomainIntegration,
  type ManagedDomainOverview,
} from "@/server/domains"

export function DomainsPage() {
  const { data } = useSuspenseQuery(domainSettingsQueryOptions())

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background/55 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <DomainConfiguration integration={data.integration} />
        <ManagedDomainsTable domains={data.managedDomains} />
      </div>
    </main>
  )
}

const DomainConfiguration = React.memo(function DomainConfiguration({
  integration,
}: {
  integration: {
    blacklistPatterns: Array<string>
    domain: string
    enabled: boolean
    zoneName: string
  } | null
}) {
  const queryClient = useQueryClient()
  const [domain, setDomain] = React.useState(integration?.domain ?? "")
  const [enabled, setEnabled] = React.useState(integration?.enabled ?? true)
  const [blacklistPatterns, setBlacklistPatterns] = React.useState(() =>
    (
      integration?.blacklistPatterns ?? [...defaultDomainBlacklistPatterns]
    ).join("\n")
  )
  const [blacklistDraft, setBlacklistDraft] = React.useState(blacklistPatterns)
  const [apiToken, setApiToken] = React.useState("")
  const [blacklistOpen, setBlacklistOpen] = React.useState(false)
  const [tokenOpen, setTokenOpen] = React.useState(false)
  const configure = useMutation({
    mutationFn: configureDomainIntegration,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.domains.settings,
      })
      showToast({
        message: "Cloudflare domain configuration saved",
        type: "success",
      })
    },
  })

  const saveConfiguration = React.useCallback(
    ({
      apiToken,
      nextBlacklistPatterns = blacklistPatterns,
      onSuccess,
    }: {
      apiToken?: string
      nextBlacklistPatterns?: string
      onSuccess?: () => void
    } = {}) => {
      const parsedDomain = domainNameSchema.safeParse(domain)
      if (!parsedDomain.success) {
        showToast({
          message:
            parsedDomain.error.issues[0]?.message ?? "Enter a valid domain",
          type: "error",
        })
        return
      }
      let patterns: Array<string>
      try {
        patterns = validateBlacklistPatterns(
          nextBlacklistPatterns
            .split(/\r?\n/u)
            .map((pattern) => pattern.trim())
            .filter(Boolean)
        )
      } catch (cause) {
        showToast({ message: errorMessage(cause), type: "error" })
        return
      }
      if (!integration && !apiToken) {
        setBlacklistPatterns(nextBlacklistPatterns)
        setBlacklistOpen(false)
        setTokenOpen(true)
        return
      }
      configure.mutate(
        {
          data: {
            apiToken,
            blacklistPatterns: patterns,
            domain: parsedDomain.data,
            enabled,
          },
        },
        {
          onSuccess: () => {
            setBlacklistPatterns(nextBlacklistPatterns)
            onSuccess?.()
          },
        }
      )
    },
    [blacklistPatterns, configure, domain, enabled, integration]
  )

  return (
    <>
      <section className="border border-border/80 bg-card/55">
        <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
          <div className="flex min-w-44 items-center gap-2.5">
            <div className="grid size-8 shrink-0 place-items-center border border-primary/25 bg-primary/10 text-primary">
              <Cloud className="size-3.5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xs font-semibold">Vanity domain</h1>
                <DomainStatus
                  enabled={integration?.enabled === true}
                  verified={integration !== null}
                />
              </div>
              <p className="truncate font-mono text-[9px] text-muted-foreground">
                {integration?.zoneName ?? "Cloudflare not connected"}
              </p>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-nowrap">
            <label className="min-w-52 flex-1">
              <span className="sr-only">Vanity domain suffix</span>
              <Input
                autoCapitalize="none"
                autoCorrect="off"
                className="font-mono"
                name="domain"
                placeholder="play.example.com"
                required
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
              />
            </label>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label="Configure Cloudflare API token"
                    size="icon-sm"
                    type="button"
                    variant="outline"
                    onClick={() => setTokenOpen(true)}
                  >
                    <KeyRound />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Cloudflare API token</TooltipContent>
              </Tooltip>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setBlacklistDraft(blacklistPatterns)
                  setBlacklistOpen(true)
                }}
              >
                <Filter />
                Blacklist
              </Button>
              <label className="flex h-8 items-center gap-2 border border-border/70 bg-background/35 px-2.5 text-[10px] text-muted-foreground">
                Automatic
                <Switch
                  aria-label="Enable automatic domain provisioning"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
              </label>
              <Button
                disabled={configure.isPending}
                type="button"
                onClick={() => saveConfiguration()}
              >
                {configure.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Check />
                )}
                Save
              </Button>
            </div>
          </div>
        </div>
        {configure.error ? (
          <p className="border-t border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {errorMessage(configure.error)}
          </p>
        ) : null}
      </section>

      <Dialog
        open={tokenOpen}
        onOpenChange={(open) => {
          setTokenOpen(open)
          if (!open) setApiToken("")
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cloudflare API token</DialogTitle>
            <DialogDescription>
              Kiln encrypts this token at rest and never returns it to the
              browser.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block space-y-1.5 text-[11px] font-medium">
              API token
              <Input
                autoComplete="new-password"
                minLength={20}
                name="apiToken"
                placeholder="Zone Read and DNS Write"
                required
                type="password"
                value={apiToken}
                onChange={(event) => setApiToken(event.target.value)}
              />
            </label>
            <div className="flex gap-2 border border-amber-400/20 bg-amber-400/5 p-3 text-amber-100/85">
              <KeyRound className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
              <p className="text-[10px] leading-relaxed">
                Limit this token to Zone Read and DNS Write for the zone that
                owns the vanity suffix. Records remain DNS-only.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTokenOpen(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={configure.isPending || apiToken.trim().length < 20}
                type="button"
                onClick={() =>
                  saveConfiguration({
                    apiToken: apiToken.trim(),
                    onSuccess: () => setTokenOpen(false),
                  })
                }
              >
                {configure.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <KeyRound />
                )}
                Verify token
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={blacklistOpen} onOpenChange={setBlacklistOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Blacklisted vanity names</DialogTitle>
            <DialogDescription>
              One case-insensitive regular expression per line. These filters
              apply to generated names and user customizations.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              aria-label="Blacklisted vanity name patterns"
              className="min-h-52 font-mono text-xs"
              placeholder={"^(admin|api|www)$\n^staff-"}
              value={blacklistDraft}
              onChange={(event) => setBlacklistDraft(event.target.value)}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setBlacklistOpen(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={configure.isPending}
                type="button"
                onClick={() =>
                  saveConfiguration({
                    nextBlacklistPatterns: blacklistDraft,
                    onSuccess: () => setBlacklistOpen(false),
                  })
                }
              >
                {configure.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Filter />
                )}
                Save filters
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
})

const ManagedDomainsTable = React.memo(function ManagedDomainsTable({
  domains,
}: {
  domains: Array<ManagedDomainOverview>
}) {
  return (
    <section className="overflow-hidden border border-border/80 bg-card/45">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div>
          <h2 className="text-xs font-semibold">Managed domains</h2>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Vanity addresses currently owned by Kiln
          </p>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {domains.length} {domains.length === 1 ? "domain" : "domains"}
        </span>
      </div>
      <table className="w-full table-fixed border-collapse text-left">
        <WorkspaceTableHead>
          <WorkspaceTableHeading className="w-auto sm:w-[34%]">
            Domain
          </WorkspaceTableHeading>
          <WorkspaceTableHeading className="hidden w-[20%] sm:table-cell">
            Relay
          </WorkspaceTableHeading>
          <WorkspaceTableHeading className="w-20">Port</WorkspaceTableHeading>
          <WorkspaceTableHeading className="hidden w-20 md:table-cell">
            SRV
          </WorkspaceTableHeading>
          <WorkspaceTableHeading className="w-[30%]">
            Server
          </WorkspaceTableHeading>
        </WorkspaceTableHead>
        <tbody className="divide-y divide-border/70">
          {domains.length ? (
            domains.map((domain) => (
              <ManagedDomainRow
                key={`${domain.relayId}:${domain.instanceId}`}
                domain={domain}
              />
            ))
          ) : (
            <tr>
              <td className="h-36 px-4 text-center" colSpan={5}>
                <Cloud className="mx-auto size-5 text-muted-foreground/45" />
                <p className="mt-2 text-xs font-medium">
                  No managed domains yet
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  New servers will appear here after automatic provisioning.
                </p>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
})

const ManagedDomainRow = React.memo(function ManagedDomainRow({
  domain,
}: {
  domain: ManagedDomainOverview
}) {
  return (
    <tr className="group transition-colors hover:bg-accent/25">
      <WorkspaceTableCell>
        <div className="min-w-0">
          <p
            className="truncate font-mono text-[10px] text-foreground"
            title={domain.address}
          >
            {domain.address}
          </p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span
              className={
                domain.status === "active"
                  ? "size-1.5 rounded-full bg-emerald-400"
                  : domain.status === "pending"
                    ? "size-1.5 rounded-full bg-amber-300"
                    : "size-1.5 rounded-full bg-destructive"
              }
            />
            <span className="font-mono text-[8px] text-muted-foreground uppercase">
              {domain.status}
            </span>
          </div>
        </div>
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden sm:table-cell">
        <p className="truncate text-[10px]" title={domain.relayName}>
          {domain.relayName}
        </p>
        <p className="truncate font-mono text-[8px] text-muted-foreground">
          {domain.relayId.slice(0, 8)}
        </p>
      </WorkspaceTableCell>
      <WorkspaceTableCell>
        <span className="font-mono text-[10px]">{domain.port}</span>
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden md:table-cell">
        <span
          className={
            domain.supportsSrv
              ? "inline-flex items-center gap-1 text-[9px] text-emerald-300"
              : "text-[9px] text-muted-foreground"
          }
        >
          {domain.supportsSrv ? <Check className="size-3" /> : null}
          {domain.supportsSrv ? "Yes" : "No"}
        </span>
      </WorkspaceTableCell>
      <WorkspaceTableCell>
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center border border-border/70 bg-background/35 text-muted-foreground">
            <Server className="size-3.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[10px]" title={domain.serverName}>
              {domain.serverName}
            </p>
            <p className="truncate font-mono text-[8px] text-muted-foreground">
              {domain.instanceId.slice(0, 8)}
            </p>
          </div>
        </div>
      </WorkspaceTableCell>
    </tr>
  )
})

function DomainStatus({
  enabled,
  verified,
}: {
  enabled: boolean
  verified: boolean
}) {
  const active = verified && enabled
  return (
    <span
      className={
        active
          ? "inline-flex items-center gap-1 font-mono text-[8px] text-emerald-300 uppercase"
          : "inline-flex items-center gap-1 font-mono text-[8px] text-muted-foreground uppercase"
      }
    >
      {verified ? (
        <span
          className={
            active
              ? "size-1.5 rounded-full bg-emerald-400"
              : "size-1.5 rounded-full bg-muted-foreground"
          }
        />
      ) : (
        <CircleAlert className="size-2.5" />
      )}
      {active ? "Active" : verified ? "Paused" : "Setup required"}
    </span>
  )
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : "Could not save the domain"
}
