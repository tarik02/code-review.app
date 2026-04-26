import { twMerge } from "tailwind-merge";

type CxValue =
  | string
  | number
  | bigint
  | false
  | null
  | undefined
  | CxValue[]
  | Record<string, boolean | null | undefined>;

function normalizeClassValue(value: CxValue): string[] {
  if (!value) {
    return [];
  }

  if (typeof value === "string") {
    return [value];
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap(normalizeClassValue);
  }

  return Object.entries(value)
    .filter(([, enabled]) => enabled)
    .map(([className]) => className);
}

function cx(...values: CxValue[]) {
  return twMerge(normalizeClassValue(values).join(" "));
}

export { cx };
export type { CxValue };
