import { describe, expect, it } from "vite-plus/test"

import {
  redactSensitiveText,
  redactSensitiveTextWithRanges,
} from "@/lib/redaction"

describe("sensitive text redaction", () => {
  it("tracks only text replaced by Hearth as redacted", () => {
    expect(
      redactSensitiveTextWithRanges("**** server at 192.168.1.10 is offline")
    ).toEqual({
      redactions: [{ from: 15, to: 30 }],
      text: "**** server at ***.***.***.*** is offline",
    })
  })

  it("does not mark application-authored asterisks as redacted", () => {
    const warning = "**** SERVER IS RUNNING IN OFFLINE MODE!"

    expect(redactSensitiveTextWithRanges(warning)).toEqual({
      redactions: [],
      text: warning,
    })
    expect(redactSensitiveText(warning)).toBe(warning)
  })
})
