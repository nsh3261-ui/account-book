import {
  GoogleGenerativeAI,
  SchemaType,
  type GenerationConfig,
  type Part,
} from "@google/generative-ai";
import { normalizeCategory, type Category } from "@/lib/categories";
import { supabase } from "@/lib/supabase";

type ExpenseDraft = {
  date: string;
  amount: number;
  description: string;
  category: Category;
};

const MODEL_NAMES = ["gemini-3.1-flash-lite"];
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 4 * 1024 * 1024;

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

function shiftDate(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeDraft(value: unknown): ExpenseDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<ExpenseDraft>;
  const date = typeof draft.date === "string" ? draft.date.trim() : "";
  const description =
    typeof draft.description === "string" ? draft.description.trim() : "";
  const amount = Number(draft.amount);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
    return null;
  }
  if (!description || description.length > 80) return null;

  return {
    date,
    amount: Math.round(amount),
    description,
    category: normalizeCategory(draft.category),
  };
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
    return "영수증에서 날짜와 금액을 읽지 못했어요. 더 선명한 사진으로 다시 올려 주세요.";
  }
  if (!hasDate) {
    return "영수증에서 날짜를 읽지 못했어요. 날짜가 보이게 다시 찍어 주세요.";
  }
  if (!hasAmount) {
    return "영수증에서 금액을 읽지 못했어요. 합계가 보이게 다시 찍어 주세요.";
  }
  if (!description) {
    return "가게 이름을 읽지 못했어요. 상호가 보이게 다시 찍어 주세요.";
  }
  return "영수증을 다시 올려 주세요.";
}

function savedMessage(expense: ExpenseDraft) {
  const [, month, day] = expense.date.split("-");
  const amount = expense.amount.toLocaleString("ko-KR");
  return `영수증을 확인했어요. ${Number(month)}월 ${Number(day)}일 ${expense.description} ${amount}원을 ${expense.category}로 저장했어요!`;
}

async function generateFromParts(
  genAI: GoogleGenerativeAI,
  options: {
    systemInstruction: string;
    generationConfig: GenerationConfig;
    parts: Part[];
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
          contents: [{ role: "user", parts: options.parts }],
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

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Gemini API 키가 설정되어 있지 않습니다." },
      { status: 500 },
    );
  }

  let body: { image?: unknown; mimeType?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "요청을 읽을 수 없습니다." }, { status: 400 });
  }

  const mimeType =
    typeof body.mimeType === "string" ? body.mimeType.trim().toLowerCase() : "";
  const image =
    typeof body.image === "string"
      ? body.image.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "")
      : "";

  if (!ALLOWED_TYPES.has(mimeType)) {
    return Response.json(
      { error: "JPEG, PNG, WebP, GIF 이미지만 올릴 수 있어요." },
      { status: 400 },
    );
  }

  if (!image || image.length > MAX_BYTES * 1.4) {
    return Response.json(
      { error: "이미지 크기가 너무 커요. 4MB 이하로 올려 주세요." },
      { status: 400 },
    );
  }

  const today = seoulToday();
  const yesterday = shiftDate(today, -1);
  const genAI = new GoogleGenerativeAI(apiKey);

  let parsed: {
    date?: unknown;
    amount?: unknown;
    description?: unknown;
    category?: unknown;
  };
  try {
    const text = await generateFromParts(genAI, {
      systemInstruction: `영수증 사진을 보고 지출 정보를 추출합니다.
오늘 날짜는 ${today}이고 어제는 ${yesterday}입니다. 시간대는 Asia/Seoul입니다.
date는 YYYY-MM-DD, amount는 결제 총액(원 단위 정수), description은 가게 이름입니다.
category는 반드시 다음 중 하나입니다: 식비, 교통, 쇼핑, 문화, 기타.
예: 식당/카페=식비, 주유/택시=교통, 마트/편의점=쇼핑, 영화/공연=문화, 그 외=기타.
합계/총액/결제금액/받을금액 중 최종 결제 금액을 사용하세요.
날짜가 없으면 ${today}를 쓰고, 가게 이름이 없으면 "영수증"을 쓰세요.
영수증이 아니거나 읽을 수 없으면 date는 빈 문자열, amount는 0, description은 빈 문자열, category는 기타입니다.
JSON만 반환합니다. { "date": "", "amount": 0, "description": "", "category": "기타" }`,
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
            category: { type: SchemaType.STRING },
          },
          required: ["date", "amount", "description", "category"],
        },
      },
      parts: [
        {
          text: "이 영수증에서 날짜, 결제 금액, 가게 이름, 카테고리를 추출해 주세요.",
        },
        {
          inlineData: {
            mimeType,
            data: image,
          },
        },
      ],
    });
    parsed = JSON.parse(text);
  } catch (error) {
    console.error(safeError(error));
    return Response.json(
      { error: "영수증을 읽지 못했어요. 잠시 후 다시 시도해 주세요." },
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
    .select("id, created_at, date, amount, description, category")
    .single();

  if (saveError || !saved) {
    return Response.json(
      { error: "지출을 저장하지 못했어요. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }

  const expense = {
    ...saved,
    category: normalizeCategory(saved.category),
  };

  return Response.json({
    date: expense.date,
    amount: expense.amount,
    description: expense.description,
    category: expense.category,
    reply: savedMessage(expense),
    expense,
  });
}
