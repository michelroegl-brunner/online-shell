"use client";

import { useState } from "react";

/**
 * Cumulative points over time (one series, step line). Hover shows the day,
 * the total and what was gained that day. A table view sits below for
 * screen readers / exact values.
 */
export function PointsChart({
  data,
  maxPoints,
}: {
  data: { day: string; points: number; gained: number }[];
  maxPoints: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  if (data.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        No solved steps yet. Your points show up here once you solve one.
      </p>
    );
  }

  const W = 640;
  const H = 220;
  const pad = { l: 40, r: 16, t: 12, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  // Start one day before the first point at 0, so the first gain is visible.
  const t = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
  const first = t(data[0]!.day) - 86_400_000;
  const last = Math.max(t(data[data.length - 1]!.day), first + 86_400_000);
  const top = Math.max(niceCeil(Math.max(data[data.length - 1]!.points, 1)), 1);
  const x = (d: string) => pad.l + ((t(d) - first) / (last - first)) * iw;
  const y = (p: number) => pad.t + ih - (p / top) * ih;

  const pts = [
    { x: pad.l, y: y(0) },
    ...data.map((d) => ({ x: x(d.day), y: y(d.points) })),
  ];
  // Step line: points stay flat until the next gain.
  let path = `M${pts[0]!.x},${pts[0]!.y}`;
  for (let i = 1; i < pts.length; i++) {
    path += ` H${pts[i]!.x} V${pts[i]!.y}`;
  }
  const area = `${path} V${y(0)} H${pad.l} Z`;
  const ticks = [0, top / 2, top];
  const h = hover === null ? null : data[hover]!;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Points over time: ${data[data.length - 1]!.points} points so far`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const mx = ((e.clientX - r.left) / r.width) * W;
            let best = 0;
            data.forEach((d, i) => {
              if (Math.abs(x(d.day) - mx) < Math.abs(x(data[best]!.day) - mx))
                best = i;
            });
            setHover(best);
          }}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line
                x1={pad.l}
                x2={W - pad.r}
                y1={y(v)}
                y2={y(v)}
                className="stroke-border"
                strokeWidth={1}
              />
              <text
                x={pad.l - 6}
                y={y(v)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground text-[11px]"
              >
                {Math.round(v)}
              </text>
            </g>
          ))}
          {maxPoints > 0 && maxPoints <= top && (
            <text
              x={W - pad.r}
              y={y(maxPoints) - 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              max {maxPoints}
            </text>
          )}
          <text
            x={pad.l}
            y={H - 8}
            className="fill-muted-foreground text-[11px]"
          >
            {fmtDay(new Date(first).toISOString().slice(0, 10))}
          </text>
          <text
            x={W - pad.r}
            y={H - 8}
            textAnchor="end"
            className="fill-muted-foreground text-[11px]"
          >
            {fmtDay(data[data.length - 1]!.day)}
          </text>
          <path d={area} className="fill-primary/10" />
          <path
            d={path}
            fill="none"
            className="stroke-primary"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {h && (
            <>
              <line
                x1={x(h.day)}
                x2={x(h.day)}
                y1={pad.t}
                y2={pad.t + ih}
                className="stroke-muted-foreground/50"
                strokeDasharray="3 3"
              />
              <circle
                cx={x(h.day)}
                cy={y(h.points)}
                r={4}
                className="fill-primary stroke-background"
                strokeWidth={2}
              />
            </>
          )}
        </svg>
        {h && (
          <div
            className="bg-popover text-popover-foreground pointer-events-none absolute top-0 rounded-md border px-2 py-1 text-xs shadow-sm"
            style={{
              left: `${(x(h.day) / W) * 100}%`,
              transform:
                x(h.day) > W * 0.7
                  ? "translateX(calc(-100% - 8px))"
                  : "translateX(8px)",
            }}
          >
            <div className="font-medium">{fmtDay(h.day)}</div>
            <div>
              {h.points} points total
              <span className="text-muted-foreground"> · +{h.gained}</span>
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground self-start text-xs underline"
        onClick={() => setShowTable((v) => !v)}
        aria-expanded={showTable}
      >
        {showTable ? "Hide table" : "Show as table"}
      </button>
      {showTable && (
        <table className="text-sm">
          <thead>
            <tr className="text-muted-foreground text-left text-xs">
              <th className="py-1 font-normal">Day</th>
              <th className="py-1 text-right font-normal">Gained</th>
              <th className="py-1 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.day} className="border-t">
                <td className="py-1">{fmtDay(d.day)}</td>
                <td className="py-1 text-right tabular-nums">+{d.gained}</td>
                <td className="py-1 text-right tabular-nums">{d.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function niceCeil(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
