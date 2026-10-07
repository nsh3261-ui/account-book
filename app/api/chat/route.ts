import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { supabase } from "@/lib/supabase";

type ChatTurn = {
  role: "user" | "assistant";
  text: string;
};

type ExpenseDraft = {
  date: string;
  amount: number;
  description: string;
};

type ExpenseRecord = ExpenseDraft & {
  id?: number;
  created_at?: string;
};

const MODEL_NAMES = ["gemini-3.1-flash-lite"];

const AMOUNT_PATTERN =
  /(?:\d{1,3}(?:,\d{3})*|\d+(?:\.\d+)?)\s*만?\s*원|(?:[일이삼사오육칠팔구십백천만억]+)\s*원|\d+\s*만(?:\s*원)?/;

const QUESTION_PATTERN =
  /얼마|얼마나|뭐|뭘|무엇|어떻게|어디|언제|어느|몇\s*원|총\s*지출|가장\s*많|[?？]/;

function seoulToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown";
  return message.replace(/key=[^&\s]+/gi, "key=***").slice(0, 300);
}

function isQuestion(message: string) {
  const hasAmount = AMOUNT_PATTERN.test(message);
  const hasQuestion = QUESTION_PATTERN.test(message);
  if (hasAmount) return false;
  return hasQuestion;
}

function normalizeDraft(value: unknown): ExpenseDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<ExpenseDraft>;
  const date = typeof draft.date === "string" ? draft.date.trim() : "";
  const description =
    typeof draft.description === "string" ? draft.description.trim() : "";
  const amount = Number(draft.amount);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) return null;
  if (!description || description.length > 80) return null;

  return {
    date,
    amount: Math.round(amount),
    description,
  };
}

function buildContents(
  history: ChatTurn[],
  message: string,
  prefix?: string,
) {
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];

  for (const turn of history) {
    const role = turn.role === "assistant" ? "model" : "user";
    if (contents.length === 0 && role === "model") continue;
    const previous = contents[contents.length - 1];
    if (previous && previous.role === role) {
      previous.parts[0].text += `\n${turn.text}`;
      continue;
    }
    contents.push({ role, parts: [{ text: turn.text }] });
  }

  const current = prefix ? `${prefix}\n\n질문: ${message}` : message;
  const previous = contents[contents.length - 1];
  if (previous?.role === "user") {
    previous.parts[0].text += `\n${current}`;
  } else {
    contents.push({ role: "user", parts: [{ text: current }] });
  }

  return contents;
}

