export function parseGhostSenders(
  text: string,
  wallets: { publicKey: string; hasKey?: boolean; secretKey: string }[],
): string[] {
  return text.split(/[\n,]+/).map((value) => value.trim()).filter((value) =>
    (value.startsWith("S") && value.length === 56) ||
    wallets.some((wallet) => wallet.publicKey === value && (wallet.hasKey || wallet.secretKey)),
  );
}
