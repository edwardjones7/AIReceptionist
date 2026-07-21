// Client-safe helpers for components/. Do not move into lib/ — lib/* is
// server-only and must never be imported from client components.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
