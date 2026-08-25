type SearchNavigationEntry = { type: string; value: string; network?: string };

function withNetwork(path: string, network?: string): string {
  if (!network) return path;
  return `${path}${path.includes("?") ? "&" : "?"}network=${encodeURIComponent(network)}`;
}

export function savedSearchHref(entry: SearchNavigationEntry): string | null {
  const value = encodeURIComponent(entry.value);
  switch (entry.type) {
    case "address":
      return withNetwork(`/address-investigator?address=${value}`, entry.network);
    case "asset": {
      const [code = "", issuer = ""] = entry.value.split(":");
      return withNetwork(`/asset-lookup?code=${encodeURIComponent(code)}&issuer=${encodeURIComponent(issuer)}`, entry.network);
    }
    case "intermediary-trace":
      return withNetwork(`/intermediary-tracer?address=${value}&tab=trace`, entry.network);
    case "intermediary-scan":
      return withNetwork(`/intermediary-tracer?address=${value}&tab=scan`, entry.network);
    case "address-balances":
      return withNetwork(`/address-balances?addresses=${value}`, entry.network);
    case "asset-sales-bulk":
      return withNetwork(`/asset-sales?bulkAssets=${value}`, entry.network);
    default:
      return null;
  }
}
