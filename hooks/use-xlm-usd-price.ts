"use client";

import { useCallback, useEffect, useState } from "react";

const CACHE_TTL_MS = 60_000;

let _price: number | null = null;
let _fetchedAt = 0;
let _inflight: Promise<number | null> | null = null;
const _subscribers = new Set<() => void>();

async function fetchPrice(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data as { stellar?: { usd?: number } })?.stellar?.usd ?? null;
  } catch {
    return null;
  }
}

function load(): Promise<number | null> {
  const fresh = _price !== null && Date.now() - _fetchedAt < CACHE_TTL_MS;
  if (fresh) return Promise.resolve(_price);
  if (_inflight) return _inflight;
  _inflight = fetchPrice().then((price) => {
    _price = price;
    _fetchedAt = Date.now();
    _inflight = null;
    _subscribers.forEach((cb) => cb());
    return price;
  });
  return _inflight;
}

/** Live XLM/USD price via CoinGecko — cached + request-deduped across every mounted
 *  consumer (60s TTL). Call `ensure()` at the point you want the fetch triggered
 *  (e.g. after a scan completes); `price` re-renders reactively once loaded. */
export function useXlmUsdPrice() {
  const [price, setPrice] = useState<number | null>(_price);

  useEffect(() => {
    const onUpdate = () => setPrice(_price);
    _subscribers.add(onUpdate);
    return () => {
      _subscribers.delete(onUpdate);
    };
  }, []);

  const ensure = useCallback(() => {
    load();
  }, []);

  return { price, ensure };
}
