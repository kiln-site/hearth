import * as React from "react"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { CheckCircle2, Cloud, LoaderCircle, ShieldAlert } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import { showToast } from "@workspace/ui/components/sonner"

import {
  defaultDomainBlacklistPatterns,
  domainNameSchema,
  validateBlacklistPatterns,
} from "@/lib/domain-schemas"
import { domainSettingsQueryOptions, queryKeys } from "@/lib/query-options"
import { configureDomainIntegration } from "@/server/domains"

export function DomainsPage() {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(domainSettingsQueryOptions())
  const integration = data.integration
  const [enabled, setEnabled] = React.useState(integration?.enabled ?? true)
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

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background/55 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="border border-border/80 bg-card/55 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center border border-primary/25 bg-primary/10 text-primary">
                <Cloud className="size-4" />
              </div>
              <div>
                <p className="font-mono text-[9px] tracking-[0.18em] text-primary uppercase">
                  Managed DNS
                </p>
                <h1 className="mt-1 font-heading text-xl font-semibold tracking-tight">
                  Cloudflare domains
                </h1>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                  Give every newly provisioned game server a memorable address.
                  Kiln creates DNS-only records and adds SRV routing when its
                  Brick supports it.
                </p>
              </div>
            </div>
            <DomainStatus
              enabled={integration?.enabled === true}
              verified={integration !== null}
            />
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)]">
          <form
            className="border border-border/80 bg-card/45"
            action={(form) => {
              const domain = domainNameSchema.safeParse(form.get("domain"))
              if (!domain.success) {
                showToast({
                  message: domain.error.issues[0]?.message ?? "Invalid domain",
                  type: "error",
                })
                return
              }
              let blacklistPatterns: Array<string>
              try {
                blacklistPatterns = validateBlacklistPatterns(
                  String(form.get("blacklistPatterns") ?? "")
                    .split(/\r?\n/u)
                    .map((pattern) => pattern.trim())
                    .filter(Boolean)
                )
              } catch (cause) {
                showToast({ message: errorMessage(cause), type: "error" })
                return
              }
              const token = String(form.get("apiToken") ?? "").trim()
              configure.mutate({
                data: {
                  apiToken: token || undefined,
                  blacklistPatterns,
                  domain: domain.data,
                  enabled,
                },
              })
            }}
          >
            <div className="border-b border-border/70 px-5 py-4">
              <h2 className="text-sm font-semibold">Integration</h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                The token is encrypted at rest and is never returned to the
                browser.
              </p>
            </div>
            <div className="space-y-4 p-5">
              <label className="block space-y-1.5 text-[11px] font-medium">
                Vanity domain
                <Input
                  autoCapitalize="none"
                  autoCorrect="off"
                  defaultValue={integration?.domain ?? ""}
                  name="domain"
                  placeholder="play.example.com"
                  required
                />
              </label>
              <label className="block space-y-1.5 text-[11px] font-medium">
                Cloudflare API token
                <Input
                  autoComplete="new-password"
                  minLength={20}
                  name="apiToken"
                  placeholder={
                    integration
                      ? "Leave blank to keep the existing token"
                      : "Token with Zone Read and DNS Write"
                  }
                  required={!integration}
                  type="password"
                />
              </label>
              <label className="block space-y-1.5 text-[11px] font-medium">
                Reserved name patterns
                <Textarea
                  className="min-h-32 font-mono text-xs"
                  defaultValue={(
                    integration?.blacklistPatterns ?? [
                      ...defaultDomainBlacklistPatterns,
                    ]
                  ).join("\n")}
                  name="blacklistPatterns"
                  placeholder={"^(admin|api|www)$\n^staff-"}
                />
                <span className="block text-[10px] leading-relaxed text-muted-foreground">
                  One case-insensitive regular expression per line. These
                  patterns apply to generated names and user customizations.
                </span>
              </label>
              <div className="flex items-center justify-between gap-4 border border-border/70 bg-background/35 px-3 py-3">
                <div>
                  <p className="text-xs font-medium">Automatic provisioning</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Create a vanity address with each new game server.
                  </p>
                </div>
                <Switch
                  aria-label="Enable automatic domain provisioning"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
              </div>
              {configure.error ? (
                <p className="border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {errorMessage(configure.error)}
                </p>
              ) : null}
              <div className="flex justify-end">
                <Button disabled={configure.isPending} type="submit">
                  {configure.isPending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Cloud />
                  )}
                  Verify and save
                </Button>
              </div>
            </div>
          </form>

          <aside className="space-y-4">
            <section className="border border-border/80 bg-card/45 p-4">
              <p className="font-mono text-[9px] tracking-[0.16em] text-muted-foreground uppercase">
                Current zone
              </p>
              <p className="mt-2 font-mono text-sm break-all">
                {integration?.zoneName ?? "Not connected"}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border/70 pt-4">
                <Metric
                  label="Managed servers"
                  value={String(data.managedServerCount)}
                />
                <Metric
                  label="Last verified"
                  value={
                    integration?.lastVerifiedAt
                      ? new Date(
                          integration.lastVerifiedAt
                        ).toLocaleDateString()
                      : "Never"
                  }
                />
              </dl>
            </section>
            <section className="border border-amber-400/20 bg-amber-400/5 p-4">
              <div className="flex gap-2 text-amber-100/85">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
                <div>
                  <h2 className="text-xs font-semibold">Token scope</h2>
                  <p className="mt-1 text-[11px] leading-relaxed">
                    Limit the token to Zone Read and DNS Write for the zone that
                    owns this domain. Cloudflare proxying stays off because game
                    traffic is not HTTP.
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
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
          ? "inline-flex items-center gap-1.5 border border-emerald-400/25 bg-emerald-400/8 px-2.5 py-1 font-mono text-[10px] text-emerald-300 uppercase"
          : "inline-flex items-center gap-1.5 border border-border bg-background/55 px-2.5 py-1 font-mono text-[10px] text-muted-foreground uppercase"
      }
    >
      <CheckCircle2 className="size-3" />
      {active ? "Active" : verified ? "Paused" : "Not configured"}
    </span>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-xs">{value}</dd>
    </div>
  )
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : "Could not save the domain"
}
