/**
 * Prefixes a bare domain/URL with https:// if it has no scheme. Rejects any
 * scheme other than http/https (e.g. javascript:) — those are treated as a
 * bare host and get the https:// prefix forced on instead of being honored.
 */
export function normalizeExternalUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const bareHost = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/*/i, "");
  return `https://${bareHost}`;
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
