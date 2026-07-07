"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";

interface AuthFlagProps {
  active: boolean;
  label: string;
  activeDesc: string;
  inactiveDesc: string;
}

/**
 * Displays a single Stellar account auth flag with icon and tooltip.
 */
export function AuthFlag({ active, label, activeDesc, inactiveDesc }: AuthFlagProps) {
  return (
    <div
      className="flex items-center gap-1.5 text-xs"
      title={active ? activeDesc : inactiveDesc}
    >
      {active ? (
        <ShieldAlert className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
      ) : (
        <ShieldCheck className="h-3.5 w-3.5 text-green-500/70 shrink-0" />
      )}
      <span className={active ? "text-yellow-500" : "text-muted-foreground"}>
        {label}
      </span>
    </div>
  );
}
