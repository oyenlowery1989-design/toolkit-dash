const locks = new Map<string, Promise<unknown>>();

export function withAccountLock<T>(publicKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(publicKey) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(publicKey, next.catch(() => {}));
  return next;
}

export function isBadSeq(err: unknown): boolean {
  const codes = (err as any)?.response?.data?.extras?.result_codes;
  return codes?.transaction === "tx_bad_seq";
}
