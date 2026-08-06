"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowClockwise,
  ArrowLeft,
  House,
  LockKey,
  MapTrifold,
  Plugs,
} from "@phosphor-icons/react";

type AppStateVariant = "not-found" | "denied" | "unavailable";

const stateContent = {
  "not-found": {
    code: "404",
    eyebrow: "Route not found",
    title: "This page is off the map.",
    description: "The address may have changed, or the application is no longer listed in GAT App.",
    Icon: MapTrifold,
  },
  denied: {
    code: "403",
    eyebrow: "Access restricted",
    title: "This area needs another role.",
    description: "Your current role does not include access to this page. Switch roles or return to the applications you can use.",
    Icon: LockKey,
  },
  unavailable: {
    code: "503",
    eyebrow: "Temporarily unavailable",
    title: "We couldn’t open this page.",
    description: "The service may be restarting or briefly offline. Try again, or return home and use another application.",
    Icon: Plugs,
  },
} as const;

interface AppStateProps {
  variant: AppStateVariant;
  onRetry?: () => void;
  showBack?: boolean;
}

export default function AppState({ variant, onRetry, showBack = true }: AppStateProps) {
  const router = useRouter();
  const content = stateContent[variant];
  const Icon = content.Icon;

  return (
    <main className="app-state" id="main-content">
      <section className="app-state-card" aria-labelledby="app-state-title">
        <div className="app-state-brand" aria-label="GAT App">
          <span>GAT</span><strong>APP</strong>
        </div>

        <div className="app-state-layout">
          <div className="app-state-visual" aria-hidden="true">
            <span className="app-state-code">{content.code}</span>
            <div className="app-state-icon"><Icon size={40} weight="duotone" /></div>
          </div>

          <div className="app-state-copy">
            <span className="app-state-eyebrow">{content.eyebrow}</span>
            <h1 id="app-state-title">{content.title}</h1>
            <p>{content.description}</p>

            <div className="app-state-actions">
              <Link className="btn-primary app-state-button" href="/home">
                <House size={17} weight="bold" /> Go to home
              </Link>
              {variant === "unavailable" && onRetry ? (
                <button className="btn-secondary app-state-button" type="button" onClick={onRetry}>
                  <ArrowClockwise size={17} weight="bold" /> Try again
                </button>
              ) : showBack ? (
                <button className="btn-secondary app-state-button" type="button" onClick={() => router.back()}>
                  <ArrowLeft size={17} weight="bold" /> Go back
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <p className="app-state-help">Need help? Contact the GAT support team and include the address you tried to open.</p>
      </section>
    </main>
  );
}
