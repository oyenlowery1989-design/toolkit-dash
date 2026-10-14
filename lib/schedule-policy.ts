export function scheduleValidationError(value: unknown, allowed: readonly number[]): string | null {
  if (value === undefined || value === null) return null;
  if (process.env.VERCEL) return "Scheduled sends are unavailable on this deployment. Use Run Now instead.";
  if (typeof value !== "number" || !allowed.includes(value)) return "Unsupported schedule interval";
  return null;
}
