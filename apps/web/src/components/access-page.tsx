import * as React from "react"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { RelayInstance } from "@workspace/contracts"
import {
  Check,
  CircleAlert,
  Clock3,
  LoaderCircle,
  MailPlus,
  Server,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import { GlobalPageToolbar } from "@/components/global-page-toolbar"
import type { AccessRole } from "@/lib/permissions"
import { accessRoleDetails, accessRoles } from "@/lib/permissions"
import { accessOverviewQueryOptions, queryKeys } from "@/lib/query-options"
import {
  createAccessInvitation,
  removeAccessGrant,
  revokeAccessInvitation,
  updateAccessGrant,
} from "@/server/access"

export function AccessPage({ instances }: { instances: Array<RelayInstance> }) {
  const queryClient = useQueryClient()
  const { data: overview } = useSuspenseQuery(accessOverviewQueryOptions())
  const inviteMutation = useMutation({ mutationFn: createAccessInvitation })
  const updateGrantMutation = useMutation({ mutationFn: updateAccessGrant })
  const removeGrantMutation = useMutation({ mutationFn: removeAccessGrant })
  const revokeInvitationMutation = useMutation({
    mutationFn: revokeAccessInvitation,
  })
  const [pending, setPending] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [inviteLink, setInviteLink] = React.useState<string | null>(null)
  const [form, setForm] = React.useState({
    email: "",
    resource: "relay",
    role: "operator" as AccessRole,
  })
  const assignableRoles = overview.canManageOwners
    ? accessRoles
    : accessRoles.filter((role) => role !== "owner")

  async function refreshOverview() {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.access.overview,
    })
  }

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending("invite")
    setError(null)
    setMessage(null)
    setInviteLink(null)
    const instance = instances.find((item) => item.id === form.resource)
    try {
      const result = await inviteMutation.mutateAsync({
        data: {
          email: form.email,
          instanceId: instance?.id ?? null,
          resourceName: instance?.name ?? overview.relay.name,
          role: form.role,
        },
      })
      setMessage(
        result.inviteUrl
          ? `Invitation created for ${form.email}. Copy the link below.`
          : `Invitation sent to ${form.email}`
      )
      setInviteLink(result.inviteUrl)
      setForm((value) => ({ ...value, email: "" }))
      await refreshOverview()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not send invitation"
      )
    } finally {
      setPending(null)
    }
  }

  async function changeRole(id: string, role: AccessRole) {
    setPending(`grant:${id}`)
    setError(null)
    try {
      await updateGrantMutation.mutateAsync({ data: { id, role } })
      await refreshOverview()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update role")
    } finally {
      setPending(null)
    }
  }

  async function removeGrant(id: string) {
    setPending(`grant:${id}`)
    setError(null)
    try {
      await removeGrantMutation.mutateAsync({ data: { id } })
      await refreshOverview()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not remove access"
      )
    } finally {
      setPending(null)
    }
  }

  async function revokeInvitation(id: string) {
    setPending(`invite:${id}`)
    setError(null)
    try {
      await revokeInvitationMutation.mutateAsync({ data: { id } })
      await refreshOverview()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not revoke invitation"
      )
    } finally {
      setPending(null)
    }
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-background">
      <GlobalPageToolbar label="Administration / Access" />

      <div className="mx-auto max-w-6xl px-5 py-10">
        <p className="font-mono text-[10px] tracking-[0.18em] text-primary uppercase">
          Identity & access
        </p>
        <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-[-0.045em]">
              Who can operate {overview.relay.name}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Grant the least access someone needs, across the Relay or on one
              instance.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-card/45 px-3 py-2 font-mono text-[10px] text-muted-foreground">
            <ShieldCheck className="size-3.5 text-primary" /> Permission checks
            are enforced server-side
          </div>
        </div>

        {error || message ? (
          <div
            className={`mt-5 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${error ? "border-destructive/30 bg-destructive/8 text-destructive" : "border-emerald-500/25 bg-emerald-500/8 text-emerald-300"}`}
          >
            {error ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
            ) : (
              <Check className="mt-0.5 size-4 shrink-0" />
            )}
            {error ?? message}
          </div>
        ) : null}

        {inviteLink ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg border bg-card/45 p-2">
            <code className="min-w-0 flex-1 truncate px-2 font-mono text-[10px] text-muted-foreground">
              {inviteLink}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void navigator.clipboard.writeText(inviteLink)}
            >
              Copy link
            </Button>
          </div>
        ) : null}

        <div className="mt-7 grid gap-5 lg:grid-cols-[1fr_21rem]">
          <div className="space-y-5">
            <section className="overflow-hidden rounded-xl border bg-card/40">
              <div className="flex items-center gap-3 border-b px-4 py-3">
                <Users className="size-4 text-primary" />
                <div>
                  <h2 className="text-sm font-semibold">Active access</h2>
                  <p className="text-[10px] text-muted-foreground">
                    Roles translate into explicit console, file, power,
                    settings, and member permissions.
                  </p>
                </div>
              </div>
              <div className="divide-y">
                {overview.grants.length ? (
                  overview.grants.map((grant) => {
                    const instance = instances.find(
                      (item) => item.id === grant.resourceId
                    )
                    return (
                      <div
                        key={grant.id}
                        className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center"
                      >
                        <div className="grid size-8 shrink-0 place-items-center rounded-lg border bg-background text-muted-foreground">
                          {grant.resourceType === "relay" ? (
                            <ShieldCheck className="size-3.5" />
                          ) : (
                            <Server className="size-3.5" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold">
                            {grant.name}{" "}
                            <span className="font-normal text-muted-foreground">
                              · {grant.email}
                            </span>
                          </p>
                          <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">
                            {grant.resourceType === "relay"
                              ? `All instances on ${overview.relay.name}`
                              : (instance?.name ?? grant.resourceId)}
                          </p>
                        </div>
                        <select
                          aria-label={`Role for ${grant.email}`}
                          value={grant.role}
                          disabled={pending !== null}
                          className="h-8 rounded-md border border-input bg-background px-2 text-[11px] outline-none focus:border-ring"
                          onChange={(event) =>
                            void changeRole(
                              grant.id,
                              event.target.value as AccessRole
                            )
                          }
                        >
                          {assignableRoles.map((role) => (
                            <option key={role} value={role}>
                              {accessRoleDetails[role].label}
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Remove ${grant.email}`}
                          disabled={pending !== null}
                          onClick={() => void removeGrant(grant.id)}
                        >
                          {pending === `grant:${grant.id}` ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <Trash2 />
                          )}
                        </Button>
                      </div>
                    )
                  })
                ) : (
                  <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                    No scoped members yet. Platform admins still retain access.
                  </p>
                )}
              </div>
            </section>

            {overview.invitations.length ? (
              <section className="overflow-hidden rounded-xl border bg-card/40">
                <div className="flex items-center gap-3 border-b px-4 py-3">
                  <Clock3 className="size-4 text-primary" />
                  <h2 className="text-sm font-semibold">Pending invitations</h2>
                </div>
                <div className="divide-y">
                  {overview.invitations.map((invitation) => {
                    const instance = instances.find(
                      (item) => item.id === invitation.instanceId
                    )
                    return (
                      <div
                        key={invitation.id}
                        className="flex items-center gap-3 px-4 py-3.5"
                      >
                        <MailPlus className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">
                            {invitation.email}
                          </p>
                          <p className="mt-1 font-mono text-[9px] text-muted-foreground">
                            {instance?.name ?? "Entire Relay"} ·{" "}
                            {invitation.role} · expires{" "}
                            {new Date(
                              invitation.expiresAt
                            ).toLocaleDateString()}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Revoke invitation for ${invitation.email}`}
                          disabled={pending !== null}
                          onClick={() => void revokeInvitation(invitation.id)}
                        >
                          {pending === `invite:${invitation.id}` ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <Trash2 />
                          )}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </section>
            ) : null}
          </div>

          <section className="h-fit rounded-xl border bg-card/45 p-4 lg:sticky lg:top-5">
            <div className="flex items-center gap-2">
              <MailPlus className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">Invite someone</h2>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              The link is bound to this email, expires in seven days, and
              requires email verification.
            </p>
            <form className="mt-5 space-y-4" onSubmit={invite}>
              <Field label="Email address">
                <Input
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm((value) => ({
                      ...value,
                      email: event.target.value,
                    }))
                  }
                  placeholder="operator@example.com"
                  required
                />
              </Field>
              <Field label="Access scope">
                <select
                  value={form.resource}
                  onChange={(event) =>
                    setForm((value) => ({
                      ...value,
                      resource: event.target.value,
                    }))
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-ring"
                >
                  <option value="relay">
                    Entire Relay · {overview.relay.name}
                  </option>
                  {instances.map((instance) => (
                    <option key={instance.id} value={instance.id}>
                      Instance · {instance.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Role">
                <select
                  value={form.role}
                  onChange={(event) =>
                    setForm((value) => ({
                      ...value,
                      role: event.target.value as AccessRole,
                    }))
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-ring"
                >
                  {assignableRoles.map((role) => (
                    <option key={role} value={role}>
                      {accessRoleDetails[role].label}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                  {accessRoleDetails[form.role].description}
                </p>
              </Field>
              <Button className="h-10 w-full" disabled={pending !== null}>
                {pending === "invite" ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <MailPlus />
                )}
                Send invitation
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
    <label className="block text-[10px] font-medium text-muted-foreground">
      <span className="mb-1.5 block">{label}</span>
      {children}
    </label>
  )
}
