"use client";

import dynamic from "next/dynamic";
import { FormEvent, useEffect, useRef, useState } from "react";
import MonthlyBudget, { getBudgetAlert } from "@/components/MonthlyBudget";
import { CATEGORIES, normalizeCategory, type Category } from "@/lib/categories";
import { supabase } from "@/lib/supabase";

const ExpenseCharts = dynamic(() => import("@/components/ExpenseCharts"), {
  ssr: false,
});

type Expense = {
  id: number;
  created_at: string;
  date: string;
  amount: number;
  description: string;
  category: Category;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  imageUrl?: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike> & {
    length: number;
  };
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const welcome: Message = {
  id: "welcome",
  role: "assistant",
  text: "안녕하세요. 쓴 돈을 말씀해 주시면 기록해 드릴게요.\n예: 오늘 점심 12000원\n질문도 가능해요. 예: 이번 달 총 지출이 얼마야?\n마이크나 영수증 사진으로도 입력할 수 있어요.",
};

function formatAmount(value: number) {
  return value.toLocaleString("ko-KR");
}

function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return (
    speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null
  );
}

export default function Home() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<"전체" | Category>("전체");
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const messagesRef = useRef(messages);
  const expensesRef = useRef(expenses);
  const sendingRef = useRef(sending);
  const listeningRef = useRef(false);
  const baseDraftRef = useRef("");

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    expensesRef.current = expenses;
  }, [expenses]);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  useEffect(() => {
    let ignore = false;

    async function loadExpenses() {
      const { data, error } = await supabase
        .from("expenses")
        .select("id, created_at, date, amount, description, category")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      if (ignore) return;
      if (!error && data) {
        const rows = data.map((item) => ({
          ...item,
          category: normalizeCategory(item.category),
        }));
        setExpenses((current) => mergeExpenses(current, rows));
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
  }, [messages, sending, listening]);

  useEffect(() => {
    const SpeechRecognition = getSpeechRecognition();
    setSpeechSupported(Boolean(SpeechRecognition));
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = "ko-KR";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript?.trim() ?? "";
        if (!transcript) continue;
        if (result.isFinal) finalText += `${transcript} `;
        else interim += transcript;
      }

      const spoken = (finalText || interim).trim();
      if (!spoken) return;

      const next = [baseDraftRef.current, spoken].filter(Boolean).join(" ");
      setDraft(next);

      if (finalText.trim()) {
        void sendMessage(next);
      }
    };

    recognition.onerror = (event) => {
      listeningRef.current = false;
      setListening(false);

      if (event.error === "aborted" || event.error === "no-speech") return;

      const text =
        event.error === "not-allowed"
          ? "마이크 사용이 허용되지 않았어요. 브라우저 설정에서 마이크를 허용해 주세요."
          : "음성을 인식하지 못했어요. 다시 말해 주세요.";

      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", text },
      ]);
    };

    recognition.onend = () => {
      listeningRef.current = false;
      setListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  async function sendMessage(rawText: string) {
    const text = rawText.trim();
    if (!text || sendingRef.current) return;

    if (listeningRef.current) {
      recognitionRef.current?.stop();
      listeningRef.current = false;
      setListening(false);
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text,
    };
    const history = messagesRef.current
      .filter((item) => item.id !== welcome.id)
      .map((item) => ({ role: item.role, text: item.text }));

    setMessages((current) => [...current, userMessage]);
    setDraft("");
    baseDraftRef.current = "";
    setSending(true);
    sendingRef.current = true;

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
        throw new Error(
          "지금은 응답을 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
      }

      if (!response.ok) {
        throw new Error(
          payload.error ||
            "지금은 응답을 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
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
        rememberExpense(payload.expense);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.";
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", text: message },
      ]);
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }


  function rememberExpense(expense: Expense) {
    const normalized = {
      ...expense,
      category: normalizeCategory(expense.category),
    };
    const next = mergeExpenses([normalized], expensesRef.current);
    expensesRef.current = next;
    setExpenses(next);

    const alert = getBudgetAlert(next);
    if (alert) {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", text: alert },
      ]);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  async function handleReceiptUpload(file: File | null) {
    if (!file || sendingRef.current) return;

    if (listeningRef.current) {
      recognitionRef.current?.stop();
      listeningRef.current = false;
      setListening(false);
    }

    if (!file.type.startsWith("image/")) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "이미지 파일만 올릴 수 있어요.",
        },
      ]);
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: "영수증을 올렸어요.",
        imageUrl: previewUrl,
      },
    ]);
    setSending(true);
    sendingRef.current = true;

    try {
      const { mimeType, data } = await readImageAsBase64(file);
      const response = await fetch("/api/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: data, mimeType }),
      });
      const raw = await response.text();
      let payload: { reply?: string; expense?: Expense | null; error?: string };
      try {
        payload = JSON.parse(raw) as typeof payload;
      } catch {
        throw new Error("영수증을 읽지 못했어요. 잠시 후 다시 시도해 주세요.");
      }

      if (!response.ok) {
        throw new Error(
          payload.error || "영수증을 읽지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
      }

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: payload.reply || "영수증을 저장했어요.",
        },
      ]);

      if (payload.expense) {
        rememberExpense(payload.expense);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "영수증을 읽지 못했어요. 잠시 후 다시 시도해 주세요.";
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", text: message },
      ]);
    } finally {
      setSending(false);
      sendingRef.current = false;
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function toggleListening() {
    const recognition = recognitionRef.current;
    if (!recognition || sending) return;

    if (listeningRef.current) {
      recognition.stop();
      listeningRef.current = false;
      setListening(false);
      return;
    }

    baseDraftRef.current = draft.trim();
    listeningRef.current = true;
    setListening(true);

    try {
      recognition.start();
    } catch {
      listeningRef.current = false;
      setListening(false);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "마이크를 시작할 수 없어요. 잠시 후 다시 시도해 주세요.",
        },
      ]);
    }
  }

  const filteredExpenses =
    categoryFilter === "전체"
      ? expenses
      : expenses.filter(
          (item) => normalizeCategory(item.category) === categoryFilter,
        );

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-lg flex-1 flex-col bg-[#f5f5f7] text-[#1d1d1f]">
      <header className="px-5 pb-4 pt-6">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-3xl">
          AI 가계부 챗봇
        </h1>
      </header>

      <div className="max-h-[42vh] shrink-0 overflow-y-auto">
        <MonthlyBudget expenses={expenses} />

        {loaded && expenses.length > 0 ? (
          <ExpenseCharts expenses={expenses} />
        ) : null}

        <section className="px-5" aria-label="저장된 지출 내역">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm text-zinc-400">지출 내역</p>
          </div>
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {(["전체", ...CATEGORIES] as const).map((category) => {
              const selected = categoryFilter === category;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setCategoryFilter(category)}
                  className={
                    selected
                      ? "shrink-0 rounded-full bg-[#1d1d1f] px-3 py-1.5 text-sm text-white"
                      : "shrink-0 rounded-full bg-white px-3 py-1.5 text-sm text-zinc-500 transition-colors hover:text-[#1d1d1f]"
                  }
                >
                  {category}
                </button>
              );
            })}
          </div>
          {!loaded ? (
            <p className="pb-2 text-base text-zinc-400">불러오는 중</p>
          ) : expenses.length === 0 ? (
            <p className="pb-2 text-base text-zinc-400">
              아직 기록된 지출이 없습니다.
            </p>
          ) : filteredExpenses.length === 0 ? (
            <p className="pb-2 text-base text-zinc-400">
              이 카테고리의 지출이 없습니다.
            </p>
          ) : (
            <ul className="flex gap-3 overflow-x-auto pb-2">
              {filteredExpenses.map((item) => (
                <li
                  key={item.id}
                  className="w-44 shrink-0 rounded-2xl bg-[#e9e9ee] px-4 py-4"
                >
                  <p className="text-xs text-zinc-500">
                    {normalizeCategory(item.category)}
                  </p>
                  <p className="mt-1 truncate text-base font-medium">
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
      </div>

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
            <div
              className={
                message.role === "user"
                  ? "max-w-[80%] overflow-hidden rounded-2xl rounded-br-md bg-[#1d1d1f] text-white"
                  : "max-w-[80%] overflow-hidden rounded-2xl rounded-bl-md bg-white"
              }
            >
              {message.imageUrl ? (
                <img
                  src={message.imageUrl}
                  alt="올린 영수증"
                  className="max-h-56 w-full object-cover"
                />
              ) : null}
              <p className="whitespace-pre-wrap px-4 py-3 text-base leading-relaxed">
                {message.text}
              </p>
            </div>
          </div>
        ))}
        {listening ? (
          <div className="flex justify-start">
            <p className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-base text-zinc-400">
              듣고 있어요
            </p>
          </div>
        ) : null}
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
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            void handleReceiptUpload(file);
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending || listening}
          aria-label="영수증 사진 업로드"
          className="flex h-14 w-14 shrink-0 touch-manipulation items-center justify-center rounded-full bg-white text-[#1d1d1f] transition-colors hover:bg-[#ececf0] disabled:cursor-not-allowed disabled:text-zinc-300"
        >
          <ImageIcon />
        </button>
        {speechSupported ? (
          <button
            type="button"
            onClick={toggleListening}
            disabled={sending}
            aria-label={listening ? "음성 인식 중지" : "음성 인식 시작"}
            aria-pressed={listening}
            className={
              listening
                ? "flex h-14 w-14 shrink-0 touch-manipulation items-center justify-center rounded-full bg-[#1d1d1f] text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-zinc-300"
                : "flex h-14 w-14 shrink-0 touch-manipulation items-center justify-center rounded-full bg-white text-[#1d1d1f] transition-colors hover:bg-[#ececf0] disabled:cursor-not-allowed disabled:text-zinc-300"
            }
          >
            <MicIcon listening={listening} />
          </button>
        ) : null}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            listening
              ? "듣고 있어요..."
              : "오늘 점심 12000원 / 이번 달 총 지출이 얼마야?"
          }
          aria-label="메시지"
          autoComplete="off"
          className="h-14 min-w-0 flex-1 rounded-full bg-white px-5 text-base text-[#1d1d1f] outline-none placeholder:text-zinc-400"
        />
        <button
          type="submit"
          disabled={sending || listening || !draft.trim()}
          className="h-14 shrink-0 touch-manipulation rounded-full bg-[#1d1d1f] px-5 text-base font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          전송
        </button>
      </form>
    </div>
  );
}

function ImageIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m21 16-5.5-5.5L7 19" />
    </svg>
  );
}

function MicIcon({ listening }: { listening: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
      {listening ? (
        <circle
          cx="12"
          cy="12"
          r="10"
          opacity="0.15"
          fill="currentColor"
          stroke="none"
        />
      ) : null}
    </svg>
  );
}

async function readImageAsBase64(file: File) {
  const resized = await resizeImage(file, 1600, 0.82);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("이미지를 읽지 못했어요."));
    reader.readAsDataURL(resized);
  });

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("이미지를 읽지 못했어요.");

  return {
    mimeType: match[1],
    data: match[2],
  };
}

async function resizeImage(file: File, maxSize: number, quality: number) {
  if (typeof createImageBitmap !== "function") return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file;
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });

  if (!blob) return file;
  return new File([blob], "receipt.jpg", { type: "image/jpeg" });
}

function mergeExpenses(newest: Expense[], older: Expense[]) {
  const map = new Map<number, Expense>();
  for (const item of [...newest, ...older]) map.set(item.id, item);
  return [...map.values()].sort((a, b) => {
    if (a.created_at === b.created_at) return b.id - a.id;
    return a.created_at < b.created_at ? 1 : -1;
  });
}
