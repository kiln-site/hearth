import { Effect } from "effect"
import { describe, expect, it } from "vite-plus/test"

import {
  ensuringPromise,
  forkPromise,
  promiseEffect,
  recoverPromise,
  settlePromises,
  tapPromiseError,
} from "@/effect/promise"

describe("Promise Effect boundaries", () => {
  it("preserves rejected causes", async () => {
    const cause = new Error("offline")

    await expect(
      Effect.runPromise(promiseEffect(() => Promise.reject(cause)))
    ).rejects.toBe(cause)
  })

  it("recovers rejected promises with the requested fallback", async () => {
    const cause = new Error("offline")

    await expect(
      recoverPromise(
        () => Promise.reject(cause),
        (observed) => (observed === cause ? "fallback" : "unexpected")
      )
    ).resolves.toBe("fallback")
  })

  it("observes a rejection without swallowing it", async () => {
    const cause = new Error("offline")
    const observed: Array<unknown> = []

    await expect(
      tapPromiseError(
        () => Promise.reject(cause),
        (error) => observed.push(error)
      )
    ).rejects.toBe(cause)
    expect(observed).toEqual([cause])
  })

  it("reports forked failures", async () => {
    const cause = new Error("offline")
    const observed = await new Promise<unknown>((resolve) =>
      forkPromise(() => Promise.reject(cause), resolve)
    )

    expect(observed).toBe(cause)
  })

  it("runs finalizers after success and failure", async () => {
    const cause = new Error("offline")
    let finalized = 0
    const finalize = () => {
      finalized += 1
    }

    await expect(
      ensuringPromise(() => Promise.resolve("ok"), finalize)
    ).resolves.toBe("ok")
    await expect(
      ensuringPromise(() => Promise.reject(cause), finalize)
    ).rejects.toBe(cause)
    expect(finalized).toBe(2)
  })

  it("settles bounded promise work without dropping failures", async () => {
    const cause = new Error("offline")
    const settlements = await settlePromises(
      [1, 2, 3],
      (value) =>
        value === 2 ? Promise.reject(cause) : Promise.resolve(value * 2),
      2
    )

    expect(settlements).toEqual([
      { input: 1, status: "fulfilled", value: 2 },
      { input: 2, reason: cause, status: "rejected" },
      { input: 3, status: "fulfilled", value: 6 },
    ])
  })
})
