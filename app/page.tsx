"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Expense = {
  id: number;
  created_at: string;
  date: string;
  amount: number;
  description: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const welcome: Message = {
  id: "welcome",
  role: "assistant",
  text: "안녕하세요. 쓴 돈을 말씀해 주시면 기록해 드릴게요.\n예: 오늘 점심 12000원\n질문도 가능해요. 예: 이번 달 총 지출이 얼마야?",
};

function formatAmount(value: number) {
  return value.toLocaleString("ko-KR");
}

export default function Home() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ignore = false;

    async function loadExpenses() {
      const { data, error } = await supabase
        .from("expenses")
        .select("id, created_at, date, amount, description")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      if (ignore) return;
      if (!error && data) {
        setExpenses((current) => mergeExpenses(current, data));
      }
      setLoaded(true);
    }

    loadExpenses();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text,
    };
    const history = messages
      .filter((item) => item.id !== welcome.id)
      .map((item) => ({ role: item.role, text: item.text }));

    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      const raw = await response.text();
      let payload: { reply?: string; expense?: Expense | null; error?: string };
      try {
        payload = JSON.parse(raw) as typeof payload;
      } catch {
        throw new Error("지금은 응답을 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
      }

      if (!response.ok) {
        throw new Error(
          payload.error || "지금은 응답을 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
      }

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: payload.reply || "기록해 두었어요.",
        },
      ]);

      if (payload.expense) {
        setExpenses((current) => mergeExpenses([payload.expense as Expense], current));
      }
    } catch (error) {
      const text =
        error instanceof Error
          ? error.message
          : "응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.";
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", text },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-lg flex-1 flex-col bg-[#f5f5f7] text-[#1d1d1f]">
      <header className="px-5 pb-4 pt-6">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-3xl">
          AI 가계부 챗봇
        </h1>
      </header>

      <section className="px-5" aria-label="저장된 지출 내역">
        <p className="mb-3 text-sm text-zinc-400">지출 내역</p>
        {!loaded ? (
          <p className="pb-2 text-base text-zinc-400">불러오는 중</p>
        ) : expenses.length === 0 ? (
          <p className="pb-2 text-base text-zinc-400">
            아직 기록된 지출이 없습니다.
          </p>
        ) : (
          <ul className="flex gap-3 overflow-x-auto pb-2">
            {expenses.map((item) => (
              <li
                key={item.id}
                className="w-44 shrink-0 rounded-2xl bg-[#e9e9ee] px-4 py-4"
              >
                <p className="truncate text-base font-medium">
                  {item.description}
                </p>
                <p className="mt-1 text-sm text-zinc-500">{item.date}</p>
                <p className="mt-3 whitespace-nowrap font-mono text-xl font-medium tracking-tight">
                  {formatAmount(item.amount)}
                  <span className="ml-1 text-sm font-sans font-normal text-zinc-400">
                    원
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div
        className="mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === "user" ? "flex justify-end" : "flex justify-start"
            }
          >
            <p
              className={
                message.role === "user"
                  ? "max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#1d1d1f] px-4 py-3 text-base leading-relaxed text-white"
                  : "max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-white px-4 py-3 text-base leading-relaxed"
              }
            >
              {message.text}
            </p>
          </div>
        ))}
        {sending ? (
          <div className="flex justify-start">
            <p className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-base text-zinc-400">
              생각 중
            </p>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="오늘 점심 12000원 / 이번 달 총 지출이 얼마야?"
          aria-label="메시지"
          autoComplete="off"
          className="h-14 min-w-0 flex-1 rounded-full bg-white px-5 text-base text-[#1d1d1f] outline-none placeholder:text-zinc-400"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="h-14 shrink-0 touch-manipulation rounded-full bg-[#1d1d1f] px-5 text-base font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          전송
        </button>
      </form>
    </div>
  );
}

function mergeExpenses(newest: Expense[], older: Expense[]) {
  const map = new Map<number, Expense>();
  for (const item of [...newest, ...older]) map.set(item.id, item);
  return [...map.values()].sort((a, b) => {
    if (a.created_at === b.created_at) return b.id - a.id;
    return a.created_at < b.created_at ? 1 : -1;
  });
}
