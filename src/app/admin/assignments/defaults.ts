import type { EditorInitial } from "./assignment-editor";

// Kept out of the "use client" editor module: server pages import this, and
// values exported from a client module are only client references there.
export const EMPTY_ASSIGNMENT: EditorInitial = {
  title: "",
  classId: "",
  groupIds: [],
  items: [],
  opensAt: null,
  dueAt: null,
  maxChecks: null,
  allowHints: true,
  // Students should type commands themselves.
  allowPaste: false,
  published: false,
  publishAt: null,
  mode: "PRACTICE",
};
