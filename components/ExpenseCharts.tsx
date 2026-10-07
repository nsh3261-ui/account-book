"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CATEGORIES, normalizeCategory, type Category } from "@/lib/categories";

type Expense = {
  date: string;
  amount: number;
  description: string;
  category?: string | null;
};

const PIE_COLORS = [
  "#1d1d1f",
  "#3f3f46",
  "#52525b",
  "#71717a",
  "#a1a1aa",
  "#d4d4d8",
];

function monthLabel(key: string) {
  const [, month] = key.split("-");
  return `${Number(month)}월`;
}

function buildMonthly(expenses: Expense[]) {
  const totals = new Map<string, number>();

  for (const item of expenses) {
    const key = item.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    totals.set(key, (totals.get(key) ?? 0) + item.amount);
  }

  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-6)
    .map(([key, total]) => ({
      month: monthLabel(key),
      key,
      total,
    }));
}

function buildCategories(expenses: Expense[]) {
  const totals = new Map<Category, number>();
  for (const name of CATEGORIES) totals.set(name, 0);

  for (const item of expenses) {
    const category = normalizeCategory(item.category);
    totals.set(category, (totals.get(category) ?? 0) + item.amount);
  }

  return [...totals.entries()]
    .map(([name, value]) => ({ name, value }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
}

function formatWon(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

export default function ExpenseCharts({ expenses }: { expenses: Expense[] }) {
  const monthly = buildMonthly(expenses);
  const categories = buildCategories(expenses);

  if (expenses.length === 0) return null;

  return (
    <section className="px-5 pb-4" aria-label="지출 차트">
      <div className="grid gap-4">
        <div className="rounded-2xl bg-[#e9e9ee] px-4 py-4">
          <p className="mb-3 text-sm text-zinc-500">월별 총 지출</p>
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#d4d4d8" vertical={false} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "#71717a", fontSize: 12 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tick={{ fill: "#a1a1aa", fontSize: 11 }}
                  tickFormatter={(value: number) =>
                    value >= 10000
                      ? `${Math.round(value / 10000)}만`
                      : String(value)
                  }
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.45)" }}
                  contentStyle={{
                    border: "none",
                    borderRadius: 12,
                    background: "#ffffff",
                    boxShadow: "none",
                    color: "#1d1d1f",
                    fontSize: 13,
                  }}
                  formatter={(value) => [
                    formatWon(Number(value ?? 0)),
                    "총 지출",
                  ]}
                />
                <Bar dataKey="total" fill="#1d1d1f" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl bg-[#e9e9ee] px-4 py-4">
          <p className="mb-3 text-sm text-zinc-500">카테고리별 지출</p>
          <div className="flex h-48 items-center gap-2">
            <div className="h-full min-w-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categories}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={72}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {categories.map((entry, index) => (
                      <Cell
                        key={entry.name}
                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      border: "none",
                      borderRadius: 12,
                      background: "#ffffff",
                      boxShadow: "none",
                      color: "#1d1d1f",
                      fontSize: 13,
                    }}
                    formatter={(value, name) => [
                      formatWon(Number(value ?? 0)),
                      String(name),
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="w-28 shrink-0 space-y-2">
              {categories.map((entry, index) => (
                <li
                  key={entry.name}
                  className="flex items-center gap-2 text-sm text-zinc-600"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: PIE_COLORS[index % PIE_COLORS.length],
                    }}
                  />
                  <span className="truncate">{entry.name}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
