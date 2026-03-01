import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formatiert Sekunden in MM:SS Format
 * @param seconds - Anzahl der Sekunden
 * @returns Formatierte Zeit als String (z.B. "5:03")
 */
export function formatElapsedTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
