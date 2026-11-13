import { SquareTerminal } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/** Just enough of a hast node to read a code block's text. */
type HastNode = { type: string; value?: string; children?: HastNode[] };

const hastText = (n: HastNode | undefined): string =>
  !n
    ? ""
    : n.type === "text"
      ? (n.value ?? "")
      : (n.children ?? []).map(hastText).join("");

/**
 * Renders exercise Markdown (GFM). Raw HTML is NOT rendered
 * (react-markdown's default), so teacher text can't inject markup.
 *
 * With `onCodeAction`, every fenced code block gets a small button that
 * hands its text to the caller (lessons: type it into the terminal).
 * Without it, rendering is unchanged.
 */
export function Markdown({
  children,
  className,
  onCodeAction,
  codeActionLabel = "Try it",
}: {
  children: string;
  className?: string;
  onCodeAction?: (code: string) => void;
  codeActionLabel?: string;
}) {
  const components: Components | undefined = onCodeAction
    ? {
        pre: ({ node, children: kids, ...rest }) => {
          const code = hastText(node).replace(/\n+$/, "");
          return (
            <div className="group/code relative">
              <pre {...rest}>{kids}</pre>
              {code.trim() && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="absolute top-1.5 right-1.5 h-7 px-2 text-xs opacity-80 group-hover/code:opacity-100"
                  title="Put this into the terminal (you press Enter yourself)"
                  onClick={() => onCodeAction(code)}
                >
                  <SquareTerminal /> {codeActionLabel}
                </Button>
              )}
            </div>
          );
        },
      }
    : undefined;

  return (
    <div
      className={cn(
        "prose prose-invert prose-sm prose-pre:bg-black/60 prose-code:before:content-none prose-code:after:content-none max-w-none",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
