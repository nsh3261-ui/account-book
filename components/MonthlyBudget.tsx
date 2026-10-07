"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Expense = {
  date: string;
  amount: number;
};

const STORAGE_KEY = "account-book-monthly-budget";

function currentMonthKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  return `${year}년 ${Number(month)}월`;
}

function formatWon(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function readBudgets() {
  if (typeof window === "undefined") return {} as Record<string, number>;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getBudgetAlert(expenses: Expense[]) {
  const monthKey = currentMonthKey();
  const budget = readBudgets()[monthKey] ?? 0;
  if (budget <= 0) return null;

  const spent = expenses
    .filter((item) => item.date.startsWith(monthKey))
    .reduce((sum, item) => sum + item.amount, 0);
  const percent = Math.round((spent / budget) * 100);

  if (spent > budget) {
    return `이번 달 예산을 ${formatWon(spent - budget)} 초과했어요.`;
  }
  if (percent >= 80) {
    return `이번 달 예산의 ${percent}%를 사용했어요. 남은 금액은 ${formatWon(budget - spent)}입니다.`;
  }
  return null;
}

export default function MonthlyBudget({ expenses }: { expenses: Expense[] }) {
  const [monthKey, setMonthKey] = useState("");
  const [budget, setBudget] = useState(0);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const key = currentMonthKey();
    const stored = readBudgets()[key] ?? 0;
    setMonthKey(key);
    setBudget(stored);
    setDraft(stored > 0 ? String(stored) : "");
    setEditing(stored <= 0);
  }, []);

  const spent = useMemo(() => {
    if (!monthKey) return 0;
    return expenses
      .filter((item) => item.date.startsWith(monthKey))
      .reduce((sum, item) => sum + item.amount, 0);
  }, [expenses, monthKey]);

  const ratio = budget > 0 ? Math.min(spent / budget, 1) : 0;
  const percent = budget > 0 ? Math.round((spent / budget) * 100) : 0;
  const warning = budget > 0 && percent >= 80;
  const over = budget > 0 && spent > budget;

  function saveBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!monthKey) return;
    const value = Number(draft.replaceAll(",", "").trim());
    if (!Number.isFinite(value) || value <= 0) return;

    const next = Math.round(value);
    const budgets = readBudgets();
    budgets[monthKey] = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(budgets));
    setBudget(next);
    setDraft(String(next));
    setEditing(false);
  }

  if (!monthKey) return null;

  return (
    <section className="px-5 pb-4" aria-label="이번 달 예산">
      <div className="rounded-2xl bg-[#e9e9ee] px-4 py-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-zinc-500">{monthLabel(monthKey)} 예산</p>
            {budget > 0 && !editing ? (
              <p className="mt-1 font-mono text-2xl font-medium tracking-tight">
                {formatWon(budget)}
              </p>
            ) : (
              <p className="mt-1 text-base text-zinc-500">예산을 설정해 주세요</p>
            )}
          </div>
          {budget > 0 && !editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="shrink-0 text-sm text-zinc-500 transition-colors hover:text-[#1d1d1f]"
            >
              수정
            </button>
          ) : null}
        </div>

        {editing ? (
          <form onSubmit={saveBudget} className="flex gap-2">
            <input
              type="number"
              inputMode="numeric"
              min="1"
              step="1000"
              placeholder="예: 500000"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="h-12 min-w-0 flex-1 rounded-xl bg-white px-4 font-mono text-base outline-none"
              required
            />
            <button
              type="submit"
              className="h-12 shrink-0 rounded-xl bg-[#1d1d1f] px-4 text-sm font-medium text-white transition-colors hover:bg-black"
            >
              저장
            </button>
          </form>
        ) : (
          <>
            <div className="mb-2 flex items-end justify-between gap-3">
              <p className="text-sm text-zinc-500">
                사용{" "}
                <span className="font-mono font-medium text-[#1d1d1f]">
                  {formatWon(spent)}
                </span>
              </p>
              <p className="font-mono text-lg font-medium tracking-tight">
                {percent}%
              </p>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-white"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="이번 달 예산 사용률"
            >
              <div
                className={
                  over
                    ? "h-full rounded-full bg-[#1d1d1f] transition-all"
                    : warning
                      ? "h-full rounded-full bg-[#52525b] transition-all"
                      : "h-full rounded-full bg-[#1d1d1f] transition-all"
                }
                style={{ width: `${Math.max(ratio * 100, spent > 0 ? 2 : 0)}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-zinc-500">
              남은 예산 {formatWon(Math.max(budget - spent, 0))}
            </p>
            {warning ? (
              <p
                className="mt-3 rounded-xl bg-white px-3 py-3 text-sm leading-relaxed text-[#1d1d1f]"
                role="alert"
              >
                {over
                  ? `예산을 ${formatWon(spent - budget)} 초과했어요. 이번 달 지출을 조금 줄여 보세요.`
                  : `예산의 ${percent}%를 사용했어요. 남은 금액은 ${formatWon(budget - spent)}입니다.`}
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
