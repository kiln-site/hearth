import * as React from "react"
import { Check, KeyRound, LoaderCircle, ShieldAlert } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import { HearthMark } from "@/components/hearth-mark"
import { authClient } from "@/lib/auth-client"

export function ResetPasswordPage({
  token,
  tokenError,
}: {
  token?: string
  tokenError?: string
}) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [complete, setComplete] = React.useState(false)
  const invalidToken = !token || Boolean(tokenError)

  async function resetPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token) return

    const form = new FormData(event.currentTarget)
    const password = String(form.get("password") ?? "")
    const confirmation = String(form.get("confirmPassword") ?? "")
    setError(null)

    if (password.length < 12) {
      setError("Use at least 12 characters for your new password")
      return
    }
    if (password !== confirmation) {
      setError("The passwords do not match")
      return
    }

    setPending(true)
    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token,
      })
      if (result.error) {
        throw new Error(
          result.error.message ||
            result.error.statusText ||
            "This reset link is no longer valid"
        )
      }
      setComplete(true)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not reset password"
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background p-6 md:p-10">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,oklch(0.55_0.03_55/0.035)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0.55_0.03_55/0.028)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_70%_70%_at_50%_40%,black,transparent)] bg-[size:64px_64px]" />
      <div className="pointer-events-none absolute top-[22%] left-1/2 h-44 w-72 -translate-x-1/2 rounded-full bg-primary/5 blur-[100px]" />

      <section className="relative w-full max-w-sm">
        {invalidToken ? (
          <RecoveryState
            icon={ShieldAlert}
            eyebrow="Link unavailable"
            title="Request a new link"
            description="This password reset link is invalid or has expired. Request another one to continue securely."
            action="Request another reset"
            href="/?forgot=true"
          />
        ) : complete ? (
          <RecoveryState
            icon={Check}
            eyebrow="Password updated"
            title="You’re ready to sign in"
            description="Your new password is active and every existing Kiln session has been signed out."
            action="Back to sign in"
            href="/"
          />
        ) : (
          <>
            <div className="mb-8 flex flex-col items-center text-center">
              <HearthMark className="size-9 rounded-xl" />
              <h1 className="mt-5 font-heading text-2xl font-semibold tracking-[-0.04em]">
                Choose a new password
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Use something unique that you don’t use for another account.
              </p>
            </div>

            {error ? (
              <div
                role="alert"
                className="mb-5 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-xs leading-5 text-red-300"
              >
                {error}
              </div>
            ) : null}

            <form className="grid gap-4" onSubmit={resetPassword}>
              <PasswordField label="New password" htmlFor="new-password">
                <Input
                  id="new-password"
                  name="password"
                  type="password"
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  placeholder="••••••••••••"
                  required
                  autoFocus
                  className="h-11 bg-card/60 font-mono"
                />
                <span className="text-[10px] leading-4 text-muted-foreground">
                  At least 12 characters
                </span>
              </PasswordField>
              <PasswordField
                label="Confirm new password"
                htmlFor="confirm-password"
              >
                <Input
                  id="confirm-password"
                  name="confirmPassword"
                  type="password"
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  placeholder="••••••••••••"
                  required
                  className="h-11 bg-card/60 font-mono"
                />
              </PasswordField>
              <Button
                type="submit"
                className="mt-1 h-11 w-full"
                disabled={pending}
              >
                {pending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <KeyRound />
                )}
                {pending ? "Updating…" : "Update password"}
              </Button>
            </form>
            <Button
              variant="ghost"
              className="mt-2 h-10 w-full text-muted-foreground hover:text-foreground"
              asChild
            >
              <a href="/">Cancel and return to sign in</a>
            </Button>
          </>
        )}
      </section>
    </main>
  )
}

function PasswordField({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-[11px] font-medium text-foreground/85"
      >
        {label}
      </label>
      {children}
    </div>
  )
}

function RecoveryState({
  icon: Icon,
  eyebrow,
  title,
  description,
  action,
  href,
}: {
  icon: typeof Check
  eyebrow: string
  title: string
  description: string
  action: string
  href: string
}) {
  return (
    <div>
      <div className="grid size-11 place-items-center rounded-xl border border-primary/25 bg-primary/8 text-primary">
        <Icon className="size-5" />
      </div>
      <p className="mt-7 font-mono text-[10px] tracking-[0.17em] text-primary uppercase">
        {eyebrow}
      </p>
      <h1 className="mt-2 font-heading text-3xl font-semibold tracking-[-0.045em]">
        {title}
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      <Button className="mt-6 h-11 w-full" asChild>
        <a href={href}>{action}</a>
      </Button>
    </div>
  )
}
