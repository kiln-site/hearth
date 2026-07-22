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
          const user = await requireAuthenticatedUser()
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

          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encodeRecord(first.value))
              void pump(iterator, controller, lifecycle.signal).finally(() => {
                request.signal.removeEventListener("abort", abort)
              })
            },
            cancel() {
              lifecycle.abort()
              request.signal.removeEventListener("abort", abort)
              return iterator.return(undefined).then(() => undefined)
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

async function pump(
  iterator: AsyncGenerator<unknown>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  signal: AbortSignal
): Promise<void> {
  try {
    for (;;) {
      // The upstream Relay stream is ordered, so reads must remain sequential.
      // oxlint-disable-next-line react-doctor/async-await-in-loop
      const result = await iterator.next()
      if (result.done) break
      if (signal.aborted) return
      controller.enqueue(encodeRecord(result.value))
    }
    if (!signal.aborted) controller.close()
  } catch (cause) {
    if (signal.aborted) return
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
  } finally {
    await iterator.return(undefined)
  }
}

function encodeRecord(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value)}\n`)
}
