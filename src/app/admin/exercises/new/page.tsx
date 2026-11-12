import { EXERCISE_TEMPLATE } from "~/lib/exercise";
import { ExerciseEditor } from "../exercise-editor";

export default function NewExercisePage() {
  return <ExerciseEditor initial={EXERCISE_TEMPLATE} />;
}
