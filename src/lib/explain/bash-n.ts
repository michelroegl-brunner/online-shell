import type { Explanation } from "./types";
import { code } from "./util";

/**
 * Explanation for the output of `bash -n <file>` (syntax check without
 * running the script). `output` is bash's stderr, e.g.
 * `./greet.sh: line 4: syntax error near unexpected token `}'`.
 */
export function explainSyntaxCheck(
  file: string,
  output: string,
): Explanation | null {
  const text = output.trim();
  if (!text) return null;
  const name = file.replace(/^\.\//, "");
  const line = /line (\d+):/.exec(text)?.[1];
  const where = line ? `in Zeile ${line}` : "";
  const token = /unexpected token [`'](.+?)'/.exec(text)?.[1];
  const shown = text
    .split("\n")
    .slice(0, 3)
    .map((l) => l.replace(/^\.\//, ""))
    .join("\n");
  let hint: string;
  if (text.includes("unexpected end of file")) {
    hint = `Am Dateiende fehlt etwas – meist ein ${code("fi")}, ${code("done")}, eine ${code("}")} oder ein schließendes Anführungszeichen.`;
  } else if (token === "}") {
    hint = `Die ${code("}")} kommt für bash unerwartet. Oft fehlt das Leerzeichen nach ${code("{")} (${code("{echo")}) oder die Funktion ist leer.`;
  } else if (token) {
    hint = `bash hat ${code(token)} ${where} an dieser Stelle nicht erwartet. Oft fehlt kurz davor ein ${code(";")}, ein ${code("then")}/${code("do")} oder ein Leerzeichen.`;
  } else {
    hint = `bash meldet einen Syntaxfehler ${where}.`.replace(" .", ".");
  }
  return {
    id: "bash-n",
    title: `Syntaxfehler in ${name}`,
    detail: `${hint}\n\n\`\`\`\n${shown}\n\`\`\``,
  };
}
