const locks = new Map<string, Promise<unknown>>();

export function withAccountLock<T>(publicKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(publicKey) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  const tail = next.catch(() => {});
  locks.set(publicKey, tail);
  void tail.finally(() => { if (locks.get(publicKey) === tail) locks.delete(publicKey); });
  return next;
}

export function isBadSeq(err: unknown): boolean {
  const codes = (err as any)?.response?.data?.extras?.result_codes;
  return codes?.transaction === "tx_bad_seq";
}
