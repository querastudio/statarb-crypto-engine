"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import type { EquityPoint } from "@/lib/types";

/** Plots the z-score path with entry/exit/stop bands. */
export function ZScoreChart({
  data,
  entry = 2,
  exit = 0.5,
  stop = 3.5,
}: {
  data: EquityPoint[];
  entry?: number;
  exit?: number;
  stop?: number;
}) {
  const chartData = data.map((p) => ({ index: p.index, z: Number(p.zscore.toFixed(3)) }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="#232838" strokeDasharray="3 3" />
        <XAxis dataKey="index" stroke="#8b93a7" fontSize={12} />
        <YAxis stroke="#8b93a7" fontSize={12} domain={[-4, 4]} />
        <Tooltip
          contentStyle={{
            background: "#131722",
            border: "1px solid #232838",
            borderRadius: 8,
            color: "#e6e9ef",
          }}
        />
        <ReferenceLine y={0} stroke="#8b93a7" />
        <ReferenceLine y={entry} stroke="#ef5350" strokeDasharray="4 4" />
        <ReferenceLine y={-entry} stroke="#26a69a" strokeDasharray="4 4" />
        <ReferenceLine y={exit} stroke="#8b93a7" strokeDasharray="2 2" />
        <ReferenceLine y={-exit} stroke="#8b93a7" strokeDasharray="2 2" />
        <ReferenceLine y={stop} stroke="#ef5350" />
        <ReferenceLine y={-stop} stroke="#ef5350" />
        <Line type="monotone" dataKey="z" stroke="#5b9dff" dot={false} strokeWidth={1.5} />
      </LineChart>
    </ResponsiveContainer>
  );
}
