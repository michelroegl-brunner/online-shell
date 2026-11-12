import { AssignmentEditor } from "../assignment-editor";
import { EMPTY_ASSIGNMENT } from "../defaults";

export default async function NewAssignmentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const classId = typeof sp.classId === "string" ? sp.classId : "";
  return <AssignmentEditor initial={{ ...EMPTY_ASSIGNMENT, classId }} />;
}
