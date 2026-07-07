"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LogPanelProps {
  logs: string[];
  running?: boolean;
}

export function LogPanel({ logs, running = false }: LogPanelProps) {
  const [open, setOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    userScrolledUp.current = el.scrollTop + el.clientHeight < el.scrollHeight - 20;
  };

  useEffect(() => {
    if (open && !userScrolledUp.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, open]);

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full h-auto justify-start rounded-none flex items-center gap-2 px-3 py-2 bg-muted/40 hover:bg-muted/60 transition-colors text-xs font-medium text-muted-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <Terminal className="h-3.5 w-3.5" />
        Activity Log ({logs.length} lines)
        {running && <span className="text-primary animate-pulse ml-1">●</span>}
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 ml-auto" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 ml-auto" />
        )}
      </Button>
      {open && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="max-h-52 overflow-y-auto bg-black/60 px-3 py-2 space-y-0.5 font-mono text-xs"
        >
          {logs.length === 0 ? (
            <span className="text-muted-foreground">No activity yet.</span>
          ) : (
            logs.map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith("    →") || line.startsWith("  →")
                    ? "text-green-400"
                    : line.startsWith("Phase")
                    ? "text-yellow-400 font-semibold"
                    : line.startsWith("Done")
                    ? "text-green-400 font-semibold"
                    : line.startsWith("Stopped")
                    ? "text-orange-400"
                    : line.startsWith("ERROR")
                    ? "text-red-400"
                    : "text-slate-300"
                }
              >
                {line}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
