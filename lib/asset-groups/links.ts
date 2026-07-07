/** Prefixes a bare domain/URL with https:// if it has no scheme. */
export function normalizeExternalUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Resolves the URL to link to for a group's Telegram presence.
 * An explicit link always wins; otherwise derives a t.me URL from the
 * channel name. Returns undefined if neither field is set.
 */
export function resolveTelegramUrl(channel?: string, link?: string): string | undefined {
  const linkTrimmed = link?.trim();
  if (linkTrimmed) return normalizeExternalUrl(linkTrimmed);

  const channelTrimmed = channel?.trim();
  if (!channelTrimmed) return undefined;
  return `https://t.me/${channelTrimmed.replace(/^[@/]+/, "")}`;
}
