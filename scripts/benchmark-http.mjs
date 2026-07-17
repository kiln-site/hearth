import { performance } from "node:perf_hooks"

const baseUrl = process.env.BENCHMARK_URL ?? "http://127.0.0.1:3000"
const cookie = process.env.BENCHMARK_COOKIE ?? "kiln-dev-auth-bypass=enabled"
const concurrency = positiveInteger("BENCHMARK_CONCURRENCY", 5)
const requestsPerPath = positiveInteger("BENCHMARK_REQUESTS", 30)
const warmupsPerPath = positiveInteger("BENCHMARK_WARMUPS", 3)
const paths = (
  process.env.BENCHMARK_PATHS ??
  "/b817b002/console,/b817b002/files/server.properties,/access,/bricks,/settings"
)
  .split(",")
  .map((path) => path.trim())
  .filter(Boolean)

for (const path of paths) {
  for (let index = 0; index < warmupsPerPath; index += 1) {
    await request(path)
  }
}

const results = []
for (const path of paths) {
  const durations = await runConcurrent(
    Array.from({ length: requestsPerPath }, () => () => request(path)),
    concurrency
  )
  results.push(summarize(path, durations))
}

console.table(
  results.map(({ path, ...summary }) => ({ path, ...summary }))
)
console.log(JSON.stringify({ baseUrl, concurrency, requestsPerPath, results }))

async function request(path) {
  const startedAt = performance.now()
  const response = await fetch(new URL(path, baseUrl), {
    headers: { Cookie: cookie },
    redirect: "manual",
  })
  await response.arrayBuffer()
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`)
  }
  return performance.now() - startedAt
}

async function runConcurrent(tasks, limit) {
  const results = new Array(tasks.length)
  let nextTask = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (nextTask < tasks.length) {
        const index = nextTask
        nextTask += 1
        results[index] = await tasks[index]()
      }
    })
  )
  return results
}

function summarize(path, durations) {
  const sorted = [...durations].sort((left, right) => left - right)
  const total = sorted.reduce((sum, duration) => sum + duration, 0)
  return {
    path,
    meanMs: round(total / sorted.length),
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    minMs: round(sorted[0]),
    maxMs: round(sorted.at(-1)),
  }
}

function percentile(sorted, value) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)]
}

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function round(value) {
  return Number(value.toFixed(2))
}
