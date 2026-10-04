"use client";

import { useEffect } from "react";
import { captureFirstTouch } from "@/lib/attribution";

// 初回訪問の着地ページ・utm・参照元を記録する（画面には何も出さない）。詳細: lib/attribution.ts
export function AttributionCapture() {
  useEffect(() => {
    captureFirstTouch();
  }, []);
  return null;
}
