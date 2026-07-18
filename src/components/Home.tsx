"use client";

import React, { useState, useEffect } from "react";
import { getSetting, getButtons } from "@/lib/actions";

export default function Home() {
  const [contentType, setContentType] = useState<"html" | "embed" | "">("");
  const [contentValue, setContentValue] = useState("");
  const [loading, setLoading] = useState(true);
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadHomeContent() {
      try {
        const [type, value, buttonData] = await Promise.all([
          getSetting("home_content_type"),
          getSetting("home_content_value"),
          getButtons(),
        ]);
        setContentType((type as "html" | "embed") || "");
        setContentValue(value || "");
        if (typeof window !== "undefined") {
          (window as any).__GAT_BUTTONS__ = buttonData;
        }
      } catch (err) {
        console.error("Failed to load home page content settings:", err);
      } finally {
        setLoading(false);
      }
    }
    loadHomeContent();
  }, []);

  useEffect(() => {
    if (!loading && contentType === "html" && containerRef.current) {
      const scripts = containerRef.current.getElementsByTagName("script");
      // Execute each script tag manually
      for (let i = 0; i < scripts.length; i++) {
        const oldScript = scripts[i];
        const newScript = document.createElement("script");
        
        // Copy attributes
        Array.from(oldScript.attributes).forEach(attr => {
          newScript.setAttribute(attr.name, attr.value);
        });
        
        // Copy content
        newScript.textContent = oldScript.textContent;
        
        // Re-inject script to execute it
        oldScript.parentNode?.replaceChild(newScript, oldScript);
      }
    }
  }, [contentValue, loading, contentType]);

  if (loading) {
    return (
      <div className="iframe-loading" style={{ height: "100%" }}>
        <div className="spinner" />
        <p className="sidebar-title" style={{ marginTop: 12 }}>
          Loading...
        </p>
      </div>
    );
  }

  // Blank state (totally blank, or minimal parent container)
  if (!contentType || !contentValue.trim()) {
    return (
      <div className="hub-home-blank" style={{ height: "100%", width: "100%" }}>
        {/* Intentionally left blank. Admin can input custom HTML or an Embed URL. */}
      </div>
    );
  }

  // Embed (iframe) mode
  if (contentType === "embed") {
    return (
      <div className="iframe-container" style={{ height: "100%", width: "100%" }}>
        <iframe
          className="app-iframe"
          src={contentValue}
          title="Home Page Embed"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          style={{ width: "100%", height: "100%", border: "none" }}
        />
      </div>
    );
  }

  // Custom HTML mode
  return (
    <div
      ref={containerRef}
      className="dashboard"
      style={{ padding: "32px", overflowY: "auto", height: "100%" }}
      dangerouslySetInnerHTML={{ __html: contentValue }}
    />
  );
}
