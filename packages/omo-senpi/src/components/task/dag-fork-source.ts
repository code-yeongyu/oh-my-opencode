import { constants } from "node:fs"
import { open } from "node:fs/promises"

const MAX_HEADER_BYTES = 64 * 1024

/** Read only the immediate source header, never SessionManager.open or persistent ancestry. */
export async function readDagForkSource(previousSessionFile: unknown): Promise<string> {
  if (typeof previousSessionFile !== "string" || previousSessionFile.trim().length === 0) {
    throw new Error("fork event has no previous session file")
  }
  const file = await open(previousSessionFile, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    if (!(await file.stat()).isFile()) throw new Error("fork source is not a regular session file")
    const buffer = Buffer.alloc(MAX_HEADER_BYTES + 1)
    let length = 0
    let end = -1
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length)
      if (bytesRead === 0) break
      end = buffer.indexOf(10, length)
      length += bytesRead
      if (end >= 0 && end < length) break
    }
    const headerLength = end >= 0 ? end : length
    if (headerLength > MAX_HEADER_BYTES) throw new Error("fork source header exceeds the read limit")
    const header: unknown = JSON.parse(buffer.toString("utf8", 0, headerLength))
    if (typeof header !== "object" || header === null || !("type" in header) || header.type !== "session" ||
      !("id" in header) || typeof header.id !== "string" || header.id.trim().length === 0) {
      throw new Error("fork source has no valid session header identity")
    }
    return header.id
  } finally {
    await file.close()
  }
}
