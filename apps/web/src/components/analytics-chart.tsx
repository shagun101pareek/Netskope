"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AnalyticsReport } from "@/lib/client";

export function AnalyticsChart({ distribution }: { distribution: AnalyticsReport["distribution"] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={distribution}>
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
          <Tooltip />
          <Bar dataKey="count" fill="#14171c" radius={4} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
