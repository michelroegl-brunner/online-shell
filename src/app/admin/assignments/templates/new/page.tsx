import { EMPTY_TEMPLATE } from "../defaults";
import { TemplateEditor } from "../template-editor";

export default function NewTemplatePage() {
  return <TemplateEditor initial={EMPTY_TEMPLATE} />;
}
