import { describe, expect, it } from "vite-plus/test"

import { warmHistoryOnce } from "./relay-resource-stream"

describe("Hearth resource polling", () => {
  it("delivers warm history only with the first poll", () => {
    const historyForPoll = warmHistoryOnce<number>()

    expect(historyForPoll([1, 2, 3])).toEqual([1, 2, 3])
    expect(historyForPoll([1, 2, 3, 4])).toEqual([])
    expect(historyForPoll([5])).toEqual([])
  })
})
