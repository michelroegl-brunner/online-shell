import type { TemplateInitial } from "./template-editor";

// Kept out of the "use client" editor module (see ../defaults.ts).
export const EMPTY_TEMPLATE: TemplateInitial = {
  title: "",
  description: "",
  mode: "PRACTICE",
  maxChecks: "",
  allowHints: true,
  hintPenalty: 0,
  allowCheatSheet: true,
  allowPaste: false,
  durationMinutes: "",
  visibility: "PRIVATE",
  items: [],
};
