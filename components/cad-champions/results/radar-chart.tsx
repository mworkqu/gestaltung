import { labelAnchor, radarGeometry, type RadarAxisInput } from "@/lib/cad-champions/scoring/radar";
import { cn } from "@/lib/utils";

/**
 * Skill-map radar (hand-built SVG, no chart library). Six axes; assessed areas
 * filled, unassessed axes dashed with "Not assessed". The SVG is laid out
 * left-to-right in both languages (anchors come from the geometry), so labels
 * never flip onto the chart in RTL. Decorative for screen readers: the page
 * renders the same data as a list right under it.
 */
export function RadarChart({
  axes,
  label,
  notAssessed,
  className,
  size = 360,
  rtl = false,
}: {
  axes: RadarAxisInput[];
  label: string;
  notAssessed: string;
  className?: string;
  size?: number;
  /** Arabic labels: direction rtl so mixed runs order correctly. */
  rtl?: boolean;
}) {
  const g = radarGeometry(axes, size);
  return (
    <svg
      viewBox={`0 0 ${g.width} ${g.size}`}
      role="img"
      aria-label={label}
      className={cn("h-auto w-full max-w-xl", className)}
      direction="ltr"
      style={{ direction: "ltr" }}
    >
      {g.rings.map((ring, i) => (
        <polygon key={i} points={ring} fill="none" className="stroke-border" strokeWidth={1} />
      ))}
      {g.axes.map((a) => (
        <line
          key={`axis-${a.id}`}
          x1={g.cx}
          y1={g.cy}
          x2={a.x}
          y2={a.y}
          className={a.assessed ? "stroke-faint" : "stroke-border"}
          strokeWidth={1}
          strokeDasharray={a.assessed ? undefined : "4 4"}
        />
      ))}
      {g.valuePolygon ? (
        <polygon points={g.valuePolygon} className="fill-cobalt/20 stroke-cobalt" strokeWidth={2} strokeLinejoin="round" />
      ) : null}
      {g.axes.map((a) => {
        const sub = a.assessed ? `${Math.round(a.percent as number)}%` : notAssessed;
        const lines = [...a.lines, sub];
        const startY = a.ly - ((lines.length - 1) * 13) / 2;
        return (
          <g key={`label-${a.id}`}>
            {a.assessed ? <circle cx={a.vx} cy={a.vy} r={3.5} className="fill-cobalt" /> : null}
            <text x={a.lx} y={startY} textAnchor={labelAnchor(a.anchor, rtl)} direction={rtl ? "rtl" : "ltr"} fontSize={11} className={a.assessed ? "fill-ink" : "fill-mutedtext"}>
              {lines.map((l, i) => (
                <tspan key={i} x={a.lx} dy={i === 0 ? 0 : 13} fontWeight={i === lines.length - 1 ? 700 : 400}>
                  {l}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
