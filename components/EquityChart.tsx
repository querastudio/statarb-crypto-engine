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

export function EquityChart({
  data,
  oosStartIndex,
}: {
  data: EquityPoint[];
  oosStartIndex?: number;
}) {
  const chartData = data.map((p) => ({
    index: p.index,
    Net: Number((p.equity).toFixed(4)),
    Gross: Number((p.equityGross).toFixed(4)),
  }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="#232838" strokeDasharray="3 3" />
        <XAxis dataKey="index" stroke="#8b93a7" fontSize={12} />
        <YAxis stroke="#8b93a7" fontSize={12} domain={["auto", "auto"]} />
        <Tooltip
          contentStyle={{
            background: "#131722",
            border: "1px solid #232838",
            borderRadius: 8,
            color: "#e6e9ef",
          }}
        />
        {oosStartIndex !== undefined && (
          <ReferenceLine
            x={oosStartIndex}
            stroke="#ffb74d"
            strokeDasharray="4 4"
            label={{ value: "OOS", fill: "#ffb74d", fontSize: 11, position: "top" }}
          />
        )}
        <ReferenceLine y={1} stroke="#8b93a7" strokeDasharray="2 2" />
        <Line type="monotone" dataKey="Gross" stroke="#8b93a7" dot={false} strokeWidth={1.2} />
        <Line type="monotone" dataKey="Net" stroke="#5b9dff" dot={false} strokeWidth={1.8} />
      </LineChart>
    </ResponsiveContainer>
  );
}
