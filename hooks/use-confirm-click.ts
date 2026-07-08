"use client";

import { useEffect, useRef, useState } from "react";

const CONFIRM_TIMEOUT_MS = 3000;

/** Click-to-confirm instead of window.confirm() — first click arms a 3s
 *  confirm window (button shows destructive styling), second click within
 *  that window fires the action. Times out back to the normal state if the
 *  second click never comes. */
export function useConfirmClick(onConfirm: () => void) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const onClick = () => {
    if (confirming) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setConfirming(false);
      onConfirm();
      return;
    }
    setConfirming(true);
    timerRef.current = setTimeout(() => setConfirming(false), CONFIRM_TIMEOUT_MS);
  };

  return { confirming, onClick };
}
