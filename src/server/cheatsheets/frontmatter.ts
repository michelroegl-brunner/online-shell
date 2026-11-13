/**
 * Minimal frontmatter for built-in cheat sheets (content/cheatsheets/*.md):
 *
 * ---
 * slug: bash-funktionen
 * title: Bash-Funktionen
 * shell: BASH
 * tags: [funktionen, functions]
 * order: 10
 * ---
 * Markdown body…
 *
 * Only flat `key: value` lines; `tags` is `[a, b]` or `a, b`. Values may be
 * quoted. No YAML dependency on purpose.
 */
export type Frontmatter = Record<string, string | string[]>;

const unquote = (s: string) => {
  const t = s.trim();
  if (
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) ||
      (t.startsWith("'") && t.endsWith("'")))
  ) {
    return t.slice(1, -1);
  }
  return t;
};

export function parseFrontmatter(src: string): {
  data: Frontmatter;
  body: string;
} {
  const text = src.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Frontmatter = {};
  for (const raw of m[1]!.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf(":");
    if (i <= 0) throw new Error(`Bad frontmatter line: ${raw}`);
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value.slice(1, -1).split(",").map(unquote).filter(Boolean);
    } else {
      data[key] = unquote(value);
    }
  }
  return { data, body: text.slice(m[0].length).replace(/^\n+/, "") };
}
