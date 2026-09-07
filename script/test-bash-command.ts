import { resolveGitBashForCurrentProcess } from "../packages/utils/src/runtime/git-bash"

// A bare `bash` is resolved through PATH, and on a Windows host with WSL installed that is
// C:\\Windows\\System32\\bash.exe, which runs inside the Linux VM: a Windows script path arrives with its
// backslashes eaten and the spawn exits 127. bundled-rules/windows-git-bash.md already forbids a bare
// `bash` for exactly this reason, so these harnesses resolve Git Bash the way the product does and fall
// back to PATH only where the product does not need a resolution.
export function testBashCommand(): string {
  const resolution = resolveGitBashForCurrentProcess()
  return resolution.found && resolution.path !== null ? resolution.path : "bash"
}
