"use client";

import { useState, useRef, useMemo } from "react";
import { Horizon, StrKey, Asset } from "stellar-sdk";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  BarChart3,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import {
  useSettings,
  resolveHorizonUrl,
} from "@/lib/settings";
import type { Network } from "@/lib/settings";
import { getErrorMessage, formatBalance } from "@/lib/stellar-helpers";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrderbookEntry {
  price: string;
  amount: string;
  cumulative: number;
}

interface OrderbookData {
  bids: OrderbookEntry[];
  asks: OrderbookEntry[];
  baseAsset: string;
  counterAsset: string;
}

// ---------------------------------------------------------------------------
// Common pairs
// ---------------------------------------------------------------------------

const COMMON_PAIRS = [
  {
    label: "XLM / USDC",
    sell: { code: "XLM", issuer: "" },
    buy: {
      code: "USDC",
      issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X7CZBD35EX2XLRBER63UP2X",
    },
  },
  {
    label: "XLM / yXLM",
    sell: { code: "XLM", issuer: "" },
    buy: {
      code: "yXLM",
      issuer: "GARDNV3Q7YGT4MASTV2ZUCIJGHM2DRDQSC64UAWVCGT6CPMSC4DAAMX",
    },
  },
  {
    label: "USDC / XLM",
    sell: {
      code: "USDC",
      issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X7CZBD35EX2XLRBER63UP2X",
    },
    buy: { code: "XLM", issuer: "" },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ASSET_CODE_RE = /^[A-Z0-9]{1,12}$/;

function buildAsset(code: string, issuer: string): Asset {
  if (code.toUpperCase() === "XLM" && !issuer) return Asset.native();
  return new Asset(code, issuer);
}

function assetDisplayName(code: string): string {
  return code.toUpperCase() === "XLM" && code.length <= 3
    ? "XLM"
    : code;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function OrderbookPage() {
  const [sellCode, setSellCode] = useState("XLM");
  const [sellIssuer, setSellIssuer] = useState("");
  const [buyCode, setBuyCode] = useState("USDC");
  const [buyIssuer, setBuyIssuer] = useState(
    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X7CZBD35EX2XLRBER63UP2X",
  );
  const { settings } = useSettings();
  const network = settings.network;

  const [limit, setLimit] = useState<20 | 50 | 100>(20);
  const [data, setData] = useState<OrderbookData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  function validateAsset(
    code: string,
    issuer: string,
    label: string,
  ): string | null {
    if (!code.trim()) return `${label} asset code is required.`;
    if (!ASSET_CODE_RE.test(code.toUpperCase()) && code.toUpperCase() !== "XLM")
      return `${label} asset code must be 1–12 uppercase alphanumeric characters.`;
    if (code.toUpperCase() !== "XLM" || issuer.trim()) {
      if (code.toUpperCase() !== "XLM" && !issuer.trim())
        return `${label} issuer is required for non-native assets.`;
      if (issuer.trim() && !StrKey.isValidEd25519PublicKey(issuer.trim()))
        return `${label} issuer is not a valid Stellar public key.`;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  const handleFetch = async () => {
    const sellErr = validateAsset(sellCode, sellIssuer, "Sell");
    if (sellErr) {
      setError(sellErr);
      return;
    }
    const buyErr = validateAsset(buyCode, buyIssuer, "Buy");
    if (buyErr) {
      setError(buyErr);
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setIsLoading(true);
    setError(null);
    setData(null);

    try {
      const server = new Horizon.Server(resolveHorizonUrl(settings));

      const selling = buildAsset(sellCode, sellIssuer.trim());
      const buying = buildAsset(buyCode, buyIssuer.trim());

      const ob = await server.orderbook(selling, buying).limit(limit).call();
      if (abortRef.current?.signal.aborted) return;

      let cumBid = 0;
      const bids: OrderbookEntry[] = ob.bids.map((b) => {
        cumBid += parseFloat(b.amount);
        return { price: b.price, amount: b.amount, cumulative: cumBid };
      });

      let cumAsk = 0;
      const asks: OrderbookEntry[] = ob.asks.map((a) => {
        cumAsk += parseFloat(a.amount);
        return { price: a.price, amount: a.amount, cumulative: cumAsk };
      });

      setData({
        bids,
        asks,
        baseAsset: assetDisplayName(sellCode),
        counterAsset: assetDisplayName(buyCode),
      });

      if (bids.length === 0 && asks.length === 0) {
        setError("No orders found for this pair.");
      }
    } catch (e) {
      if (abortRef.current?.signal.aborted) return;
      setError(getErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  };

  const applyPreset = (idx: number) => {
    const p = COMMON_PAIRS[idx];
    setSellCode(p.sell.code);
    setSellIssuer(p.sell.issuer);
    setBuyCode(p.buy.code);
    setBuyIssuer(p.buy.issuer);
  };

  // ---------------------------------------------------------------------------
  // Derived stats
  // ---------------------------------------------------------------------------

  const stats = useMemo(() => {
    if (!data || (data.bids.length === 0 && data.asks.length === 0))
      return null;

    const bestBid = data.bids.length > 0 ? parseFloat(data.bids[0].price) : 0;
    const bestAsk = data.asks.length > 0 ? parseFloat(data.asks[0].price) : 0;
    const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
    const spreadPct =
      bestAsk > 0 && bestBid > 0
        ? ((spread / ((bestAsk + bestBid) / 2)) * 100).toFixed(3)
        : "—";

    const totalBidVol =
      data.bids.length > 0 ? data.bids[data.bids.length - 1].cumulative : 0;
    const totalAskVol =
      data.asks.length > 0 ? data.asks[data.asks.length - 1].cumulative : 0;

    return { bestBid, bestAsk, spread, spreadPct, totalBidVol, totalAskVol };
  }, [data]);

  const maxCumulativeBid = data?.bids.length
    ? data.bids[data.bids.length - 1].cumulative
    : 1;
  const maxCumulativeAsk = data?.asks.length
    ? data.asks[data.asks.length - 1].cumulative
    : 1;

  const depthChartData = useMemo(() => {
    if (!data) return [];
    const bidPoints = [...data.bids].reverse().map((b) => ({
      price: parseFloat(b.price),
      bidVolume: b.cumulative,
      askVolume: null as number | null,
    }));
    const askPoints = data.asks.map((a) => ({
      price: parseFloat(a.price),
      bidVolume: null as number | null,
      askVolume: a.cumulative,
    }));
    return [...bidPoints, ...askPoints];
  }, [data]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">DEX Orderbook</h1>
        <p className="text-muted-foreground mt-2">
          Live bid/ask tables, spread stats, and depth chart for any Stellar DEX pair. Choose from presets or enter any asset code and issuer.
        </p>
      </div>

      {/* Query form */}
      <Card>
        <CardHeader>
          <CardTitle>Trading Pair</CardTitle>
          <CardDescription>
            Select the selling and buying assets, or choose a common pair.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Presets */}
          <div className="flex flex-wrap gap-2">
            {COMMON_PAIRS.map((p, i) => (
              <Button
                key={p.label}
                variant="outline"
                size="sm"
                onClick={() => applyPreset(i)}
              >
                {p.label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Sell asset */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">Sell Asset (Base)</Label>
              <div className="space-y-2">
                <Input
                  placeholder="Asset code (e.g. XLM)"
                  value={sellCode}
                  onChange={(e) => setSellCode(e.target.value)}
                  className="font-mono"
                />
                <Input
                  placeholder="Issuer (leave empty for XLM)"
                  value={sellIssuer}
                  onChange={(e) => setSellIssuer(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            {/* Buy asset */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">
                Buy Asset (Counter)
              </Label>
              <div className="space-y-2">
                <Input
                  placeholder="Asset code (e.g. USDC)"
                  value={buyCode}
                  onChange={(e) => setBuyCode(e.target.value)}
                  className="font-mono"
                />
                <Input
                  placeholder="Issuer (leave empty for XLM)"
                  value={buyIssuer}
                  onChange={(e) => setBuyIssuer(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button onClick={handleFetch} disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <BarChart3 className="mr-2 h-4 w-4" />
              )}
              Fetch Orderbook
            </Button>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground whitespace-nowrap">
                Depth
              </Label>
              <Select
                value={String(limit)}
                onValueChange={(v) => setLimit(Number(v) as 20 | 50 | 100)}
              >
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6 flex items-start gap-3 text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <p className="text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Best Bid</p>
              <p className="text-lg font-bold font-mono text-green-600 dark:text-green-400">
                {stats.bestBid ? stats.bestBid.toFixed(7) : "—"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Best Ask</p>
              <p className="text-lg font-bold font-mono text-red-600 dark:text-red-400">
                {stats.bestAsk ? stats.bestAsk.toFixed(7) : "—"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Spread</p>
              <p className="text-lg font-bold font-mono">{stats.spreadPct}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">
                Total Volume (bid/ask)
              </p>
              <p className="text-sm font-bold font-mono">
                <span className="text-green-600 dark:text-green-400">
                  {formatBalance(stats.totalBidVol.toFixed(2), 2)}
                </span>
                {" / "}
                <span className="text-red-600 dark:text-red-400">
                  {formatBalance(stats.totalAskVol.toFixed(2), 2)}
                </span>
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Orderbook */}
      {data && (data.bids.length > 0 || data.asks.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Bids (buy orders) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                Bids ({data.bids.length})
              </CardTitle>
              <CardDescription className="text-xs">
                Buying {data.baseAsset} with {data.counterAsset}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                      Price
                    </th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">
                      Amount
                    </th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">
                      Cumulative
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.bids.map((b, i) => (
                    <tr
                      key={i}
                      className="relative border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2 relative z-10">
                        <div
                          className="absolute inset-0 bg-green-500/8"
                          style={{
                            width: `${(b.cumulative / maxCumulativeBid) * 100}%`,
                          }}
                        />
                        <span className="relative font-mono text-green-600 dark:text-green-400">
                          {parseFloat(b.price).toFixed(7)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono relative z-10">
                        {formatBalance(b.amount)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground relative z-10">
                        {formatBalance(b.cumulative.toFixed(2), 2)}
                      </td>
                    </tr>
                  ))}
                  {data.bids.length === 0 && (
                    <tr>
                      <td
                        colSpan={3}
                        className="text-center text-muted-foreground py-6"
                      >
                        No bids
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Asks (sell orders) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                Asks ({data.asks.length})
              </CardTitle>
              <CardDescription className="text-xs">
                Selling {data.baseAsset} for {data.counterAsset}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                      Price
                    </th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">
                      Amount
                    </th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">
                      Cumulative
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.asks.map((a, i) => (
                    <tr
                      key={i}
                      className="relative border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2 relative z-10">
                        <div
                          className="absolute inset-0 bg-red-500/8"
                          style={{
                            width: `${(a.cumulative / maxCumulativeAsk) * 100}%`,
                          }}
                        />
                        <span className="relative font-mono text-red-600 dark:text-red-400">
                          {parseFloat(a.price).toFixed(7)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono relative z-10">
                        {formatBalance(a.amount)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground relative z-10">
                        {formatBalance(a.cumulative.toFixed(2), 2)}
                      </td>
                    </tr>
                  ))}
                  {data.asks.length === 0 && (
                    <tr>
                      <td
                        colSpan={3}
                        className="text-center text-muted-foreground py-6"
                      >
                        No asks
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      {data && depthChartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Depth Chart</CardTitle>
            <CardDescription className="text-xs">
              Cumulative volume at each price level.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={depthChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="price"
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                  tickFormatter={(v: number) => v.toFixed(4)}
                />
                <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: "0.375rem",
                    fontSize: "12px",
                  }}
                />
                <Area
                  type="stepAfter"
                  dataKey="bidVolume"
                  fill="hsl(142.1 76.2% 36.3%)"
                  fillOpacity={0.2}
                  stroke="hsl(142.1 76.2% 36.3%)"
                  strokeWidth={2}
                  connectNulls={false}
                  name="Bid Volume"
                />
                <Area
                  type="stepAfter"
                  dataKey="askVolume"
                  fill="hsl(0 84.2% 60.2%)"
                  fillOpacity={0.2}
                  stroke="hsl(0 84.2% 60.2%)"
                  strokeWidth={2}
                  connectNulls={false}
                  name="Ask Volume"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
