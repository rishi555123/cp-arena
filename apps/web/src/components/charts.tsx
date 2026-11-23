"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
const grid = <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />;
const tooltipStyle = { contentStyle: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }, labelStyle: { color: "var(--foreground)" } };
const shortDate = (t: number) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

export const PLATFORM_COLOR = { codeforces: "var(--chart-1)", leetcode: "var(--chart-2)", codechef: "var(--chart-3)" } as const;

export function RatingChart({
  points,
  bands,
  color,
  label,
}: {
  points: { t: number; rating: number; contest: string }[];
  bands: { label: string; min: number; max: number; color: string }[];
  color: string;
  label: string;
}) {
  const lo = Math.min(...points.map((p) => p.rating));
  const hi = Math.max(...points.map((p) => p.rating));
  const domain: [number, number] = [Math.floor((lo - 100) / 100) * 100, Math.ceil((hi + 100) / 100) * 100];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={points} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        {bands
          .filter((b) => b.max > domain[0] && b.min < domain[1])
          .map((b) => (
            <ReferenceArea
              key={b.label}
              y1={Math.max(b.min, domain[0])}
              y2={Math.min(b.max, domain[1])}
              fill={b.color}
              fillOpacity={0.12}
              stroke="none"
              ifOverflow="hidden"
              label={{ value: b.label, position: "insideTopLeft", fontSize: 10, fill: "var(--muted-foreground)" }}
            />
          ))}
        {grid}
        <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={shortDate} tick={axis} minTickGap={30} />
        <YAxis domain={domain} tick={axis} width={44} />
        <Tooltip {...tooltipStyle} labelFormatter={(t) => shortDate(Number(t))} formatter={(v, _n, item) => [v, (item.payload as { contest: string }).contest]} />
        <Line type="monotone" dataKey="rating" name={label} stroke={color} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PowerRankChart({ points }: { points: { t: number; power: number; rank: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={points} margin={{ top: 8, right: 0, left: -8, bottom: 0 }}>
        {grid}
        <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={shortDate} tick={axis} minTickGap={30} />
        <YAxis yAxisId="power" tick={axis} width={40} domain={["auto", "auto"]} />
        {/* Rank axis inverted: #1 at the top */}
        <YAxis yAxisId="rank" orientation="right" reversed allowDecimals={false} tick={axis} width={32} domain={[1, "dataMax"]} tickFormatter={(v) => `#${v}`} />
        <Tooltip {...tooltipStyle} labelFormatter={(t) => shortDate(Number(t))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line yAxisId="power" type="monotone" dataKey="power" name="Power" stroke="var(--chart-2)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line yAxisId="rank" type="stepAfter" dataKey="rank" name="Overall rank" stroke="var(--chart-1)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SolvedStackChart({ points }: { points: { t: number; leetcode: number; codeforces: number; codechef: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={points} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        {grid}
        <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={shortDate} tick={axis} minTickGap={30} />
        <YAxis tick={axis} width={44} />
        <Tooltip {...tooltipStyle} labelFormatter={(t) => shortDate(Number(t))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="leetcode" name="LeetCode" stackId="1" stroke={PLATFORM_COLOR.leetcode} fill={PLATFORM_COLOR.leetcode} fillOpacity={0.35} isAnimationActive={false} />
        <Area type="monotone" dataKey="codeforces" name="Codeforces" stackId="1" stroke={PLATFORM_COLOR.codeforces} fill={PLATFORM_COLOR.codeforces} fillOpacity={0.35} isAnimationActive={false} />
        <Area type="monotone" dataKey="codechef" name="CodeChef" stackId="1" stroke={PLATFORM_COLOR.codechef} fill={PLATFORM_COLOR.codechef} fillOpacity={0.35} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DifficultyChart({ data, color }: { data: { label: string; count: number }[]; color: string }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        {grid}
        <XAxis dataKey="label" tick={axis} interval={0} />
        <YAxis tick={axis} allowDecimals={false} width={44} />
        <Tooltip {...tooltipStyle} cursor={{ fill: "var(--accent)" }} />
        <Bar dataKey="count" name="Solved" fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} label={{ position: "top", fontSize: 11, fill: "var(--muted-foreground)" }}>
          {/* Recharts 3 ignores Bar.fill here; colour each cell explicitly. */}
          {data.map((d) => (
            <Cell key={d.label} fill={color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
