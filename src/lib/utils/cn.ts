import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind class names, resolving conflicts (later wins).
 * Combines clsx (conditional classes) with tailwind-merge (dedupe/override).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
