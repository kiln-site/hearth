import * as React from "react"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Result } from "effect"
import {
  ArrowLeft,
  Check,
  CircleAlert,
  ExternalLink,
  Globe2,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Search,
  Server,
  Settings2,
  X,
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
import { cn } from "@workspace/ui/lib/utils"

import {
  WorkspaceDataTable,
  WorkspaceTableCell,
  WorkspaceTableHead,
  WorkspaceTableHeading,
  createWorkspaceTableSearchStore,
  useWorkspaceTableSearchInput,
} from "@/components/workspace-data-table"
import type { WorkspaceTableSearchStore } from "@/components/workspace-data-table"
import {
  defaultDomainBlacklistPatterns,
  domainNameSchema,
  validateBlacklistPatterns,
} from "@/lib/domain-schemas"
import { domainSettingsQueryOptions, queryKeys } from "@/lib/query-options"
import {
  configureDomainIntegration,
  resyncDomainAssignments,
  type ManagedDomainOverview,
} from "@/server/domains"

interface DomainIntegrationView {
  blacklistPatterns: Array<string>
  domain: string
  enabled: boolean
  zoneName: string
}

export function DomainsPage() {
  const { data } = useSuspenseQuery(domainSettingsQueryOptions())
  const [searchStore] = React.useState(createWorkspaceTableSearchStore)
  const [configurationOpen, setConfigurationOpen] = React.useState(false)
  const openConfiguration = React.useCallback(
    () => setConfigurationOpen(true),
    []
  )

  return (
    <div className="mx-auto w-full max-w-[90rem] space-y-3 px-3 pb-10 sm:px-5">
      <DomainSummaryCard
        integration={data.integration}
        onConfigure={openConfiguration}
      />

      <section className="overflow-hidden rounded-xl border bg-card/45 [contain:paint]">
        <DomainsToolbar
          integration={data.integration}
          searchStore={searchStore}
        />
        <ManagedDomainsTable
          domains={data.managedDomains}
          searchStore={searchStore}
        />
      </section>

      {configurationOpen ? (
        <DomainConfigurationDialog
          key={domainIntegrationKey(data.integration)}
          integration={data.integration}
          open
          onOpenChange={setConfigurationOpen}
        />
      ) : null}
    </div>
  )
}

const DomainSummaryCard = React.memo(function DomainSummaryCard({
  integration,
  onConfigure,
}: {
  integration: DomainIntegrationView | null
  onConfigure: () => void
}) {
  const active = integration?.enabled === true
  const configured = integration !== null

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border/75 bg-card/45 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-lg border",
            active
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
              : configured
                ? "border-amber-300/25 bg-amber-300/8 text-amber-200"
                : "border-border/80 bg-background/70 text-muted-foreground"
          )}
        >
          <Globe2 className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-sm font-semibold">Vanity URL</h1>
            <DomainStatus enabled={active} verified={configured} />
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
            {`<vanity>.${integration?.domain ?? "example.com"}`}
          </p>
        </div>
      </div>
      <Button
        className="shrink-0"
        size="sm"
        type="button"
        variant="outline"
        onClick={onConfigure}
      >
        <Settings2 />
        Configure Vanity
      </Button>
    </section>
  )
})

