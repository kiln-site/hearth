import assert from "node:assert/strict"
import test from "node:test"

import { ensureDockerVolume } from "./dev-docker-helpers.mjs"

test("accepts a volume created by another concurrent process", () => {
  const calls = []
  const responses = [
    { status: 1 },
    { status: 1, stderr: "volume already exists" },
    { status: 0 },
  ]

  ensureDockerVolume("shared-store", (arguments_) => {
    calls.push(arguments_)
    return responses.shift()
  })

  assert.deepEqual(calls, [
    ["volume", "inspect", "shared-store"],
    ["volume", "create", "shared-store"],
    ["volume", "inspect", "shared-store"],
  ])
})

test("reports a volume that still does not exist after creation fails", () => {
  const responses = [
    { status: 1 },
    { status: 1, stderr: "daemon unavailable" },
    { status: 1 },
  ]

  assert.throws(
    () =>
      ensureDockerVolume("shared-store", () => {
        return responses.shift()
      }),
    /Could not create Docker volume shared-store: daemon unavailable/u
  )
})
