"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Expense = {
  id: number;
  created_at: string;
  date: string;
  amount: number;
  description: string;
};

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function Amount({
  value,
  className,
}: {
  value: number;
  className: string;
}) {
  return (
    <p className="shrink-0 whitespace-nowrap text-[#1d1d1f]">
      <span className={`font-mono font-medium leading-none tracking-tight ${className}`}>
        {value.toLocaleString("ko-KR")}
      </span>
      <span className="ml-1 align-baseline text-sm font-normal text-zinc-400">
        원
      </span>
    </p>
  );
}

const fieldClassName =
  "h-14 w-full min-w-0 rounded-xl bg-white px-4 text-lg text-[#1d1d1f] outline-none transition-colors placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-[#1d1d1f]/10 sm:h-12 sm:text-base";

export default function Home() {
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDate(today());

    let ignore = false;

    async function loadExpenses() {
      const { data, error: loadError } = await supabase
        .from("expenses")
        .select("id, created_at, date, amount, description")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      if (ignore) return;

      if (loadError) {
        setError("지출 내역을 불러오지 못했습니다.");
        setLoaded(true);
        return;
      }

      setExpenses(data ?? []);
      setLoaded(true);
    }

    loadExpenses();

    return () => {
      ignore = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(amount.replaceAll(",", "").trim());
    const memo = description.trim();

    if (!date || !memo || !Number.isFinite(value) || value <= 0) {
      setError("날짜, 금액, 내용을 모두 입력해 주세요.");
      return;
    }

    setSaving(true);
    setError("");

    const { data, error: saveError } = await supabase
      .from("expenses")
      .insert({
        date,
        amount: Math.round(value),
        description: memo,
      })
      .select("id, created_at, date, amount, description")
      .single();

    setSaving(false);

    if (saveError || !data) {
      setError("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    setExpenses((current) => [data, ...current]);
    setDate("");
    setAmount("");
    setDescription("");
  }

  const total = expenses.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="min-h-full w-full flex-1 overflow-x-clip bg-[#f5f5f7] text-[#1d1d1f]">
      <div className="mx-auto flex w-full max-w-lg flex-col px-5 py-12 sm:px-6 sm:py-24">
        <header className="mb-12 sm:mb-16">
          <h1 className="text-[2.5rem] font-semibold leading-tight tracking-tight sm:text-4xl">
            나의 스마트 가계부
          </h1>
          <p className="mt-3 text-lg text-zinc-500 sm:text-base">
            오늘 쓴 돈을 간단히 기록해 보세요.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="w-full">
          <div className="grid gap-8 sm:gap-7">
            <label className="grid gap-3 text-base font-medium text-zinc-500 sm:text-sm">
              날짜
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className={fieldClassName}
                required
              />
            </label>

            <label className="grid gap-3 text-base font-medium text-zinc-500 sm:text-sm">
              금액
              <input
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                placeholder="12,000"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className={`${fieldClassName} font-mono`}
                required
              />
            </label>

            <label className="grid gap-3 text-base font-medium text-zinc-500 sm:text-sm">
              내용
              <input
                type="text"
                placeholder="점심 식사"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className={fieldClassName}
                required
              />
            </label>
          </div>

          {error ? (
            <p className="mt-6 text-base text-[#1d1d1f] sm:text-sm" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={saving}
            className="mt-10 h-16 w-full touch-manipulation rounded-xl bg-[#1d1d1f] text-lg font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-zinc-300 sm:mt-8 sm:h-14 sm:text-base"
          >
            {saving ? "저장 중" : "저장하기"}
          </button>
        </form>

        <section className="mt-16 w-full sm:mt-20">
          <div className="mb-8 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-xl">
              지출 내역
            </h2>
            <div>
              <p className="mb-2 text-sm text-zinc-400">합계</p>
              <Amount value={total} className="text-4xl sm:text-3xl" />
            </div>
          </div>

          {!loaded ? (
            <p className="py-10 text-base text-zinc-400 sm:text-sm">
              지출 내역을 불러오는 중입니다.
            </p>
          ) : expenses.length === 0 ? (
            <p className="py-10 text-base text-zinc-400 sm:text-sm">
              아직 기록된 지출이 없습니다.
            </p>
          ) : (
            <ul className="grid gap-3">
              {expenses.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-6 rounded-2xl bg-[#e9e9ee] px-5 py-5"
                >
                  <div className="min-w-0">
                    <p className="break-words text-lg font-medium sm:text-base">
                      {item.description}
                    </p>
                    <p className="mt-1.5 text-base text-zinc-400 sm:text-sm">
                      {item.date}
                    </p>
                  </div>
                  <Amount
                    value={item.amount}
                    className="text-[1.75rem] sm:text-2xl"
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
