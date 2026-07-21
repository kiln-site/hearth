import * as React from "react"
import * as Sentry from "@sentry/tanstackstart-react"
import { useRouter } from "@tanstack/react-router"
import type { AnyRouter } from "@tanstack/react-router"
import { ArrowLeft, RefreshCw, TriangleAlert } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { HearthMark } from "@/components/hearth-mark"

const reportedErrors = new WeakSet<Error>()

interface AppErrorPageProps {
  error: Error
  reset: () => void
}

export function AppErrorPage({ error, reset }: AppErrorPageProps) {
  React.useEffect(() => {
    if (reportedErrors.has(error)) return
    reportedErrors.add(error)
    Sentry.captureException(error)
  }, [error])

  return (
    <StatusPage
      code="500"
      eyebrow="Unexpected application fault"
      title="Your Kiln ran out of fuel"
      description="Hearth could not finish loading this view"
      actions={
        <>
          <Button
            onClick={() => {
              reset()
              window.location.reload()
            }}
          >
            <RefreshCw /> Try again
          </Button>
          <Button variant="outline" asChild>
            <a href="/">
              <ArrowLeft /> Return to Kiln
            </a>
          </Button>
        </>
      }
      detail={import.meta.env.DEV ? error.message : undefined}
    />
  )
}

export function AppRouterErrorBoundary({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  return (
    <AppRouterErrorBoundaryImpl router={router}>
      {children}
    </AppRouterErrorBoundaryImpl>
  )
}

class AppRouterErrorBoundaryImpl extends React.Component<
  { children: React.ReactNode; router: AnyRouter },
  { error: Error | null }
> {
  state = { error: null }
  unsubscribeFromNavigation: (() => void) | null = null

  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }

  componentDidMount() {
    this.unsubscribeFromNavigation = this.props.router.subscribe(
      "onBeforeNavigate",
      () => {
        if (this.state.error) this.setState({ error: null })
      }
    )
  }

  componentWillUnmount() {
    this.unsubscribeFromNavigation?.()
  }

  render() {
    return this.state.error ? (
      <AppErrorPage
        error={this.state.error}
        reset={() => this.setState({ error: null })}
      />
    ) : (
      this.props.children
    )
  }
}

export function AppNotFoundPage() {
  return (
    <StatusPage
      code="404"
      eyebrow="Unknown route"
      title="There's nothing firing here."
      description="We can't find the page you're looking for"
      actions={
        <Button asChild>
          <a href="/">
            <ArrowLeft /> Return to Kiln
          </a>
        </Button>
      }
    />
  )
}

function StatusPage({
  code,
  eyebrow,
  title,
  description,
  actions,
  detail,
}: {
  code: string
  eyebrow: string
  title: string
  description: string
  actions: React.ReactNode
  detail?: string
}) {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-background px-5 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/2 left-1/2 h-[38rem] w-[38rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/4 blur-3xl" />
        <div className="absolute inset-x-0 top-1/2 border-t border-border/35" />
        <div className="absolute inset-y-0 left-1/2 border-l border-border/35" />
      </div>

      <section className="relative w-full max-w-2xl border border-border/80 bg-card/80 shadow-2xl shadow-black/25 backdrop-blur-sm">
        <header className="flex items-center justify-between border-b border-border/70 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <HearthMark className="size-7" />
            <span className="font-heading text-sm font-semibold">Kiln</span>
          </div>
          <span className="font-mono text-[9px] tracking-[0.18em] text-destructive uppercase">
            Fault / {code}
          </span>
        </header>

        <div className="grid sm:grid-cols-[1fr_9rem]">
          <div className="p-6 sm:p-9">
            <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.16em] text-primary uppercase">
              <TriangleAlert className="size-3.5" />
              {eyebrow}
            </div>
            <h1 className="mt-5 max-w-md font-heading text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
              {title}
            </h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">
              {description}
            </p>
            {detail ? (
              <pre className="mt-5 max-h-32 overflow-auto border border-destructive/20 bg-destructive/5 p-3 font-mono text-[10px] leading-5 whitespace-pre-wrap text-destructive/85">
                {detail}
              </pre>
            ) : null}
            <div className="mt-7 flex flex-col gap-2 sm:flex-row">
              {actions}
            </div>
          </div>
          <div className="relative hidden overflow-hidden border-l border-border/70 bg-muted/10 sm:block">
            <span className="absolute -right-3 bottom-0 font-mono text-[7.5rem] leading-[0.72] font-bold tracking-[-0.12em] text-foreground/3 [writing-mode:vertical-rl]">
              {code}
            </span>
            <div className="absolute top-5 left-1/2 h-24 border-l border-primary/30" />
            <span className="absolute top-4 left-1/2 size-1.5 -translate-x-1/2 bg-primary shadow-[0_0_16px_var(--primary)]" />
          </div>
        </div>

        <footer className="border-t border-border/70 bg-muted/10 px-5 py-3 font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
          Hearth interface / protected recovery state
        </footer>
      </section>
    </main>
  )
}
