/**
 * What an exercise / cheat sheet is about. C exercises run in a bash
 * terminal in the bash box (gcc, make, gdb, valgrind are installed there)
 * and get a code editor beside the terminal.
 */
export const SHELL_KINDS = ["BASH", "PWSH", "C"] as const;
export type ShellKind = (typeof SHELL_KINDS)[number];

/** Short lowercase tag (badges). */
export const SHELL_TAG: Record<ShellKind, string> = {
  BASH: "bash",
  PWSH: "pwsh",
  C: "c",
};

export const SHELL_LABEL: Record<ShellKind, string> = {
  BASH: "Bash",
  PWSH: "PowerShell",
  C: "C",
};

/** The shell / box image that runs it: C uses the bash box. */
export const terminalShell = (s: ShellKind): "BASH" | "PWSH" =>
  s === "PWSH" ? "PWSH" : "BASH";
