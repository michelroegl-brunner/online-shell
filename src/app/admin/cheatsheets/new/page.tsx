import { CHEAT_SHEET_TEMPLATE } from "~/server/cheatsheets/schema";
import { CheatSheetEditor } from "../cheat-sheet-editor";

export default function NewCheatSheetPage() {
  return <CheatSheetEditor initial={CHEAT_SHEET_TEMPLATE} />;
}
