import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/console/$instanceId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { getAuthenticatedUserFromHeaders } =
          await import("@/lib/auth-session")
        const user = await getAuthenticatedUserFromHeaders(request.headers)
        if (!user) {
          return Response.json(
            { error: "Authentication required" },
            { status: 401 }
          )
        }
        const relayId = new URL(request.url).searchParams.get("relayId")
        if (!relayId) {
          return Response.json(
            { error: "Relay identifier is required" },
            { status: 400 }
          )
        }
        const [{ requireRelayPermission }, { listPersistedRelays }] =
          await Promise.all([
            import("@/lib/access-control"),
            import("@/lib/relay-registry"),
          ])
        const relay = (await listPersistedRelays()).find(
          (item) => item.enabled && item.id === relayId
        )
        if (!relay) {
          return Response.json(
            { error: "No Relay owns this instance" },
            { status: 503 }
          )
        }
        try {
          await requireRelayPermission({
            user,
            relayId: relay.id,
            permission: "instance.console.read",
            instanceId: params.instanceId,
          })
        } catch (cause) {
          return Response.json(
            { error: cause instanceof Error ? cause.message : "Access denied" },
            { status: 403 }
          )
        }
        const relayUrl = `${relay.useTls ? "https" : "http"}://${relay.hostname}:${relay.port}`
        const { relayHeaders } = await import("@/lib/relay-registry")
        const upstreamController = new AbortController()
        const abortUpstream = () =>
          upstreamController.abort(request.signal.reason)

        if (request.signal.aborted) abortUpstream()
        else
          request.signal.addEventListener("abort", abortUpstream, {
            once: true,
          })

        const connectTimer = setTimeout(
          () => upstreamController.abort(new Error("Relay stream timed out")),
          10_000
        )

        let upstream: Response
        try {
          upstream = await fetch(
            `${relayUrl.replace(/\/$/u, "")}/v1/instances/${encodeURIComponent(params.instanceId)}/console-stream`,
            {
              headers: {
                Accept: "application/x-ndjson",
                ...(await relayHeaders(relay)),
              },
              signal: upstreamController.signal,
            }
          )
        } catch (cause) {
          request.signal.removeEventListener("abort", abortUpstream)
          if (request.signal.aborted) {
            return new Response(null, { status: 499 })
          }
          return Response.json(
            {
              error:
                cause instanceof Error
                  ? `Could not connect to Relay: ${cause.message}`
                  : "Could not connect to Relay",
            },
            { status: 502 }
          )
        } finally {
          clearTimeout(connectTimer)
        }

        if (!upstream.ok || !upstream.body) {
          request.signal.removeEventListener("abort", abortUpstream)
          const problem = (await upstream.json().catch(() => null)) as {
            error?: string
          } | null
          return Response.json(
            {
              error:
                problem?.error ??
                (upstream.body
                  ? `Relay returned HTTP ${upstream.status}`
                  : "Relay returned an empty console stream"),
            },
            { status: upstream.ok ? 502 : upstream.status }
          )
        }

        const reader = upstream.body.getReader()
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const { done, value } = await reader.read()
              if (done) {
                request.signal.removeEventListener("abort", abortUpstream)
                controller.close()
              } else {
                controller.enqueue(value)
              }
            } catch (cause) {
              request.signal.removeEventListener("abort", abortUpstream)
              if (request.signal.aborted || upstreamController.signal.aborted) {
                controller.close()
              } else {
                controller.error(cause)
              }
            }
          },
          async cancel(reason) {
            request.signal.removeEventListener("abort", abortUpstream)
            upstreamController.abort(reason)
            await reader.cancel(reason).catch(() => undefined)
          },
        })

        return new Response(body, {
          headers: {
            "Cache-Control": "no-cache, no-store",
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "X-Accel-Buffering": "no",
          },
        })
      },
    },
  },
})
