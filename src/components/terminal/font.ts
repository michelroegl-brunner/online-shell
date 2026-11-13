/**
 * Font for xterm. xterm measures its cell size once when it opens, from the
 * font family string. A CSS `var(...)` there, or a web font that hasn't
 * loaded yet, makes it measure the fallback font; the real (taller) glyphs
 * then overlap from row to row. So: resolve the variable to the actual
 * family names and wait (briefly) until the font is loaded.
 */
export const TERMINAL_LINE_HEIGHT = 1.15;

export async function terminalFontFamily(fontSize: number): Promise<string> {
  const mono = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-geist-mono")
    .trim();
  if (!mono) return "ui-monospace, monospace";
  await Promise.race([
    document.fonts.load(`${fontSize}px ${mono}`).catch(() => null),
    new Promise((r) => setTimeout(r, 2000)),
  ]);
  return `${mono}, ui-monospace, monospace`;
}
