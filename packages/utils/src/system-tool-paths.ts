import { existsSync } from "node:fs"
import { win32 } from "node:path"

/** Resolve only existing tools under absolute Windows installation roots, never PATH. */
export function resolveWindowsSystemTool(
	toolRelativePath: string,
	systemRoot: string | undefined = process.env["SystemRoot"],
	exists: (path: string) => boolean = existsSync,
	windir: string | undefined = process.env["WINDIR"],
): string | undefined {
	for (const root of [systemRoot, windir]) {
		// A single leading slash is drive-relative on Windows, not a full root.
		if (!root || !win32.isAbsolute(root) || win32.parse(root).root.length <= 1) continue
		const path = win32.join(root, "System32", toolRelativePath)
		if (exists(path)) return path
	}
	return undefined
}

export function resolveWindowsSystemToolExistent(
	toolRelativePath: string,
	systemRoot: string | undefined = process.env["SystemRoot"],
	exists: (path: string) => boolean = existsSync,
	windir: string | undefined = process.env["WINDIR"],
): { found: true; path: string } | { found: false; error: string } {
	const path = resolveWindowsSystemTool(toolRelativePath, systemRoot, exists, windir)
	return path === undefined
		? { found: false, error: `Windows system tool ${toolRelativePath} was not found under an absolute SystemRoot or WINDIR` }
		: { found: true, path }
}
