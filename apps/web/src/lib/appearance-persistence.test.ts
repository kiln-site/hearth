import { describe, expect, it } from "vite-plus/test"

import { enqueueAppearancePersistence } from "@/lib/appearance-persistence"

function createDeferred() {
  let resolve = () => {}
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe("enqueueAppearancePersistence", () => {
  it("waits for each appearance write before starting the next one", async () => {
    const firstWrite = createDeferred()
    const secondWrite = createDeferred()
    const calls: Array<string> = []
    let pending = Promise.resolve()

    const firstPending = enqueueAppearancePersistence(pending, () => {
      calls.push("first")
      return firstWrite.promise
    })
    pending = enqueueAppearancePersistence(firstPending, () => {
      calls.push("second")
      return secondWrite.promise
    })

    await Promise.resolve()
    expect(calls).toEqual(["first"])

    firstWrite.resolve()
    await firstPending
    await Promise.resolve()
    expect(calls).toEqual(["first", "second"])

    secondWrite.resolve()
    await pending
  })

  it("continues with the latest write after an earlier write fails", async () => {
    const calls: Array<string> = []
    let pending = enqueueAppearancePersistence(Promise.resolve(), () => {
      calls.push("first")
      return Promise.reject(new Error("offline"))
    })
    pending = enqueueAppearancePersistence(pending, async () => {
      calls.push("second")
    })

    await pending

    expect(calls).toEqual(["first", "second"])
  })
})
