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
  ChevronDown,
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

import {
  WorkspaceDataTable,
  WorkspaceTableCell,
  WorkspaceTableHead,
  WorkspaceTableHeading,
  createWorkspaceTableSearchStore,
  useWorkspaceTableSearchInput,
} from "@/components/workspace-data-table"
import type { WorkspaceTableSearchStore } from "@/components/workspace-data-table"
import { WorkspaceSummaryCard } from "@/components/workspace-summary-card"
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
          hearthDomain={data.hearthDomain}
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
    <WorkspaceSummaryCard
      action={
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
      }
      icon={<Globe2 className="size-5" />}
      iconClassName={
        active
          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
          : configured
            ? "border-amber-300/25 bg-amber-300/8 text-amber-200"
            : "border-border/80 bg-background/70 text-muted-foreground"
      }
      title="Vanity URL"
      titleAccessory={<DomainStatus enabled={active} verified={configured} />}
    >
      <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
        {`<vanity>.${integration?.domain ?? "example.com"}`}
      </p>
    </WorkspaceSummaryCard>
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
  hearthDomain,
  integration,
  open,
  onOpenChange,
}: {
  hearthDomain: string
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
      <DialogContent
        className={mode === "token" ? "sm:max-w-3xl" : "sm:max-w-xl"}
      >
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

            <div className="space-y-2">
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
              <CloudflarePermissionPolicy
                domain={integration?.zoneName ?? hearthDomain}
              />
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

function CloudflarePermissionPolicy({ domain }: { domain: string }) {
  return (
    <figure className="space-y-1.5">
      <figcaption className="flex items-center gap-2 px-0.5 text-[9px] text-muted-foreground">
        <span>Cloudflare dashboard reference</span>
        <span aria-hidden="true" className="h-px flex-1 bg-border/60" />
        <span className="font-mono tracking-wide uppercase">Visual only</span>
      </figcaption>

      <div className="overflow-hidden rounded-lg border border-white/12 bg-[#101010] text-[#ededed] shadow-lg shadow-black/15">
        <div className="flex items-center justify-between border-b border-white/10 bg-[#141414] px-3 py-2.5">
          <p className="text-[10px] font-semibold">Edit policy</p>
          <span className="text-[9px] text-white/55">Custom</span>
        </div>

        <div className="grid gap-2 border-b border-white/10 p-3 sm:grid-cols-[minmax(9rem,0.8fr)_minmax(0,1.35fr)]">
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-white/15 bg-white/[0.025] px-3 py-2.5">
            <span className="text-[10px] font-medium">Specified Domains</span>
            <ChevronDown className="size-3.5 shrink-0 text-white/45" />
          </div>
          <div className="flex min-w-0 items-center gap-2 rounded-md border border-white/20 bg-white/[0.045] px-3 py-2.5">
            <Globe2 className="size-3.5 shrink-0 text-white/70" />
            <span className="truncate font-mono text-[10px] text-white/90">
              {domain}
            </span>
            <ChevronDown className="ml-auto size-3.5 shrink-0 text-white/45" />
          </div>
        </div>

        <VisualPermissionGroup label="DNS & Zones" selected={2} total={12}>
          <CloudflarePermissionRow
            description="Grants write access to DNS"
            edit
            name="DNS"
          />
          <CloudflarePermissionRow
            description="Grants read access to zone management"
            name="Zone"
            read
          />
          <CloudflarePermissionRow
            description="Grants read access to zone custom assets"
            name="Zone Custom Asset"
          />
          <CloudflarePermissionRow
            description="Grants access to Zone DNS Settings"
            name="Zone DNS Settings"
          />
          <CloudflarePermissionRow
            description="Grants access to zone settings"
            name="Zone Settings"
          />
        </VisualPermissionGroup>

        <div className="border-t border-white/10 bg-white/[0.025] px-3 py-2">
          <p className="text-[9px] leading-4 text-white/50">
            DNS Edit already includes read and list access. Leave DNS Read
            unchecked.
          </p>
        </div>
      </div>
    </figure>
  )
}

function VisualPermissionGroup({
  children,
  label,
  selected,
  total,
}: {
  children: React.ReactNode
  label: string
  selected: number
  total: number
}) {
  return (
    <div className="border-b border-white/10 last:border-b-0">
      <div className="flex items-center gap-2 bg-white/[0.015] px-3 py-2.5">
        <ChevronDown className="size-3.5 shrink-0 text-white/75" />
        <span className="text-[10px] font-semibold text-white/90">{label}</span>
        <span className="ml-auto font-mono text-[8px] text-white/30">
          {selected}/{total}
        </span>
      </div>
      {children}
    </div>
  )
}

function CloudflarePermissionRow({
  description,
  edit = false,
  name,
  read = false,
}: {
  description: string
  edit?: boolean
  name: string
  read?: boolean
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-t border-dashed border-white/10 px-3 py-2.5 sm:grid-cols-[minmax(8rem,0.8fr)_minmax(10rem,1.25fr)_auto] sm:items-center">
      <p className="col-start-1 row-start-1 truncate text-[10px] font-medium text-white/85">
        {name}
      </p>
      <p className="col-start-1 row-start-2 mt-0.5 truncate text-[8px] text-white/35 sm:col-start-2 sm:row-start-1 sm:mt-0">
        {description}
      </p>
      <div className="col-start-2 row-span-2 row-start-1 flex items-center rounded-md border border-white/12 bg-black/25 p-1 sm:col-start-3 sm:row-span-1">
        <PermissionAccess active={read} label="Read" />
        <PermissionAccess active={edit} label="Edit" />
      </div>
    </div>
  )
}

function PermissionAccess({
  active,
  label,
}: {
  active: boolean
  label: string
}) {
  return (
    <span
      className={
        active
          ? "flex items-center gap-1.5 rounded px-1.5 py-1 text-[9px] font-medium text-white/90"
          : "flex items-center gap-1.5 rounded px-1.5 py-1 text-[9px] text-white/30"
      }
    >
      <span
        className={
          active
            ? "grid size-3.5 place-items-center rounded-[3px] border border-white bg-white text-black"
            : "size-3.5 rounded-[3px] border border-white/15 bg-black/20"
        }
      >
        {active ? <Check className="size-2.5" strokeWidth={3} /> : null}
      </span>
      {label}
      <span className="sr-only">{active ? "selected" : "not selected"}</span>
    </span>
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
