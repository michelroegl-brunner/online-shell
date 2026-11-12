import { BarChart3, ClipboardList, SquareTerminal, Users } from "lucide-react";
import Link from "next/link";

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
    href: "/admin/exercises",
  },
  {
    title: "Classes",
    text: "Import M365 groups as classes.",
    icon: Users,
    href: "/admin/classes",
  },
  {
    title: "Assignments",
    text: "Give exercise sets to a class or to groups of it.",
    icon: ClipboardList,
    href: "/admin/assignments",
  },
  {
    title: "Reports",
    text: "Class × exercise matrix, per-student details, CSV export.",
    icon: BarChart3,
    href: "/admin/reports",
  },
];

export default function AdminHome() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Teacher dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((s) => {
          const card = (
            <Card
              className={
                s.href
                  ? "hover:border-primary/50 h-full transition-colors"
                  : "h-full"
              }
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <s.icon className="text-primary size-5" />
                  {s.title}
                  {!s.href && (
                    <Badge variant="outline" className="ml-auto">
                      coming soon
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>{s.text}</CardDescription>
              </CardHeader>
            </Card>
          );
          return s.href ? (
            <Link key={s.title} href={s.href}>
              {card}
            </Link>
          ) : (
            <div key={s.title}>{card}</div>
          );
        })}
      </div>
    </>
  );
}
