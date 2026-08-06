"use client";

import { useEffect } from "react";
import AppState from "@/components/AppState";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("GAT App page error", error);
  }, [error]);

  return <AppState variant="unavailable" onRetry={reset} />;
}
