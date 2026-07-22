import * as Sentry from "@sentry/tanstackstart-react"
import { createFileRoute } from "@tanstack/react-router"
import { relayIdSchema } from "@workspace/contracts"

import { openHearthRelayConsoleStream } from "@/server/relay-console-proxy"
import { requireAuthenticatedUser } from "@/server/auth"

const encoder = new TextEncoder()

export const Route = createFileRoute("/api/console/$instanceId")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await requireAuthenticatedUser().catch(() => null)
        if (!user) {
          return Response.json(
            {
              code: "authentication_required",
              error: "Authentication required.",
            },
            { status: 401 }
          )
        }

        const url = new URL(request.url)
        const relayId = relayIdSchema.safeParse(url.searchParams.get("relayId"))
        const instanceId = decodeURIComponent(
          url.pathname.split("/").at(-1) ?? ""
        )
        if (!relayId.success || !instanceId || instanceId.length > 64) {
          return Response.json(
            {
              code: "invalid_console_target",
              error: "The console target is invalid.",
            },
            { status: 400 }
          )
        }

        try {
          const lifecycle = new AbortController()
          const abort = () => lifecycle.abort()
          request.signal.addEventListener("abort", abort, { once: true })
          const iterator = openHearthRelayConsoleStream({
            instanceId,
            relayId: relayId.data,
            signal: lifecycle.signal,
            user,
          })
          const first = await iterator.next()
          if (first.done) throw new Error("Relay console stream ended early")

          let firstPending = true
          let finished = false
          const finish = () => {
            if (finished) return
            finished = true
            request.signal.removeEventListener("abort", abort)
          }
          const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                if (firstPending) {
                  firstPending = false
                  controller.enqueue(encodeRecord(first.value))
                  return
                }
                const result = await iterator.next()
                if (result.done) {
                  finish()
                  controller.close()
                  return
                }
                if (!lifecycle.signal.aborted) {
                  controller.enqueue(encodeRecord(result.value))
                }
              } catch (cause) {
                finish()
                if (lifecycle.signal.aborted) {
                  controller.close()
                  return
                }
                controller.enqueue(
                  encodeRecord({
                    code: "console_proxy_interrupted",
                    message:
                      cause instanceof Error
                        ? cause.message
                        : "The Hearth console proxy was interrupted.",
                    type: "proxy.error",
                  })
                )
                controller.close()
              }
            },
            async cancel() {
              lifecycle.abort()
              finish()
              await iterator.return(undefined)
            },
          })
          return new Response(body, {
            headers: {
              "Cache-Control": "no-store, no-transform",
              Connection: "keep-alive",
              "Content-Type": "application/x-ndjson; charset=utf-8",
              "X-Accel-Buffering": "no",
            },
          })
        } catch (cause) {
          Sentry.captureException(cause, {
            tags: {
              "kiln.operation": "console.proxy.connect",
              "kiln.relay_id": relayId.data,
            },
          })
          return Response.json(
            {
              code: "console_proxy_failed",
              error:
                cause instanceof Error
                  ? cause.message
                  : "Hearth could not open the Relay console stream.",
            },
            { status: 502 }
          )
        }
      },
    },
  },
})

function encodeRecord(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value)}\n`)
}
