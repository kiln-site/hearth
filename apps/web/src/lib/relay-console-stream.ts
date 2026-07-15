import {
  relayConsoleStreamEventSchema,
} from "@workspace/contracts"
import type { RelayConsoleStreamEvent } from "@workspace/contracts"

export async function* openRelayConsoleStream(
  instanceId: string,
  signal: AbortSignal
): AsyncGenerator<RelayConsoleStreamEvent> {
  const response = await fetch(
    `/api/console/${encodeURIComponent(instanceId)}`,
    {
      cache: "no-store",
      headers: { Accept: "application/x-ndjson" },
      signal,
    }
  )

  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(problem?.error ?? `Console stream returned HTTP ${response.status}`)
  }
  if (!response.body) throw new Error("Console stream returned an empty body")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.trim()) continue
        yield relayConsoleStreamEventSchema.parse(JSON.parse(line))
      }
    }

    buffer += decoder.decode()
    if (buffer.trim()) {
      yield relayConsoleStreamEventSchema.parse(JSON.parse(buffer))
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
