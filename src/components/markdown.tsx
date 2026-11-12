import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "~/lib/utils";

/**
 * Renders exercise Markdown (GFM). Raw HTML is NOT rendered
 * (react-markdown's default), so teacher text can't inject markup.
 */
export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "prose prose-invert prose-sm prose-pre:bg-black/60 prose-code:before:content-none prose-code:after:content-none max-w-none",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