const DomainsToolbar = React.memo(function DomainsToolbar({
  integration,
  searchStore,
}: {
  integration: DomainIntegrationView | null
  searchStore: WorkspaceTableSearchStore
}) {
  const queryClient = useQueryClient()
  const [mobileSearchOpen, setMobileSearchOpen] = React.useState(false)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const resync = useMutation({
    mutationFn: resyncDomainAssignments,
    onSuccess: async ({ syncedServerCount }) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.domains.settings,
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.relay.snapshot }),
      ])
      showToast({
        message: `Synced ${syncedServerCount} ${
          syncedServerCount === 1 ? "server address" : "server addresses"
        }`,
        type: "success",
      })
    },
    onError: (cause) =>
      showToast({ message: errorMessage(cause), type: "error" }),
  })

  React.useEffect(() => {
    if (mobileSearchOpen) searchInputRef.current?.focus()
  }, [mobileSearchOpen])

  return (
    <div className="flex min-w-0 items-center gap-2 border-b bg-background/25 p-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-busy={resync.isPending}
            aria-label="Sync managed domains"
            disabled={!integration?.enabled || resync.isPending}
            size="icon"
            type="button"
            variant="outline"
            onClick={() => resync.mutate(undefined)}
          >
            <RefreshCw className={resync.isPending ? "animate-spin" : ""} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {integration?.enabled
            ? "Sync managed domains"
            : "Configure an active vanity domain first"}
        </TooltipContent>
      </Tooltip>

      {!mobileSearchOpen ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Search managed domains"
              className="sm:hidden"
              size="icon"
              type="button"
              variant="outline"
              onClick={() => setMobileSearchOpen(true)}
            >
              <Search />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            Search domains
          </TooltipContent>
        </Tooltip>
      ) : null}

      <div
        className={`${mobileSearchOpen ? "block" : "hidden"} min-w-0 flex-1 sm:block sm:max-w-md`}
      >
        <DomainSearchInput inputRef={searchInputRef} store={searchStore} />
      </div>

      {mobileSearchOpen ? (
        <Button
          aria-label="Close domain search"
          className="sm:hidden"
          size="icon"
          type="button"
          variant="ghost"
          onClick={() => {
            searchStore.set("")
            setMobileSearchOpen(false)
          }}
        >
          <X />
        </Button>
      ) : null}
    </div>
  )
})

const DomainSearchInput = React.memo(function DomainSearchInput({
  inputRef,
  store,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  store: WorkspaceTableSearchStore
}) {
  useWorkspaceTableSearchInput(inputRef, store)

  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        aria-label="Search managed domains"
        className="pl-9 text-base md:text-sm"
        defaultValue={store.getServerSnapshot()}
        placeholder="Search domains"
        type="search"
        onChange={(event) => store.set(event.currentTarget.value)}
      />
    </div>
  )
})

const ManagedDomainsTable = React.memo(function ManagedDomainsTable({
  domains,
  searchStore,
}: {
  domains: Array<ManagedDomainOverview>
  searchStore: WorkspaceTableSearchStore
}) {
  const renderRow = React.useCallback(
    (domain: ManagedDomainOverview) => <ManagedDomainRow domain={domain} />,
    []
  )
  const renderEmpty = React.useCallback(
    (searchActive: boolean) => (
      <EmptyDomainsTable searchActive={searchActive} />
    ),
    []
  )

  return (
    <WorkspaceDataTable
      getRowKey={managedDomainRowKey}
      getSearchText={managedDomainSearchText}
      head={<ManagedDomainsTableHead />}
      items={domains}
      renderEmpty={renderEmpty}
      renderRow={renderRow}
      searchStore={searchStore}
    />
  )
})

