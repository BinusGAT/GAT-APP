"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { MagnifyingGlass, Star } from "@phosphor-icons/react";
import { getHomeSettings, getButtons, getUserFavorites, toggleUserFavorite } from "@/lib/actions";
import { Button } from "@/lib/db";
import { getIconComponent } from "./Sidebar";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[-\s]+/g, "-");
}

let cachedHomeType = "";
let cachedHomeValue = "";
let cachedHomeButtons: Button[] = [];
let isHomeDataLoaded = false;

interface HomeProps {
  buttons?: Button[];
  currentUser?: { email: string; name: string; activeRole: string } | null;
}

export default function Home({ buttons: propsButtons, currentUser }: HomeProps) {
  const router = useRouter();
  const [contentType, setContentType] = useState<"html" | "embed" | "">(
    cachedHomeType as "html" | "embed" | ""
  );
  const [contentValue, setContentValue] = useState(cachedHomeValue);
  const [buttons, setButtons] = useState<Button[]>(() => {
    if (propsButtons && propsButtons.length > 0) return propsButtons;
    return cachedHomeButtons;
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(() => {
    if (propsButtons && propsButtons.length > 0) return false;
    return !isHomeDataLoaded;
  });
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync favorites when currentUser changes
  useEffect(() => {
    async function loadFavs() {
      if (currentUser && currentUser.email) {
        const favs = await getUserFavorites(currentUser.email);
        setFavoriteIds(favs);
      } else {
        setFavoriteIds([]);
      }
    }
    loadFavs();
  }, [currentUser]);

  const handleToggleStar = async (e: React.MouseEvent, buttonId: number) => {
    e.stopPropagation();
    if (!currentUser || !currentUser.email) return;

    setFavoriteIds((prev) =>
      prev.includes(buttonId) ? prev.filter((id) => id !== buttonId) : [...prev, buttonId]
    );

    await toggleUserFavorite(currentUser.email, buttonId);
  };

  // Sync prop changes instantly
  useEffect(() => {
    if (propsButtons && propsButtons.length > 0) {
      setButtons(propsButtons);
      cachedHomeButtons = propsButtons;
      setLoading(false);
    }
  }, [propsButtons]);

  useEffect(() => {
    async function loadHomeData() {
      try {
        const [{ type, value }, btnData] = await Promise.all([
          getHomeSettings(),
          propsButtons && propsButtons.length > 0 ? Promise.resolve(propsButtons) : getButtons(),
        ]);
        cachedHomeType = type;
        cachedHomeValue = value;
        cachedHomeButtons = btnData || [];
        isHomeDataLoaded = true;

        setContentType((type as "html" | "embed") || "");
        setContentValue(value || "");
        setButtons(btnData || []);
      } catch (err) {
        console.error("Failed to load home page content settings:", err);
      } finally {
        setLoading(false);
      }
    }
    loadHomeData();
  }, [propsButtons]);

  useEffect(() => {
    if (!loading && contentType === "html" && containerRef.current) {
      const scripts = containerRef.current.getElementsByTagName("script");
      // Execute each script tag manually
      for (let i = 0; i < scripts.length; i++) {
        const oldScript = scripts[i];
        const newScript = document.createElement("script");

        // Copy attributes
        Array.from(oldScript.attributes).forEach((attr) => {
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
          Loading Portal...
        </p>
      </div>
    );
  }

  // ── Embed (iframe) mode ──
  if (contentType === "embed" && contentValue.trim()) {
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

  // ── Custom HTML mode ──
  if (contentType === "html" && contentValue.trim()) {
    return (
      <div
        ref={containerRef}
        className="dashboard"
        style={{ padding: "32px", overflowY: "auto", height: "100%" }}
        dangerouslySetInnerHTML={{ __html: contentValue }}
      />
    );
  }

  // ── Default Portal Apps Mode (Microsoft My Apps style) ──
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const STANDARD_CATS = ["apps", "tools", "resources"];

  // Extract all unique category strings from buttons
  const uniqueCategories = Array.from(
    new Set(buttons.map((b) => (b.category || "apps").trim()).filter(Boolean))
  );

  const customCategories = uniqueCategories.filter(
    (c) => !STANDARD_CATS.includes(c.toLowerCase())
  );

  const displayTabs = [
    { key: "all", label: "All Apps" },
    { key: "apps", label: "Apps" },
    { key: "tools", label: "Tools" },
    { key: "resources", label: "Resources" },
    ...customCategories.map((c) => ({ key: c.toLowerCase(), label: c })),
  ];

  const filteredButtons = buttons.filter((btn) => {
    const matchesSearch = btn.button_name.toLowerCase().includes(searchQuery.trim().toLowerCase());
    const btnCategory = (btn.category || "apps").trim().toLowerCase();
    const matchesCategory =
      selectedCategory === "all" || btnCategory === selectedCategory.toLowerCase();
    return matchesSearch && matchesCategory;
  });

  const getCategoryCount = (catKey: string) => {
    if (catKey === "all") return buttons.length;
    return buttons.filter(
      (b) => (b.category || "apps").trim().toLowerCase() === catKey.toLowerCase()
    ).length;
  };

  const handleAppClick = (btn: Button) => {
    if (btn.source_type === "link") {
      window.open(btn.source, "_blank", "noopener,noreferrer");
    } else {
      router.push("/" + slugify(btn.button_name));
    }
  };

  const favoriteButtons = buttons.filter((btn) => favoriteIds.includes(btn.id));

  return (
    <div className="portal-container">
      {/* ── Top Bar Header (Search centered) ── */}
      <div className="portal-top-bar">
        <div className="portal-search-wrapper" style={{ margin: "0 auto" }}>
          <MagnifyingGlass size={16} className="portal-search-icon" weight="bold" />
          <input
            type="text"
            className="portal-search-input"
            placeholder="Search apps..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* ── Centered Category Tabs Bar (Microsoft My Apps Style) ── */}
      <div className="portal-category-bar">
        <div className="portal-tabs-bar">
          {displayTabs.map((tab) => {
            const count = getCategoryCount(tab.key);
            if (count === 0 && tab.key !== "all") return null;
            return (
              <button
                key={tab.key}
                type="button"
                className={`portal-tab ${selectedCategory === tab.key ? "active" : ""}`}
                onClick={() => setSelectedCategory(tab.key)}
              >
                {tab.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Portal App Cards Grid ── */}
      <div className="portal-content-area">
        {/* Top Pinned / Favorites Section */}
        {favoriteButtons.length > 0 && !searchQuery.trim() && selectedCategory === "all" && (
          <div style={{ marginBottom: 32 }}>
            <div className="portal-section-title">
              <Star size={18} weight="fill" color="#EAB308" />
              <span>Favorites</span>
            </div>
            <div className="portal-app-grid">
              {favoriteButtons.map((btn) => (
                <div
                  key={`fav-${btn.id}`}
                  className="portal-app-card group"
                  onClick={() => handleAppClick(btn)}
                  role="button"
                  tabIndex={0}
                >
                  {currentUser && (
                    <button
                      type="button"
                      className="portal-app-star-btn starred"
                      onClick={(e) => handleToggleStar(e, btn.id)}
                      title="Unpin from Favorites"
                    >
                      <Star size={16} weight="fill" color="#EAB308" />
                    </button>
                  )}
                  <div className="portal-app-tile">
                    {btn.image_url ? (
                      <img
                        src={btn.image_url}
                        alt={btn.button_name}
                        className="portal-app-img"
                      />
                    ) : (
                      getIconComponent(btn.icon, 44)
                    )}
                  </div>
                  <span className="portal-app-title" title={btn.button_name}>
                    {btn.button_name}
                  </span>
                  <span className="portal-app-category-pill">
                    {btn.category ? (btn.category.charAt(0).toUpperCase() + btn.category.slice(1)) : "Apps"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {filteredButtons.length > 0 ? (
          <div>
            {favoriteButtons.length > 0 && !searchQuery.trim() && selectedCategory === "all" && (
              <div className="portal-section-title">
                <span>All Portal Apps</span>
              </div>
            )}
            <div className="portal-app-grid">
              {filteredButtons.map((btn) => {
                const isFav = favoriteIds.includes(btn.id);
                return (
                  <div
                    key={btn.id}
                    className="portal-app-card group"
                    onClick={() => handleAppClick(btn)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") handleAppClick(btn);
                    }}
                  >
                    {currentUser && (
                      <button
                        type="button"
                        className={`portal-app-star-btn ${isFav ? "starred" : ""}`}
                        onClick={(e) => handleToggleStar(e, btn.id)}
                        title={isFav ? "Unpin from Favorites" : "Pin to Favorites"}
                      >
                        <Star size={16} weight={isFav ? "fill" : "bold"} color={isFav ? "#EAB308" : "#94A3B8"} />
                      </button>
                    )}
                    <div className="portal-app-tile">
                      {btn.image_url ? (
                        <img
                          src={btn.image_url}
                          alt={btn.button_name}
                          className="portal-app-img"
                        />
                      ) : (
                        getIconComponent(btn.icon, 44)
                      )}
                    </div>
                    <span className="portal-app-title" title={btn.button_name}>
                      {btn.button_name}
                    </span>
                    <span className="portal-app-category-pill">
                      {btn.category ? (btn.category.charAt(0).toUpperCase() + btn.category.slice(1)) : "Apps"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="portal-empty-state">
            <p>No apps found matching your criteria.</p>
          </div>
        )}
      </div>
    </div>
  );
}

