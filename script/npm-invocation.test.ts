/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { npmSpawnOptions } from "./npm-invocation.mjs"

describe("npm spawn options", () => {
  test("#given win32 #when npm spawn options are resolved #then a shell is requested", () => {
    // given / when
    const options = npmSpawnOptions("win32")

    // then
    expect(options).toEqual({ shell: true })
  })

  test("#given linux and darwin #when npm spawn options are resolved #then no shell is requested", () => {
    // given / when
    const linux = npmSpawnOptions("linux")
    const darwin = npmSpawnOptions("darwin")

    // then
    expect(linux).toEqual({})
    expect(darwin).toEqual({})
  })
})
