import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names and lets later utilities win over earlier ones (so `w-36` overrides a default `w-full`). */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
