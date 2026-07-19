import * as React from "react"
import { ArrowLeft, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import { HearthMark } from "@/components/hearth-mark"
import { authClient } from "@/lib/auth-client"

export function TwoFactorPage() {
  const [method, setMethod] = React.useState<"totp" | "backup">("totp")
  const [code, setCode] = React.useState("")
  const [trustDevice, setTrustDevice] = React.useState(true)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    const result =
      method === "totp"
        ? await authClient.twoFactor.verifyTotp({ code, trustDevice })
        : await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
    setPending(false)
    if (result.error) {
      setError(result.error.message || "That code could not be verified")
      return
    }
    const returnTo = sessionStorage.getItem("kiln:auth:return") || "/"
    sessionStorage.removeItem("kiln:auth:return")
    window.location.assign(returnTo.startsWith("/") ? returnTo : "/")
  }

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-background px-5 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,oklch(0.68_0.17_47/0.12),transparent_34rem)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,oklch(0.55_0.03_55/0.04)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0.55_0.03_55/0.03)_1px,transparent_1px)] bg-[size:56px_56px]" />

      <section className="relative w-full max-w-sm rounded-2xl border bg-card/80 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <HearthMark />
            <span className="font-heading text-sm font-semibold">Kiln</span>
          </div>
          <span className="border border-primary/20 bg-primary/8 px-2 py-1 font-mono text-[8px] tracking-widest text-primary uppercase">
            Step 2 of 2
          </span>
        </div>

        <div className="mt-9 grid size-10 place-items-center rounded-xl border border-primary/25 bg-primary/8 text-primary">
          <ShieldCheck className="size-5" />
        </div>
        <h1 className="mt-5 font-heading text-2xl font-semibold tracking-[-0.04em]">
          Confirm it’s you
        </h1>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {method === "totp"
            ? "Enter the rotating code from your authenticator app."
            : "Use one of the single-use recovery codes you saved."}
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-xs text-red-300"
          >
            {error}
          </p>
        ) : null}

        <form className="mt-5 grid gap-4" onSubmit={verify}>
          <label className="grid gap-1.5" htmlFor="two-factor-code">
            <span className="text-[11px] font-medium">
              {method === "totp" ? "Authenticator code" : "Recovery code"}
            </span>
            <Input
              id="two-factor-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode={method === "totp" ? "numeric" : "text"}
              autoComplete="one-time-code"
              placeholder={method === "totp" ? "000 000" : "XXXX-XXXXXX"}
              className="h-12 bg-background/70 text-center font-mono text-lg tracking-[0.28em]"
              required
              autoFocus
            />
          </label>

          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={trustDevice}
              onChange={(event) => setTrustDevice(event.target.checked)}
              className="size-3.5 accent-primary"
            />
            Trust this device for 30 days
          </label>

          <Button className="h-11" disabled={pending || !code.trim()}>
            {pending ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
            Verify and continue
          </Button>
        </form>

        <button
          type="button"
          className="mx-auto mt-5 block text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            setMethod(method === "totp" ? "backup" : "totp")
            setCode("")
            setError(null)
          }}
        >
          {method === "totp"
            ? "Use a recovery code instead"
            : "Use an authenticator code instead"}
        </button>

        <a
          href="/"
          className="mt-7 flex items-center justify-center gap-1.5 border-t pt-5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Cancel and return to login
        </a>
      </section>
    </main>
  )
}
