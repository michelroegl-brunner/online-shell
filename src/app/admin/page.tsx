import { BarChart3, ClipboardList, SquareTerminal, Users } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

const SECTIONS = [
  {
    title: "Exercises",
    text: "Write Bash/PowerShell exercises with setup and check scripts.",
    icon: SquareTerminal,
  },
  {
    title: "Classes",
    text: "Import M365 groups as classes.",
    icon: Users,
  },
  {
    title: "Assignments",
    text: "Give exercise sets to a class as practice or exam.",
    icon: ClipboardList,
  },
  {
    title: "Reports",
    text: "Class × exercise matrix, per-student details, CSV export.",
    icon: BarChart3,
  },
];

export default function AdminHome() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Teacher dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <Card key={s.title}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <s.icon className="text-primary size-5" />
                {s.title}
                <Badge variant="outline" className="ml-auto">
                  coming soon
                </Badge>
              </CardTitle>
              <CardDescription>{s.text}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </>
  );
}