const ManagedDomainsTableHead = React.memo(function ManagedDomainsTableHead() {
  return (
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
      <WorkspaceTableHeading className="w-[30%]">Server</WorkspaceTableHeading>
    </WorkspaceTableHead>
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
            domain.srvActive
              ? "inline-flex items-center gap-1 text-[9px] text-emerald-300"
              : "text-[9px] text-muted-foreground"
          }
        >
          {domain.srvActive ? <Check className="size-3" /> : null}
          {domain.srvActive ? "Active" : domain.supportsSrv ? "Not set" : "No"}
        </span>
      </WorkspaceTableCell>
      <WorkspaceTableCell>
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border/70 bg-background/35 text-muted-foreground">
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

function EmptyDomainsTable({ searchActive }: { searchActive: boolean }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
      <Globe2 className="size-6 text-muted-foreground/45" />
      <p className="mt-3 text-sm font-semibold">
        {searchActive ? "No domains match your search" : "No Active Domains"}
      </p>
      <p className="mt-1 max-w-sm text-[10px] leading-4 text-muted-foreground">
        {searchActive
          ? "Try a vanity address, server, Relay, port, status, or ID."
          : "Active vanity addresses will appear here after a server is provisioned."}
      </p>
    </div>
  )
}

function DomainConfigurationDialog({
  integration,
  open,
  onOpenChange,
}: {
  integration: DomainIntegrationView | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [mode, setMode] = React.useState<"settings" | "token">("settings")
  const [domain, setDomain] = React.useState(integration?.domain ?? "")
  const [enabled, setEnabled] = React.useState(integration?.enabled ?? true)
  const [blacklistPatterns, setBlacklistPatterns] = React.useState(() =>
    (
      integration?.blacklistPatterns ?? [...defaultDomainBlacklistPatterns]
    ).join("\n")
  )
  const [apiToken, setApiToken] = React.useState("")
  const configure = useMutation({
    mutationFn: configureDomainIntegration,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.domains.settings,
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.relay.snapshot }),
      ])
      showToast({
        message: "Cloudflare vanity configuration saved",
        type: "success",
      })
      onOpenChange(false)
    },
  })

  const save = React.useCallback(
    (token?: string) => {
      const parsedDomain = domainNameSchema.safeParse(domain)
      if (!parsedDomain.success) {
        showToast({
          message:
            parsedDomain.error.issues[0]?.message ?? "Enter a valid domain",
          type: "error",
        })
        return
      }
      const patternsResult = Result.try(() =>
        validateBlacklistPatterns(
          blacklistPatterns
            .split(/\r?\n/u)
            .map((pattern) => pattern.trim())
            .filter(Boolean)
        )
      )
      if (Result.isFailure(patternsResult)) {
        showToast({
          message: errorMessage(patternsResult.failure),
          type: "error",
        })
        return
      }
      if (!integration && !token) {
        setMode("token")
        return
      }
      configure.mutate({
        data: {
          apiToken: token,
          blacklistPatterns: patternsResult.success,
          domain: parsedDomain.data,
          enabled,
        },
      })
    },
    [blacklistPatterns, configure, domain, enabled, integration]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-7">
            <div className="min-w-0">
              <DialogTitle>
                {mode === "settings"
                  ? "Configure vanity URLs"
                  : "Cloudflare API token"}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {mode === "settings"
                  ? "Choose the suffix Kiln uses for managed game-server addresses."
                  : "Use a restricted token for the DNS zone Kiln will manage."}
              </DialogDescription>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={
                    mode === "settings"
                      ? "Configure Cloudflare API token"
                      : "Return to vanity settings"
                  }
                  size="icon-sm"
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setMode((current) =>
                      current === "settings" ? "token" : "settings"
                    )
                  }
                >
                  {mode === "settings" ? <KeyRound /> : <ArrowLeft />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {mode === "settings" ? "Cloudflare token" : "Vanity settings"}
              </TooltipContent>
            </Tooltip>
          </div>
        </DialogHeader>

        {mode === "settings" ? (
          <div className="space-y-4">
            <label className="block space-y-1.5 text-[11px] font-medium">
              Vanity domain
              <Input
                autoCapitalize="none"
                autoCorrect="off"
                className="font-mono"
                name="domain"
                placeholder="play.example.com"
                required
                value={domain}
                onChange={(event) => setDomain(event.currentTarget.value)}
              />
              <span className="block font-mono text-[9px] font-normal text-muted-foreground">
                {`Servers receive addresses like <vanity>.${domain.trim() || "example.com"}`}
              </span>
            </label>

            <div className="flex items-center justify-between gap-4 border border-border/75 bg-background/35 p-3">
              <div>
                <p className="text-xs font-medium">Automatic provisioning</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  Create and reconcile DNS records as servers are provisioned.
                </p>
              </div>
              <Switch
                aria-label="Enable automatic domain provisioning"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>

            <label className="block space-y-1.5 text-[11px] font-medium">
              Blacklisted vanity names
              <Textarea
                aria-label="Blacklisted vanity name patterns"
                className="min-h-36 font-mono text-xs"
                placeholder={"^(admin|api|www)$\n^staff-"}
                value={blacklistPatterns}
                onChange={(event) =>
                  setBlacklistPatterns(event.currentTarget.value)
                }
              />
              <span className="block text-[9px] font-normal text-muted-foreground">
                One case-insensitive regular expression per line.
              </span>
            </label>

            {configure.error ? (
              <ConfigurationError error={configure.error} />
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={configure.isPending}
                type="button"
                onClick={() => save()}
              >
                {configure.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Check />
                )}
                Save configuration
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block space-y-1.5 text-[11px] font-medium">
              API token
              <Input
                autoComplete="new-password"
                minLength={20}
                name="apiToken"
                placeholder="Paste a restricted Cloudflare token"
                required
                type="password"
                value={apiToken}
                onChange={(event) => setApiToken(event.currentTarget.value)}
              />
            </label>

            <div className="space-y-2 border border-border/75 bg-background/35 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold">Required permissions</p>
                <a
                  className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                  href="https://dash.cloudflare.com/profile/api-tokens"
                  rel="noreferrer"
                  target="_blank"
                >
                  Create token <ExternalLink className="size-3" />
                </a>
              </div>
              <PermissionRow access="Read" resource="Zone → Zone" />
              <PermissionRow access="Edit" resource="Zone → DNS" />
              <p className="pt-1 text-[9px] leading-4 text-muted-foreground">
                Scope Zone Resources to the specific zone that owns this vanity
                domain. No account ID or zone ID is required—Kiln resolves and
                stores the zone ID after verification.
              </p>
            </div>

            <div className="flex gap-2 border border-amber-400/20 bg-amber-400/5 p-3 text-amber-100/85">
              <KeyRound className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
              <p className="text-[10px] leading-relaxed">
                Kiln encrypts the token at rest, never returns it to the
                browser, and keeps every managed record DNS-only.
              </p>
            </div>

            {configure.error ? (
              <ConfigurationError error={configure.error} />
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setMode("settings")}
              >
                <ArrowLeft /> Back
              </Button>
              <Button
                disabled={configure.isPending || apiToken.trim().length < 20}
                type="button"
                onClick={() => save(apiToken.trim())}
              >
                {configure.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <KeyRound />
                )}
                Verify & save
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PermissionRow({
  access,
  resource,
}: {
  access: "Edit" | "Read"
  resource: string
}) {
  return (
    <div className="flex items-center gap-2 border border-border/60 bg-card/50 px-2.5 py-2">
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-400/10 text-emerald-300">
        <Check className="size-3" />
      </span>
      <span className="min-w-0 flex-1 font-mono text-[10px]">{resource}</span>
      <span className="font-mono text-[9px] text-muted-foreground uppercase">
        {access}
      </span>
    </div>
  )
}

function ConfigurationError({ error }: { error: Error }) {
  return (
    <p className="border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      {errorMessage(error)}
    </p>
  )
}

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

function managedDomainRowKey(domain: ManagedDomainOverview): string {
  return `${domain.relayId}:${domain.instanceId}`
}

function managedDomainSearchText(domain: ManagedDomainOverview): string {
  return [
    domain.address,
    domain.instanceId,
    domain.port,
    domain.relayId,
    domain.relayName,
    domain.serverName,
    domain.srvActive
      ? "srv active"
      : domain.supportsSrv
        ? "srv not set"
        : "no srv",
    domain.status,
  ].join(" ")
}

function domainIntegrationKey(integration: DomainIntegrationView | null) {
  return integration
    ? `${integration.domain}:${integration.enabled}:${integration.blacklistPatterns.join("|")}`
    : "new"
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : "Could not save the domain"
}
