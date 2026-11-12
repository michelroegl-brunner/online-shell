"use client";

import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";

export function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function ScriptHelp({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground text-sm [&_code]:font-mono [&_code]:text-xs">
      {children}
    </p>
  );
}

/** Monospace script editor; Tab inserts two spaces. */
export function Script({
  value,
  onChange,
  readOnly,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
  className?: string;
}) {
  return (
    <Textarea
      readOnly={readOnly}
      spellCheck={false}
      className={cn("min-h-80 bg-black/40 font-mono text-sm", className)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Tab" && !e.shiftKey && !readOnly) {
          e.preventDefault();
          const el = e.currentTarget;
          const { selectionStart: s, selectionEnd: end } = el;
          const next = value.slice(0, s) + "  " + value.slice(end);
          onChange(next);
          requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
        }
      }}
    />
  );
}
