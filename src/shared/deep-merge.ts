function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

/**
 * Deep merges two objects, with override values taking precedence.
 * - Objects are recursively merged
 * - Arrays are replaced (not concatenated)
 * - undefined values in override do not overwrite base values
 *
 * @example
 * deepMerge({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 10 }, e: 5 })
 * // => { a: 1, b: { c: 10, d: 3 }, e: 5 }
 */
export function deepMerge<T extends Record<string, unknown>>(
  base: T | undefined,
  override: T | undefined
): T | undefined {
  if (!base && !override) return undefined;
  if (!base) return override;
  if (!override) return base;

  const result = { ...base } as Record<string, unknown>;

  for (const key of Object.keys(override)) {
    const baseValue = base[key];
    const overrideValue = override[key];

    if (overrideValue === undefined) continue;

    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = deepMerge(baseValue, overrideValue);
    } else {
      result[key] = overrideValue;
    }
  }

  return result as T;
}
