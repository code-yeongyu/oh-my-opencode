import { describe, expect, test } from "bun:test"
import {
  OmoConfigLayerSchema,
  OmoConfigProfileSchema,
  OmoConfigSchema,
  OmoTypedHarnessConfigSchema,
} from "../index"

describe("child_extensions schema", () => {
  test("#given child_extensions at the root #when parsed #then the list survives verbatim", () => {
    const parsed = OmoConfigSchema.parse({ child_extensions: ["~/auth-ext.js", "/opt/exts/hook.js"] })
    expect(parsed.child_extensions).toEqual(["~/auth-ext.js", "/opt/exts/hook.js"])
  })

  test("#given no child_extensions #when parsed #then the field is absent", () => {
    expect(OmoConfigSchema.parse({}).child_extensions).toBeUndefined()
  })

  test("#given child_extensions in a config layer #when parsed #then the list survives", () => {
    const parsed = OmoConfigLayerSchema.parse({ child_extensions: ["/abs/ext.js"] })
    expect(parsed.child_extensions).toEqual(["/abs/ext.js"])
  })

  test("#given child_extensions inside a [senpi] harness block #when parsed #then the list survives", () => {
    const parsed = OmoConfigSchema.parse({ "[senpi]": { child_extensions: ["/abs/senpi-only.js"] } })
    expect(parsed["[senpi]"]?.child_extensions).toEqual(["/abs/senpi-only.js"])
  })

  test("#given child_extensions inside a profile #when parsed #then the list survives", () => {
    const parsed = OmoConfigSchema.parse({
      profiles: { work: { child_extensions: ["/abs/profile.js"] } },
    })
    expect(parsed.profiles.work?.child_extensions).toEqual(["/abs/profile.js"])
  })

  test("#given a non-array child_extensions #when parsed #then it is rejected", () => {
    expect(() => OmoConfigSchema.parse({ child_extensions: "/abs/ext.js" })).toThrow()
    expect(() => OmoConfigLayerSchema.parse({ child_extensions: 42 })).toThrow()
    expect(() => OmoTypedHarnessConfigSchema.parse({ child_extensions: { ext: true } })).toThrow()
    expect(() => OmoConfigProfileSchema.parse({ child_extensions: null })).toThrow()
  })

  test("#given an empty-string entry #when parsed #then it is rejected", () => {
    expect(() => OmoConfigSchema.parse({ child_extensions: [""] })).toThrow()
  })
})
