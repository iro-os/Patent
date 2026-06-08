import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// shadcn/ui's class-merge helper: clsx resolves conditionals, tailwind-merge
// dedupes conflicting Tailwind classes (e.g. last `px-*` wins).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