async function loadAllExpenses() {
  const pageSize = 1000;
  const rows: ExpenseRecord[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("expenses")
      .select("id, created_at, date, amount, description")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data?.length) break;

    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

function formatLedger(rows: ExpenseRecord[]) {
  if (rows.length === 0) return "없음";
  return rows
    .map((item) => `${item.date} | ${item.amount}원 | ${item.description}`)
    .join("\n");
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Gemini API 키가 설정되어 있지 않습니다." },
      { status: 500 },
    );
  }

  let body: { message?: unknown; history?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "요청을 읽을 수 없습니다." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 1000) {
    return Response.json({ error: "메시지를 입력해 주세요." }, { status: 400 });
  }

  const history = Array.isArray(body.history)
    ? body.history
        .filter((turn): turn is ChatTurn => {
          if (!turn || typeof turn !== "object") return false;
          const item = turn as Partial<ChatTurn>;
          return (
            (item.role === "user" || item.role === "assistant") &&
            typeof item.text === "string"
          );
        })
        .slice(-12)
        .map((turn) => ({ role: turn.role, text: turn.text.slice(0, 1000) }))
    : [];

  let expenses: ExpenseRecord[];
  try {
    expenses = await loadAllExpenses();
  } catch (error) {
    console.error(safeError(error));
    return Response.json(
      { error: "지출 내역을 불러오지 못했어요. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }

  const today = seoulToday();
  const yesterday = shiftDate(today, -1);
  const genAI = new GoogleGenerativeAI(apiKey);

  if (isQuestion(message)) {
    return answerQuestion(genAI, history, message, expenses, today, yesterday);
  }

  return saveExpense(genAI, history, message, expenses, today, yesterday);
}

async function answerQuestion(
  genAI: GoogleGenerativeAI,
  history: ChatTurn[],
  message: string,
  expenses: ExpenseRecord[],
  today: string,
  yesterday: string,
) {
  const ledger = formatLedger(expenses);
  const contents = buildContents(
    history,
    message,
    `저장된 지출 데이터(최신순, 총 ${expenses.length}건):\n${ledger}`,
  );

  try {
    const reply = await generateText(genAI, {
      systemInstruction: `당신은 친근한 가계부 도우미입니다. 한국어로 자연스럽고 짧게 답합니다.
오늘 날짜는 ${today}이고 어제는 ${yesterday}입니다. 시간대는 Asia/Seoul입니다.
아래에 주어진 지출 데이터만 근거로 답하세요. 없는 내용은 지어내지 마세요.
이번 달·지난주·어제 같은 기간은 오늘(${today}) 기준으로 계산하세요.
금액은 천 단위 쉼표를 넣어 말하고, 1~3문장으로 답하세요.
데이터가 없으면 아직 기록된 지출이 없다고 알려 주세요.`,
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 400,
      },
      contents,
    });

    return Response.json({
      reply: reply.trim() || "저장된 지출을 기준으로는 답을 만들기 어려워요.",
      expense: null,
    });
  } catch (error) {
    console.error(safeError(error));
    return Response.json(
      { error: "지금은 응답을 만들지 못했어요. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
}

async function saveExpense(
  genAI: GoogleGenerativeAI,
  history: ChatTurn[],
  message: string,
  expenses: ExpenseRecord[],
  today: string,
  yesterday: string,
) {
  const ledger = formatLedger(expenses.slice(0, 40));
  const contents = buildContents(
    history,
    message,
    `참고용 최근 지출:\n${ledger}`,
  );

  let parsed: { date?: unknown; amount?: unknown; description?: unknown };
  try {
    const text = await generateText(genAI, {
      systemInstruction: `가계부 문장에서 지출 정보를 추출합니다.
오늘 날짜는 ${today}이고 어제는 ${yesterday}입니다. 시간대는 Asia/Seoul입니다.
date는 YYYY-MM-DD, amount는 원 단위 정수, description은 짧은 지출 내용입니다.
"2만 원"은 20000처럼 숫자로 바꿉니다.
날짜를 모르면 date는 빈 문자열, 금액을 모르면 amount는 0, 내용을 모르면 description은 빈 문자열입니다.
지출이 아닌 문장이면 세 필드를 모두 비웁니다.
JSON만 반환합니다. { "date": "", "amount": 0, "description": "" }`,
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 200,
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            date: { type: SchemaType.STRING },
            amount: { type: SchemaType.NUMBER },
            description: { type: SchemaType.STRING },
          },
          required: ["date", "amount", "description"],
        },
      },
      contents,
    });
    parsed = JSON.parse(text);
  } catch (error) {
    console.error(safeError(error));
    return Response.json(
      { error: "지금은 응답을 만들지 못했어요. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }

  const draft = normalizeDraft(parsed);
  if (!draft) {
    return Response.json({
      reply: clarifyMessage(parsed),
      expense: null,
    });
  }

  const { data: saved, error: saveError } = await supabase
    .from("expenses")
    .insert(draft)
    .select("id, created_at, date, amount, description")
    .single();

  if (saveError || !saved) {
    return Response.json(
      { error: "지출을 저장하지 못했어요. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }

  return Response.json({
    date: saved.date,
    amount: saved.amount,
    description: saved.description,
    reply: savedMessage(saved),
    expense: saved,
  });
}

async function generateText(
  genAI: GoogleGenerativeAI,
  options: {
    systemInstruction: string;
    generationConfig: {
      temperature: number;
      maxOutputTokens: number;
      responseMimeType?: string;
      responseSchema?: {
        type: SchemaType;
        properties: {
          date: { type: SchemaType };
          amount: { type: SchemaType };
          description: { type: SchemaType };
        };
        required: string[];
      };
    };
    contents: { role: "user" | "model"; parts: { text: string }[] }[];
  },
) {
  let lastError: unknown;

  for (const modelName of MODEL_NAMES) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: options.systemInstruction,
      generationConfig: options.generationConfig,
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await model.generateContent({
          contents: options.contents,
        });
        return result.response.text();
      } catch (error) {
        lastError = error;
        const message = safeError(error);
        if (/404|not found|no longer available/i.test(message)) break;
        const retryable = /503|429|fetch failed|high demand|unavailable/i.test(
          message,
        );
        if (!retryable || attempt === 1) {
          if (modelName === MODEL_NAMES[MODEL_NAMES.length - 1]) throw error;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  }

  throw lastError;
}

function shiftDate(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function clarifyMessage(value: {
  date?: unknown;
  amount?: unknown;
  description?: unknown;
}) {
  const date = typeof value.date === "string" ? value.date.trim() : "";
  const description =
    typeof value.description === "string" ? value.description.trim() : "";
  const amount = Number(value.amount);
  const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const hasAmount = Number.isFinite(amount) && amount > 0;

  if (!hasDate && !hasAmount) {
    return "날짜와 금액을 파악하지 못했어요. 예: 오늘 점심 15000원";
  }
  if (!hasDate) return "날짜를 파악하지 못했어요. 언제 쓴 돈인지 알려 주세요.";
  if (!hasAmount) return "금액을 파악하지 못했어요. 얼마였는지 알려 주세요.";
  if (!description) return "어떤 지출인지 내용을 알려 주세요.";
  return "날짜, 금액, 내용을 다시 알려 주세요.";
}

function savedMessage(expense: ExpenseDraft) {
  const [, month, day] = expense.date.split("-");
  const amount = expense.amount.toLocaleString("ko-KR");
  return `${Number(month)}월 ${Number(day)}일 ${expense.description} ${amount}원을 저장했어요!`;
}
