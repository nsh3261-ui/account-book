export const CATEGORIES = ["식비", "교통", "쇼핑", "문화", "기타"] as const;

export type Category = (typeof CATEGORIES)[number];

export function normalizeCategory(value: unknown): Category {
  if (typeof value !== "string") return "기타";
  const trimmed = value.trim();
  return (CATEGORIES as readonly string[]).includes(trimmed)
    ? (trimmed as Category)
    : "기타";
}
