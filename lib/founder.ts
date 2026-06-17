// Recognize the founder (and any other internal numbers) by caller ID.
// Normalizes to the last 10 digits so +1856…, 1856…, and 856… all match.

import { env } from "./env";

function last10(num: string): string {
  return num.replace(/\D/g, "").slice(-10);
}

function founderNumbers(): string[] {
  const extra = (process.env.FOUNDER_NUMBERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [env.founderCell, ...extra].filter(Boolean).map(last10).filter((n) => n.length === 10);
}

export function isFounderNumber(num: string | undefined | null): boolean {
  if (!num) return false;
  const n = last10(num);
  if (n.length !== 10) return false;
  return founderNumbers().includes(n);
}
