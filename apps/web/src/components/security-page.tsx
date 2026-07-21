import * as React from "react"
import QRCode from "react-qr-code"
import {
  Check,
  Clipboard,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Trash2,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import { authClient } from "@/lib/auth-client"
import type { AuthenticatedUser } from "@/lib/auth-session"

const securityDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
})

interface SetupState {
  backupCodes: Array<string>
  totpURI: string
}

export function SecurityPage({ user }: { user: AuthenticatedUser }) {
  if (user.isDevelopmentBypass) {
    return (
      <SecurityShell user={user}>
        <div className="rounded-xl border border-dashed bg-card/50 p-6 text-center">
          <LockKeyhole className="mx-auto size-6 text-primary" />
          <h2 className="mt-4 font-heading text-lg font-semibold">
            Sign in to manage security
          </h2>
          <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted-foreground">
            The development bypass has no persisted account. Sign out and use a
            verified account to register authenticators or passkeys.
          </p>
        </div>
      </SecurityShell>
    )
  }

  return <AccountSecurityPage user={user} />
}

function AccountSecurityPage({ user }: { user: AuthenticatedUser }) {
  const session = authClient.useSession()
  const passkeys = authClient.useListPasskeys()
  const [password, setPassword] = React.useState("")
  const [setup, setSetup] = React.useState<SetupState | null>(null)
  const [totpCode, setTotpCode] = React.useState("")
  const [passkeyName, setPasskeyName] = React.useState("")
  const [pending, setPending] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const twoFactorEnabled = Boolean(
    (session.data?.user as { twoFactorEnabled?: boolean } | undefined)
      ?.twoFactorEnabled
  )

  async function beginTwoFactor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending("enable-2fa")
    resetFeedback()
    const result = await authClient.twoFactor.enable({ password })
    setPending(null)
    if (result.error) {
      setError(result.error.message || "Could not begin 2FA setup")
      return
    }
    setSetup(result.data)
  }

  async function confirmTwoFactor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending("verify-2fa")
    resetFeedback()
    const result = await authClient.twoFactor.verifyTotp({ code: totpCode })
    setPending(null)
    if (result.error) {
      setError(result.error.message || "The authenticator code is invalid")
      return
    }
    setMessage("Authenticator app enabled")
    setPassword("")
    setTotpCode("")
    await session.refetch()
  }

  async function disableTwoFactor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending("disable-2fa")
    resetFeedback()
    const result = await authClient.twoFactor.disable({ password })
    setPending(null)
    if (result.error) {
      setError(result.error.message || "Could not disable 2FA")
      return
    }
    setPassword("")
    setSetup(null)
    setMessage("Authenticator app disabled")
    await session.refetch()
  }

  async function addPasskey() {
    setPending("passkey")
    resetFeedback()
    const result = await authClient.passkey.addPasskey({
      name: passkeyName.trim() || "Kiln passkey",
    })
    setPending(null)
    if (result.error) {
      setError(result.error.message || "Could not add the passkey")
      return
    }
    setPasskeyName("")
    setMessage("Passkey added")
    await passkeys.refetch()
  }

  async function deletePasskey(id: string) {
    setPending(id)
    resetFeedback()
    const result = await authClient.passkey.deletePasskey({ id })
    setPending(null)
    if (result.error) {
      setError(result.error.message || "Could not remove the passkey")
      return
    }
    setMessage("Passkey removed")
    await passkeys.refetch()
  }

  function resetFeedback() {
    setError(null)
    setMessage(null)
  }

  return (
    <SecurityShell user={user}>
      {message ? (
        <Feedback success>{message}</Feedback>
      ) : error ? (
        <Feedback>{error}</Feedback>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <SecurityCard
          icon={ShieldCheck}
          eyebrow="Second factor"
          title="Authenticator app"
          status={twoFactorEnabled ? "Enabled" : "Not configured"}
        >
          {setup && !twoFactorEnabled ? (
            <div className="mt-5 grid gap-5 sm:grid-cols-[9rem_1fr]">
              <div className="rounded-xl bg-white p-3">
                <QRCode value={setup.totpURI} className="h-auto w-full" />
              </div>
              <div className="min-w-0">
                <p className="text-xs leading-5 text-muted-foreground">
                  Scan with Authy, 1Password, Google Authenticator, or any TOTP
                  app. Then enter the current six-digit code.
                </p>
                <p className="mt-3 truncate rounded-md border bg-background px-2 py-1.5 font-mono text-[9px] text-muted-foreground">
                  {readTotpSecret(setup.totpURI)}
                </p>
                <form className="mt-3 flex gap-2" onSubmit={confirmTwoFactor}>
                  <Input
                    value={totpCode}
                    onChange={(event) => setTotpCode(event.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    className="font-mono tracking-[0.2em]"
                    required
                  />
                  <Button disabled={pending !== null}>Verify</Button>
                </form>
              </div>
              <div className="sm:col-span-2">
                <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Recovery codes — save these now
                </p>
                <div className="mt-2 grid grid-cols-2 gap-1.5 rounded-lg border bg-background p-3 sm:grid-cols-5">
                  {setup.backupCodes.map((code) => (
                    <code
                      key={code}
                      className="text-center font-mono text-[10px] text-foreground/80"
                    >
                      {code}
                    </code>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      setup.backupCodes.join("\n")
                    )
                  }
                >
                  <Clipboard /> Copy recovery codes
                </Button>
              </div>
            </div>
          ) : (
            <form
              className="mt-5 flex flex-col gap-3 sm:flex-row"
              onSubmit={twoFactorEnabled ? disableTwoFactor : beginTwoFactor}
            >
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="Confirm your password"
                required
                className="bg-background"
              />
              <Button
                variant={twoFactorEnabled ? "outline" : "default"}
                disabled={pending !== null}
                className="shrink-0"
              >
                {pending?.includes("2fa") ? (
                  <LoaderCircle className="animate-spin" />
                ) : twoFactorEnabled ? (
                  <LockKeyhole />
                ) : (
                  <ShieldCheck />
                )}
                {twoFactorEnabled ? "Disable" : "Set up"}
              </Button>
            </form>
          )}
        </SecurityCard>

        <SecurityCard
          icon={Fingerprint}
          eyebrow="Passwordless"
          title="Passkeys"
          status={`${passkeys.data?.length ?? 0} registered`}
        >
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            Use Touch ID, Windows Hello, a phone, or a hardware security key to
            sign in without entering your password.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Input
              value={passkeyName}
              onChange={(event) => setPasskeyName(event.target.value)}
              placeholder="Passkey name, e.g. MacBook"
              className="bg-background"
            />
            <Button
              type="button"
              disabled={pending !== null}
              className="shrink-0"
              onClick={addPasskey}
            >
              {pending === "passkey" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <KeyRound />
              )}
              Add passkey
            </Button>
          </div>
          <div className="mt-4 divide-y overflow-hidden rounded-lg border bg-background/55">
            {passkeys.data?.length ? (
              passkeys.data.map((passkey) => (
                <div
                  key={passkey.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <Fingerprint className="size-4 shrink-0 text-primary/75" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {passkey.name || "Unnamed passkey"}
                    </span>
                    <span className="block font-mono text-[9px] text-muted-foreground">
                      Added {formatDate(passkey.createdAt)}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${passkey.name || "passkey"}`}
                    disabled={pending !== null}
                    onClick={() => deletePasskey(passkey.id)}
                  >
                    {pending === passkey.id ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Trash2 />
                    )}
                  </Button>
                </div>
              ))
            ) : (
              <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                No passkeys registered yet
              </p>
            )}
          </div>
        </SecurityCard>
      </div>
    </SecurityShell>
  )
}

function SecurityShell({
  user,
  children,
}: {
  user: AuthenticatedUser
  children: React.ReactNode
}) {
  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
        <p className="font-mono text-[10px] tracking-[0.17em] text-primary uppercase">
          Account security
        </p>
        <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-[-0.045em]">
              Protect your access
            </h1>
            <p className="mt-2 text-xs text-muted-foreground">
              Signed in as {user.email}
            </p>
          </div>
          <span className="flex items-center gap-1.5 font-mono text-[9px] text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-400" /> VERIFIED
            EMAIL
          </span>
        </div>
        <div className="mt-8">{children}</div>
      </div>
    </div>
  )
}

function SecurityCard({
  icon: Icon,
  eyebrow,
  title,
  status,
  children,
}: {
  icon: typeof ShieldCheck
  eyebrow: string
  title: string
  status: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border bg-card/65 p-5 shadow-sm shadow-black/10 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <div className="grid size-9 place-items-center rounded-lg border border-primary/20 bg-primary/7 text-primary">
            <Icon className="size-4" />
          </div>
          <div>
            <p className="font-mono text-[8px] tracking-widest text-muted-foreground uppercase">
              {eyebrow}
            </p>
            <h2 className="mt-0.5 text-sm font-semibold">{title}</h2>
          </div>
        </div>
        <span className="border bg-background px-2 py-1 font-mono text-[8px] text-muted-foreground uppercase">
          {status}
        </span>
      </div>
      {children}
    </section>
  )
}

function Feedback({
  success = false,
  children,
}: {
  success?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      role={success ? "status" : "alert"}
      className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs ${success ? "border-emerald-400/20 bg-emerald-400/7 text-emerald-300" : "border-destructive/30 bg-destructive/8 text-red-300"}`}
    >
      {success ? (
        <Check className="size-3.5" />
      ) : (
        <LockKeyhole className="size-3.5" />
      )}
      {children}
    </div>
  )
}

function readTotpSecret(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? ""
  } catch {
    return ""
  }
}

function formatDate(value?: Date | string | null): string {
  if (!value) return "recently"
  return securityDateFormatter.format(new Date(value))
}
