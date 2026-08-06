import type { Metadata } from "next";
import AppState from "@/components/AppState";

export const metadata: Metadata = {
  title: "Page not found | GAT App",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return <AppState variant="not-found" />;
}
