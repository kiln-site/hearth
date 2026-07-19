import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  ArrowRight,
  Check,
  Clock3,
  LoaderCircle,
  LogOut,
  Server,
  ShieldCheck,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { HearthMark } from "@/components/hearth-mark"
import { authClient } from "@/lib/auth-client"
import type { AuthenticatedUser } from "@/lib/auth-session"
import type { getInvitationPreview } from "@/server/access"
import { acceptAccessInvitation } from "@/server/access"
import { disableDevelopmentBypass } from "@/server/auth"

type InvitationPreview = NonNullable<
  Awaited<ReturnType<typeof getInvitationPreview>>
>

export function InvitationPage({
  preview,
  token,
  user,
}: {
  preview: InvitationPreview | null
  token: string
  user: AuthenticatedUser | null
}) {
  const acceptInvitationMutation = useMutation({
    mutationFn: acceptAccessInvitation,
  })
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [accepted, setAccepted] = React.useState(false)
  const invitePath = `/invite?token=${encodeURIComponent(token)}`

  async function accept() {
    setPending(true)
    setError(null)
    try {
      await acceptInvitationMutation.mutateAsync({ data: { token } })
      setAccepted(true)
      window.setTimeout(() => window.location.assign("/"), 700)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not accept invitation"
      )
      setPending(false)
    }
  }

  async function signOut() {
    if (user?.isDevelopmentBypass) await disableDevelopmentBypass()
    else await authClient.signOut()
    window.location.assign(invitePath)
  }

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-background px-6 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,oklch(0.55_0.03_55/0.035)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0.55_0.03_55/0.028)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_70%_70%_at_50%_40%,black,transparent)] bg-[size:64px_64px]" />
      <section className="relative w-full max-w-md rounded-2xl border border-border/70 bg-card/45 p-6 shadow-2xl shadow-black/20 backdrop-blur-sm sm:p-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 font-heading text-sm font-semibold">
            <HearthMark className="size-8" /> Kiln
          </div>
          {preview ? (
            <span className="flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[9px] tracking-wide text-muted-foreground uppercase">
              <Clock3 className="size-3" /> 7-day invite
            </span>
          ) : null}
        </div>

        {!preview ? (
          <div className="py-12 text-center">
            <ShieldCheck className="mx-auto size-7 text-muted-foreground" />
            <h1 className="mt-5 font-heading text-2xl font-semibold tracking-[-0.04em]">
              Invitation unavailable
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This invitation has expired, was revoked, or has already been
              used.
            </p>
            <Button className="mt-6" variant="outline" asChild>
              <Link to="/">Return to Kiln</Link>
            </Button>
          </div>
        ) : accepted ? (
          <div className="py-12 text-center">
            <div className="mx-auto grid size-12 place-items-center bg-emerald-500/12 text-emerald-400">
              <Check className="size-5" />
            </div>
            <h1 className="mt-5 font-heading text-2xl font-semibold tracking-[-0.04em]">
              Access granted
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Opening your control plane…
            </p>
          </div>
        ) : (
          <>
            <div className="mt-10">
              <p className="font-mono text-[10px] tracking-[0.16em] text-primary uppercase">
                Access request
              </p>
              <h1 className="mt-2 font-heading text-3xl font-semibold tracking-[-0.05em]">
                Join {preview.relayName}
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                You&apos;ve been invited as{" "}
                <span className="font-medium text-foreground">
                  {preview.role}
                </span>
                {preview.instanceId
                  ? " on one managed instance"
                  : " across this Relay"}
                .
              </p>
            </div>

            <div className="mt-6 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl border bg-background/60 p-4">
              <Server className="mt-0.5 size-4 text-primary" />
              <span className="text-xs font-medium">{preview.relayName}</span>
              <span />
              <span className="font-mono text-[10px] text-muted-foreground">
                {preview.instanceId
                  ? `Instance · ${preview.instanceId.slice(0, 10)}`
                  : "Entire Relay"}{" "}
                · {preview.role}
              </span>
            </div>

            {error ? (
              <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}

            {user ? (
              user.email.toLowerCase() === preview.email.toLowerCase() ? (
                <Button
                  className="mt-6 h-11 w-full"
                  disabled={pending}
                  onClick={() => void accept()}
                >
                  {pending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <ShieldCheck />
                  )}
                  Accept invitation
                </Button>
              ) : (
                <div className="mt-6">
                  <p className="text-xs leading-5 text-muted-foreground">
                    This invitation is for{" "}
                    <strong className="font-medium text-foreground">
                      {preview.email}
                    </strong>
                    , but you&apos;re signed in as {user.email}.
                  </p>
                  <Button
                    className="mt-4 w-full"
                    variant="outline"
                    onClick={() => void signOut()}
                  >
                    <LogOut /> Sign out and continue
                  </Button>
                </div>
              )
            ) : (
              <div className="mt-6 grid gap-2">
                <Button className="h-11" asChild>
                  <Link to="/" search={{ redirect: invitePath }}>
                    Sign in to accept <ArrowRight />
                  </Link>
                </Button>
                <Button className="h-11" variant="outline" asChild>
                  <Link
                    to="/"
                    search={{
                      email: preview.email,
                      redirect: invitePath,
                      signup: true,
                    }}
                  >
                    Create an account
                  </Link>
                </Button>
              </div>
            )}
            <p className="mt-5 text-center text-[10px] leading-4 text-muted-foreground/70">
              Only the verified address {preview.email} can accept this
              invitation.
            </p>
          </>
        )}
      </section>
    </main>
  )
}
