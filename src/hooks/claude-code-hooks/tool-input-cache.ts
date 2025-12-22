interface CacheEntry {
  toolInput: Record<string, unknown>
  timestamp: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL = 60000
const MAX_CACHE_SIZE = 1000

let cleanupInterval: ReturnType<typeof setInterval> | null = null

function cleanupExpiredEntries(): void {
  const now = Date.now()
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      cache.delete(key)
    }
  }
}

function startCleanupInterval(): void {
  if (cleanupInterval) return
  cleanupInterval = setInterval(cleanupExpiredEntries, CACHE_TTL)
  cleanupInterval.unref?.()
}

function stopCleanupInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
    cleanupInterval = null
  }
}

process.on("exit", stopCleanupInterval)

export function cacheToolInput(
  sessionId: string,
  toolName: string,
  invocationId: string,
  toolInput: Record<string, unknown>
): void {
  startCleanupInterval()
  
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value
    if (oldestKey) cache.delete(oldestKey)
  }
  
  const key = `${sessionId}:${toolName}:${invocationId}`
  cache.set(key, { toolInput, timestamp: Date.now() })
}

export function getToolInput(
  sessionId: string,
  toolName: string,
  invocationId: string
): Record<string, unknown> | null {
  const key = `${sessionId}:${toolName}:${invocationId}`
  const entry = cache.get(key)
  if (!entry) return null

  cache.delete(key)
  if (Date.now() - entry.timestamp > CACHE_TTL) return null

  return entry.toolInput
}
