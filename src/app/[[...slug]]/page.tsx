"use client";

import React, { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Home from "@/components/Home";
import MainContent from "@/components/MainContent";
import { Button } from "@/lib/db";
import { getButtons } from "@/lib/actions";
import * as Icons from "@phosphor-icons/react";

// Helper to generate URL-friendly slug
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[-\s]+/g, "-");
}

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export default function GatAppPage({ params }: PageProps) {
  const { slug } = use(params);
  const router = useRouter();

  const [buttons, setButtons] = useState<Button[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchButtons = useCallback(async () => {
    try {
      const data = await getButtons();
      setButtons(data);
    } catch (err) {
      console.error("Failed to load buttons:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchButtons();
  }, [fetchButtons]);

  // Determine active view based on slug parameter in URL path
  const currentSlug = slug && slug.length > 0 ? slug[0] : "";

  // Redirect root / to /home
  useEffect(() => {
    if (!currentSlug && !loading) {
      router.replace("/home");
    }
  }, [currentSlug, loading, router]);

  let activeView:
    | { kind: "home" }
    | { kind: "admin" }
    | { kind: "content"; button: Button } = { kind: "home" };

  if (currentSlug === "settings") {
    activeView = { kind: "admin" };
  } else if (currentSlug === "home" || !currentSlug) {
    activeView = { kind: "home" };
  } else if (currentSlug) {
    const matchingButton = buttons.find(
      (btn) => slugify(btn.button_name) === currentSlug
    );
    if (matchingButton) {
      activeView = { kind: "content", button: matchingButton };
    }
  }

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const handleButtonClick = (button: Button) => {
    if (button.source_type === "link") {
      window.open(button.source, "_blank", "noopener,noreferrer");
      return;
    }
    router.push("/" + slugify(button.button_name));
    setIsSidebarOpen(false);
  };

  const handleOpenAdmin = () => {
    router.push("/settings");
    setIsSidebarOpen(false);
  };

  const handleGoHome = () => {
    router.push("/home");
  };

  // Dynamic header title
  let headerTitle = "HOME";
  if (activeView.kind === "admin") headerTitle = "SYSTEM SETTINGS";
  else if (activeView.kind === "content")
    headerTitle = activeView.button.button_name.toUpperCase();



  const activeButtonId = activeView.kind === "content" ? activeView.button.id : null;

  return (
    <div className="app-container">
      {/* ── Header ── */}
      <header className="app-header">
        <button
          className="header-candybox-btn"
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          title="Toggle Menu"
        >
          <Icons.DotsNine size={22} weight="bold" />
        </button>

        <div
          className="logo-container"
          style={{ cursor: "pointer" }}
          onClick={handleGoHome}
          title="Go to Home"
        >
          <span className="logo-gat">GAT</span>
          <span className="logo-app">APP</span>
        </div>

        <div className="header-divider" />
        <span className="header-title">{headerTitle}</span>

        {/* Back button when viewing content */}
        {activeView.kind === "content" && (
          <button
            className="btn-secondary"
            onClick={handleGoHome}
            style={{ marginLeft: "auto", padding: "6px 14px", fontSize: 13 }}
          >
            <Icons.ArrowLeft size={14} weight="bold" />
            &nbsp;Back
          </button>
        )}
      </header>

      {/* ── Main Viewport ── */}
      <div className="main-viewport">
        {/* Backdrop overlay */}
        <div
          className={`sidebar-overlay ${isSidebarOpen ? "open" : ""}`}
          onClick={() => setIsSidebarOpen(false)}
        />

        {/* Sidebar */}
        <Sidebar
          buttons={buttons}
          activeButtonId={activeButtonId}
          isAdminActive={activeView.kind === "admin"}
          isHomeActive={activeView.kind === "home"}
          onButtonClick={handleButtonClick}
          onGoHome={handleGoHome}
          onOpenAdmin={handleOpenAdmin}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />

        {/* Main Content Area */}
        <main className="main-content">
          {loading ? (
            <div className="iframe-loading" style={{ height: "100%" }}>
              <div className="spinner" />
              <p className="sidebar-title" style={{ marginTop: 12 }}>
                Loading...
              </p>
            </div>
          ) : (
            <>
              {activeView.kind === "home" && <Home />}

              {activeView.kind === "content" && (
                <MainContent button={activeView.button} onGoHome={handleGoHome} />
              )}

              {activeView.kind === "admin" && (
                <MainContent
                  button={null}
                  onGoHome={handleGoHome}
                  isAdminMode
                  buttons={buttons}
                  onRefresh={fetchButtons}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
