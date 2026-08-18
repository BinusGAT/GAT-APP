"use client";

import React, { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import {
  Plus,
  CaretUp,
  CaretDown,
  PencilSimple,
  Trash,
  AppWindow,
  House,
  Code,
  FrameCorners,
  Shield,
  User,
  MagnifyingGlass,
  GraduationCap,
  ChalkboardTeacher,
  Lightning,
  ClipboardText,
  Pulse,
  Megaphone,
  ChartBar,
} from "@phosphor-icons/react";
import { Button, Role, UserWithRole } from "@/lib/db";
import {
  verifyPasscode,
  exitSuperadmin,
  isSuperadminSessionValid,
  updateSuperadminPasscode,
  getButtons,
  addButton,
  updateButton,
  deleteButton,
  reorderButtons,
  getSetting,
  updateSetting,
  getUsers,
  getRoles,
  createUser,
  updateUser,
  deleteUser,
} from "@/lib/actions";
import { getIconComponent } from "./Sidebar";
import { parseAllowedRoles, ROLE_OPTIONS, serializeAllowedRoles } from "@/lib/permissions";
import SettingsOperations, { OperationsView } from "./SettingsOperations";

// ── Icon list for the picker ──────────────────────────────────
const AVAILABLE_ICONS = [
  "House","GraduationCap","FileText","Translate","Books","Trophy",
  "Lifebuoy","Rocket","Compass","ShareNetwork","Scroll","User",
  "Envelope","Calendar","Shield","Clock","Notebook","Chat",
  "Bookmark","AppWindow","Globe","Database","Code","Browsers",
  "PresentationChart","ChartBar","Lightning","Leaf","Star","Heart",
];

// Keep the passcode-management implementation available for future use while
// hiding it from the Superadmin interface for now.
const SHOW_PASSCODE_MANAGEMENT = false;

// ── Source type badge colors ──────────────────────────────────
const SOURCE_COLORS: Record<string, { color: string; bg: string }> = {
  link:  { color: "#3b82f6", bg: "#eff6ff" },
  embed: { color: "#10b981", bg: "#f0fdf4" },
  code:  { color: "#8b5cf6", bg: "#f5f3ff" },
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

// ─────────────────────────────────────────────────────────────
// Content Renderer — embed or code
// ─────────────────────────────────────────────────────────────
function ContentRenderer({
  button,
}: {
  button: Button;
  onGoHome: () => void;
}) {
  const [loading, setLoading] = useState(true);

  if (button.source_type === "embed") {
    return (
      <div className="iframe-container">
        {loading && (
          <div className="iframe-loading">
            <div className="spinner" />
            <p className="sidebar-title" style={{ marginTop: 12 }}>
              Loading...
            </p>
          </div>
        )}
        <iframe
          className="app-iframe"
          src={button.source}
          title={button.button_name}
          onLoad={() => setLoading(false)}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
        />
      </div>
    );
  }

  // Code — sandboxed iframe with srcdoc so JS runs safely
  return (
    <div className="iframe-container">
      <iframe
        className="app-iframe"
        srcDoc={button.source}
        title={button.button_name}
        sandbox="allow-scripts allow-same-origin allow-forms"
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Admin Panel
// ─────────────────────────────────────────────────────────────
function AdminPanel({
  initialButtons,
  onRefresh,
}: {
  initialButtons: Button[];
  onRefresh: () => void;
}) {
  // Button list state
  const [allButtons, setAllButtons] = useState<Button[]>(initialButtons);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBtn, setEditingBtn] = useState<Partial<Button> | null>(null);

  // Form fields
  const [fName, setFName] = useState("");
  const [fType, setFType] = useState<"link" | "embed" | "code">("link");
  const [fSource, setFSource] = useState("");
  const [fIcon, setFIcon] = useState("Cube");
  const [fImageUrl, setFImageUrl] = useState("");
  const [fCategory, setFCategory] = useState<string>("apps");
  const [fCustomCategory, setFCustomCategory] = useState<string>("");
  const [fAllowedRoles, setFAllowedRoles] = useState<string[]>(["all"]);

  // Tab switcher state
  const [activeTab, setActiveTab] = useState<"apps" | "home" | "users" | "superadmin" | OperationsView>("apps");

  // Superadmin unlock state for sensitive tabs
  const [isSuperadminUnlocked, setIsSuperadminUnlocked] = useState(false);
  const [isSuperadminStatusLoaded, setIsSuperadminStatusLoaded] = useState(false);
  const [superPasscode, setSuperPasscode] = useState("");
  const [superAuthError, setSuperAuthError] = useState("");

  useEffect(() => {
    isSuperadminSessionValid()
      .then(setIsSuperadminUnlocked)
      .catch(() => setIsSuperadminUnlocked(false))
      .finally(() => setIsSuperadminStatusLoaded(true));
  }, []);

  const handleSuperadminUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuperAuthError("");
    const res = await verifyPasscode(superPasscode);
    if (res.success) {
      setIsSuperadminUnlocked(true);
      setActiveTab("users");
    } else {
      setSuperAuthError(res.error || "Invalid Superadmin Passcode.");
    }
  };

  const handleSuperadminExit = async () => {
    setSuperAuthError("");
    const res = await exitSuperadmin();
    if (res.success) {
      setIsSuperadminUnlocked(false);
      setSuperPasscode("");
      setActiveTab("apps");
    } else {
      setSuperAuthError(res.error || "Unable to exit Superadmin mode.");
    }
  };

  // Home page content state
  const [homeContentType, setHomeContentType] = useState<"html" | "embed">("html");
  const [homeContentValue, setHomeContentValue] = useState("");
  const [homeSaving, setHomeSaving] = useState(false);
  const [homeSaveMsg, setHomeSaveMsg] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function loadData() {
      const fresh = await getButtons();
      setAllButtons(fresh);
      onRefresh();
      // Load home page settings
      const [type, value] = await Promise.all([
        getSetting("home_content_type"),
        getSetting("home_content_value"),
      ]);
      setHomeContentType((type as "html" | "embed") || "html");
      setHomeContentValue(value || "");
    }
    void loadData();
  }, [onRefresh]);

  const handleSaveHomeContent = async () => {
    setIsSaving(true);
    setHomeSaving(true);
    setHomeSaveMsg("");
    try {
      const [r1, r2] = await Promise.all([
        updateSetting("", "home_content_type", homeContentType),
        updateSetting("", "home_content_value", homeContentValue),
      ]);
      if (r1.success && r2.success) {
        setHomeSaveMsg("Saved!");
        setTimeout(() => setHomeSaveMsg(""), 2500);
      } else {
        setHomeSaveMsg(r1.error || r2.error || "Failed to save.");
      }
    } catch (err: unknown) {
      setHomeSaveMsg(errorMessage(err, "Failed to save."));
    } finally {
      setHomeSaving(false);
      setIsSaving(false);
    }
  };

  // Reload from server
  const reload = async () => {
    const fresh = await getButtons();
    setAllButtons(fresh);
    onRefresh();
  };


  const existingCustomCats = Array.from(
    new Set(
      allButtons
        .map((b) => (b.category || "apps").trim())
        .filter((c) => !["apps", "tools", "resources"].includes(c.toLowerCase()))
    )
  );

  // Open modal
  const openModal = (btn: Button | null) => {
    if (btn) {
      setEditingBtn(btn);
      setFName(btn.button_name);
      setFType(btn.source_type);
      setFSource(btn.source);
      setFIcon(btn.icon);
      setFImageUrl(btn.image_url || "");
      const cat = (btn.category || "apps").trim();
      if (["apps", "tools", "resources"].includes(cat.toLowerCase())) {
        setFCategory(cat.toLowerCase());
        setFCustomCategory("");
      } else {
        setFCategory(cat);
        setFCustomCategory(cat);
      }
      const rawRoles = parseAllowedRoles(btn.allowed_roles);
      setFAllowedRoles(rawRoles.length > 0 ? rawRoles : ["all"]);
    } else {
      setEditingBtn(null);
      setFName("");
      setFType("link");
      setFSource("");
      setFIcon("Cube");
      setFImageUrl("");
      setFCategory("apps");
      setFCustomCategory("");
      setFAllowedRoles(["all"]);
    }
    setIsModalOpen(true);
  };

  // Save (add or update)
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fName.trim() || !fSource.trim()) return;

    setIsSaving(true);
    const finalCategory = fCategory === "custom"
      ? (fCustomCategory.trim() || "custom")
      : fCategory;
    const finalRoles = serializeAllowedRoles(fAllowedRoles);

    const data = {
      button_name: fName.trim(),
      source_type: fType,
      source: fSource.trim(),
      icon: fIcon,
      image_url: fImageUrl.trim() || undefined,
      category: finalCategory,
      allowed_roles: finalRoles,
    };

    try {
      const res = editingBtn && editingBtn.id
        ? await updateButton("", editingBtn.id, data)
        : await addButton("", data);

      if (res.success) {
        setIsModalOpen(false);
        await reload();
      } else {
        alert(res.error || "Failed to save button.");
      }
    } catch (err: unknown) {
      alert(errorMessage(err, "Failed to save button."));
    } finally {
      setIsSaving(false);
    }
  };

  // Delete
  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return;

    setIsSaving(true);
    try {
      const res = await deleteButton("", id);
      if (res.success) {
        await reload();
      } else {
        alert(res.error || "Failed to delete button.");
      }
    } catch (err: unknown) {
      alert(errorMessage(err, "Failed to delete button."));
    } finally {
      setIsSaving(false);
    }
  };

  // Reorder (drag fallback: up / down buttons)
  const handleMove = async (index: number, dir: "up" | "down") => {
    const arr = [...allButtons];
    const swapIdx = dir === "up" ? index - 1 : index + 1;
    if (swapIdx < 0 || swapIdx >= arr.length) return;
    [arr[index], arr[swapIdx]] = [arr[swapIdx], arr[index]];
    setAllButtons(arr);
    setIsSaving(true);
    try {
      await reorderButtons(
        "",
        arr.map((b) => b.id)
      );
      onRefresh();
    } catch (err: unknown) {
      console.error(errorMessage(err, "Failed to reorder buttons."));
    } finally {
      setIsSaving(false);
    }
  };

  // ── Admin panel ────────────────────────────────────────────
  return (
    <div className="settings-wrapper">
      <div className="config-container">
        {/* Header */}
        <div className="config-header">
          <div>
            <h1 className="config-title">GAT App Admin</h1>
            <p className="config-subtitle">
              Configure GAT App application buttons, home page content, and user access.
            </p>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            {activeTab === "apps" && (
              <button className="btn-primary" onClick={() => openModal(null)}>
                <Plus size={14} weight="bold" />
                &nbsp;Add Button
              </button>
            )}
          </div>
        </div>

        {/* Tab Switcher */}
        <nav className="settings-tabs settings-tabs-primary" aria-label="Settings sections">
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === "apps" ? "active" : ""}`}
            onClick={() => setActiveTab("apps")}
          >
            <AppWindow size={16} weight="bold" />
            Apps
          </button>
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === "home" ? "active" : ""}`}
            onClick={() => setActiveTab("home")}
          >
            <House size={16} weight="bold" />
            Home
          </button>
          <button type="button" className={`settings-tab-btn ${(["audit", "health", "announcements", "analytics"] as string[]).includes(activeTab) ? "active" : ""}`} onClick={() => setActiveTab("health")}>
            <Pulse size={16} weight="bold" />Operations
          </button>
          <button type="button" className={`settings-tab-btn ${activeTab === "superadmin" || activeTab === "users" ? "active" : ""}`} onClick={() => setActiveTab(isSuperadminUnlocked ? "users" : "superadmin")}>
            <Shield size={16} weight="bold" />Security
          </button>
        </nav>

        {(["audit", "health", "announcements", "analytics"] as string[]).includes(activeTab) && (
          <nav className="settings-tabs settings-subnav" aria-label="Operations tools">
            <button type="button" className={`settings-tab-btn ${activeTab === "health" ? "active" : ""}`} onClick={() => setActiveTab("health")}><Pulse size={15}/>Health</button>
            <button type="button" className={`settings-tab-btn ${activeTab === "announcements" ? "active" : ""}`} onClick={() => setActiveTab("announcements")}><Megaphone size={15}/>Announcements</button>
            <button type="button" className={`settings-tab-btn ${activeTab === "analytics" ? "active" : ""}`} onClick={() => setActiveTab("analytics")}><ChartBar size={15}/>Analytics</button>
            <button type="button" className={`settings-tab-btn ${activeTab === "audit" ? "active" : ""}`} onClick={() => setActiveTab("audit")}><ClipboardText size={15}/>Audit</button>
          </nav>
        )}

        {activeTab === "users" && isSuperadminUnlocked && (
          <div className="security-toolbar">
            <span><User size={15}/>Superadmin access is active</span>
            <button type="button" className="btn-secondary" onClick={handleSuperadminExit}>Exit Superadmin</button>
          </div>
        )}

        {(["audit", "health", "announcements", "analytics"] as string[]).includes(activeTab) && (
          <SettingsOperations view={activeTab as OperationsView} />
        )}

        {activeTab === "apps" && (
          /* Button list */
          <div className="config-list">
            {allButtons.map((btn, idx) => {
              const sc = SOURCE_COLORS[btn.source_type];
              return (
                <div key={btn.id} className="config-item">
                  {/* Reorder */}
                  <div className="config-item-drag">
                    <button
                      className="reorder-btn"
                      disabled={idx === 0}
                      onClick={() => handleMove(idx, "up")}
                      title="Move Up"
                    >
                      <CaretUp size={14} weight="bold" />
                    </button>
                    <button
                      className="reorder-btn"
                      disabled={idx === allButtons.length - 1}
                      onClick={() => handleMove(idx, "down")}
                      title="Move Down"
                    >
                      <CaretDown size={14} weight="bold" />
                    </button>
                  </div>

                  {/* Icon / Image */}
                  <div className="config-item-icon" style={{ background: "transparent", color: "var(--text-secondary)", width: "auto", height: "auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {btn.image_url ? (
                      <Image
                        src={btn.image_url}
                        alt={btn.button_name}
                        width={24}
                        height={24}
                        unoptimized
                        style={{ width: 24, height: 24, objectFit: "contain", borderRadius: 4 }}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      getIconComponent(btn.icon, 20)
                    )}
                  </div>

                  {/* Details */}
                  <div className="config-item-details">
                    <div className="config-item-name">
                      {btn.button_name}
                      <span
                        className="badge-source-type"
                        style={{ color: sc.color, background: sc.bg }}
                      >
                        {btn.source_type}
                      </span>
                      <span
                        className="badge-source-type"
                        style={{ color: "#f26522", background: "rgba(242, 101, 34, 0.1)", textTransform: "capitalize" }}
                      >
                        {btn.category || "apps"}
                      </span>
                    </div>
                    <div className="config-item-url">
                      {btn.source.length > 90
                        ? btn.source.slice(0, 90) + "…"
                        : btn.source}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="config-item-actions">
                    <button
                      className="btn-icon"
                      onClick={() => openModal(btn)}
                      title="Edit"
                    >
                      <PencilSimple size={16} weight="bold" />
                    </button>
                    <button
                      className="btn-icon delete"
                      onClick={() => handleDelete(btn.id, btn.button_name)}
                      title="Delete"
                    >
                      <Trash size={16} weight="bold" />
                    </button>
                  </div>
                </div>
              );
            })}

            {allButtons.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  padding: "48px 24px",
                  color: "var(--text-muted)",
                  fontSize: 14,
                }}
              >
                No buttons yet.{" "}
                <button
                  className="btn-primary"
                  style={{ display: "inline-flex", marginLeft: 8 }}
                  onClick={() => openModal(null)}
                >
                  Add your first button
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === "home" && (
          /* Home page settings panel */
          <div className="home-settings-panel">
            <p className="config-subtitle" style={{ marginBottom: "20px" }}>
              Configure what appears on the Home page. Choose between custom HTML or an Embed URL. Leave it blank or empty to show a clean blank screen.
            </p>

            {/* Mode Toggle */}
            <div className="home-mode-toggle">
              <button
                type="button"
                className={`home-mode-btn ${homeContentType === "html" ? "active" : ""}`}
                onClick={() => setHomeContentType("html")}
              >
                <Code size={16} weight="bold" />
                Custom HTML
              </button>
              <button
                type="button"
                className={`home-mode-btn ${homeContentType === "embed" ? "active" : ""}`}
                onClick={() => setHomeContentType("embed")}
              >
                <FrameCorners size={16} weight="bold" />
                Embed (iFrame URL)
              </button>
            </div>

            {/* HTML Editor */}
            {homeContentType === "html" && (
              <div className="form-group" style={{ marginTop: "16px" }}>
                <label className="form-label">HTML Content</label>
                <textarea
                  className="form-textarea"
                  value={homeContentValue}
                  onChange={(e) => setHomeContentValue(e.target.value)}
                  placeholder={`<h1>Welcome!</h1>\n<p>Add any HTML you like here.</p>`}
                  rows={16}
                  spellCheck={false}
                />
                <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "6px" }}>
                  HTML is rendered directly — you can use headings, lists, images, inline styles, etc.
                </p>
              </div>
            )}

            {/* Embed URL */}
            {homeContentType === "embed" && (
              <div className="form-group" style={{ marginTop: "16px" }}>
                <label className="form-label">Embed URL</label>
                <input
                  type="url"
                  className="form-input"
                  value={homeContentValue}
                  onChange={(e) => setHomeContentValue(e.target.value)}
                  placeholder="https://example.com/dashboard"
                />
                <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "6px" }}>
                  The URL will be embedded as a full-page iframe. Note: some sites block embedding via X-Frame-Options.
                </p>
              </div>
            )}

            {/* Preview strip */}
            {homeContentValue.trim() && homeContentType === "html" && (
              <div style={{ marginTop: "16px" }}>
                <label className="form-label" style={{ marginBottom: "8px", display: "block" }}>Preview</label>
                <div
                  className="home-html-preview"
                  dangerouslySetInnerHTML={{ __html: homeContentValue }}
                />
              </div>
            )}

            {/* Save bar */}
            <div className="home-save-bar">
              {homeSaveMsg && (
                <span
                  style={{
                    fontSize: "13px",
                    color: homeSaveMsg === "Saved!" ? "var(--success)" : "var(--danger)",
                    fontWeight: 600,
                  }}
                >
                  {homeSaveMsg === "Saved!" ? "✓ " : "✗ "}{homeSaveMsg}
                </span>
              )}
              <button
                type="button"
                className="btn-primary"
                onClick={handleSaveHomeContent}
                disabled={homeSaving}
                style={{ marginLeft: "auto" }}
              >
                {homeSaving ? "Saving…" : "Save Home Content"}
              </button>
            </div>
          </div>
        )}

        {(activeTab === "superadmin" || activeTab === "users") && (
          <>
            {!isSuperadminStatusLoaded ? (
              <div className="iframe-loading" style={{ minHeight: 220 }}>
                <div className="spinner" />
              </div>
            ) : !isSuperadminUnlocked ? (
              <div className="passcode-card" style={{ maxWidth: 440, margin: "32px auto" }}>
                <div className="passcode-icon">
                  <Shield size={28} weight="bold" />
                </div>
                <h3 className="card-title" style={{ fontSize: 18, fontWeight: 700, textAlign: "center", marginBottom: 20 }}>
                  Superadmin Passcode Required
                </h3>
                <form onSubmit={handleSuperadminUnlock}>
                  <div className="form-group" style={{ marginBottom: 16 }}>
                    <label className="form-label" htmlFor="superadmin-passcode-input">
                      Superadmin Passcode
                    </label>
                    <input
                      id="superadmin-passcode-input"
                      type="password"
                      className="form-input"
                      placeholder="Enter Passcode"
                      value={superPasscode}
                      onChange={(e) => setSuperPasscode(e.target.value)}
                      autoFocus
                      required
                    />
                  </div>
                  {superAuthError && (
                    <div className="error-message" style={{ marginBottom: 14 }}>
                      {superAuthError}
                    </div>
                  )}
                  <button type="submit" className="btn-primary" style={{ width: "100%" }}>
                    Unlock Superadmin Features
                  </button>
                </form>
              </div>
            ) : (
              <UserManagementTab />
            )}
          </>
        )}
      </div>

      {/* ── Edit / Add Modal ── */}
      {isModalOpen && (
        <div className="modal-overlay">
          <form className="modal-card" onSubmit={handleSave}>
            <h3 className="modal-header">
              {editingBtn?.id
                ? `Edit: ${editingBtn.button_name}`
                : "Add New Button"}
            </h3>

            <div className="form-grid">
              {/* Name */}
              <div className="form-group">
                <label className="form-label" htmlFor="modal-btn-name">
                  Button Name
                </label>
                <input
                  id="modal-btn-name"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Student Portal"
                  value={fName}
                  onChange={(e) => setFName(e.target.value)}
                  required
                />
              </div>

              {/* Source type */}
              <div className="form-group">
                <label className="form-label" htmlFor="modal-source-type">
                  Source Type
                </label>
                <select
                  id="modal-source-type"
                  className="form-select"
                  value={fType}
                  onChange={(e) =>
                    setFType(e.target.value as "link" | "embed" | "code")
                  }
                >
                  <option value="link">
                    Link — opens in a new tab
                  </option>
                  <option value="embed">
                    Embed — renders as iframe on same page
                  </option>
                  <option value="code">
                    Code — renders HTML / CSS / JS on same page
                  </option>
                </select>
              </div>

              {/* Category */}
              <div className="form-group">
                <label className="form-label" htmlFor="modal-category">
                  Category
                </label>
                <select
                  id="modal-category"
                  className="form-select"
                  value={fCategory}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFCategory(val);
                    if (val !== "custom" && !["apps", "tools", "resources"].includes(val.toLowerCase())) {
                      setFCustomCategory(val);
                    }
                  }}
                >
                  <option value="apps">Apps</option>
                  <option value="tools">Tools</option>
                  <option value="resources">Resources</option>
                  {existingCustomCats.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat} (Custom)
                    </option>
                  ))}
                  <option value="custom">+ Add New Custom Category...</option>
                </select>
              </div>

              {/* Custom Category Input */}
              {fCategory === "custom" && (
                <div className="form-group">
                  <label className="form-label" htmlFor="modal-custom-category">
                    Custom Category Label / Name
                  </label>
                  <input
                    id="modal-custom-category"
                    type="text"
                    className="form-input"
                    placeholder="e.g. Sales & Marketing, DevOps, HR, Security"
                    value={fCustomCategory}
                    onChange={(e) => setFCustomCategory(e.target.value)}
                    required
                  />
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    This label will appear as its own tab on the homepage portal.
                  </p>
                </div>
              )}

              {/* Source value */}
              <div className="form-group">
                <label className="form-label" htmlFor="modal-source-val">
                  {fType === "code" ? "HTML / CSS / JS Code" : "URL"}
                </label>
                {fType === "code" ? (
                  <>
                    <textarea
                      id="modal-source-val"
                      className="form-textarea"
                      placeholder={
                        "<h1>Hello!</h1>\n<style>body { background: #f0f0f0; }</style>\n<script>console.log('hi')</script>"
                      }
                      value={fSource}
                      onChange={(e) => setFSource(e.target.value)}
                      rows={12}
                      spellCheck={false}
                      required
                    />
                    <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                      Full HTML document or snippet. JS runs in a sandboxed iframe.
                    </p>
                  </>
                ) : (
                  <input
                    id="modal-source-val"
                    type="url"
                    className="form-input"
                    placeholder="https://example.com"
                    value={fSource}
                    onChange={(e) => setFSource(e.target.value)}
                    required
                  />
                )}
              </div>

              {/* Icon picker */}
              <div className="form-group">
                <label className="form-label">Icon</label>
                <div className="icon-select-grid">
                  {AVAILABLE_ICONS.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={`icon-option-btn ${fIcon === name ? "selected" : ""}`}
                      onClick={() => setFIcon(name)}
                      title={name}
                    >
                      {getIconComponent(name)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Image URL (Optional) */}
              <div className="form-group">
                <label className="form-label" htmlFor="modal-image-url">
                  App Image URL (Optional for Portal View)
                </label>
                <input
                  id="modal-image-url"
                  type="url"
                  className="form-input"
                  placeholder="https://example.com/app-logo.png or SVG URL"
                  value={fImageUrl}
                  onChange={(e) => setFImageUrl(e.target.value)}
                />
                {fImageUrl.trim() && (
                  <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Image Preview:</span>
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 8,
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-color)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        padding: 4,
                      }}
                    >
                      <Image
                        src={fImageUrl}
                        alt="App Logo Preview"
                        width={40}
                        height={40}
                        unoptimized
                        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    </div>
                  </div>
                )}
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  If specified, this logo/image will be displayed in the Home page Portal Apps grid instead of the default icon.
                </p>
              </div>

              {/* Role Access Permissions */}
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label className="form-label" style={{ marginBottom: 8, display: "block" }}>
                  Role Access Permissions
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {ROLE_OPTIONS.map((roleItem) => {
                    const isAdministrator = roleItem.id === "administrator";
                    const isChecked =
                      isAdministrator ||
                      (roleItem.id === "all"
                        ? fAllowedRoles.includes("all")
                        : !fAllowedRoles.includes("all") && fAllowedRoles.includes(roleItem.id));

                    return (
                      <label
                        key={roleItem.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--text-primary)",
                          background: isChecked ? "var(--primary-light, #EEF2FF)" : "var(--bg-secondary)",
                          padding: "6px 12px",
                          borderRadius: 8,
                          border: `1px solid ${isChecked ? "var(--primary-color, #4F46E5)" : "var(--border-color)"}`,
                          cursor: isAdministrator ? "not-allowed" : "pointer",
                          opacity: isAdministrator ? 0.8 : 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isAdministrator}
                          aria-label={isAdministrator ? "Administrator always has access" : roleItem.label}
                          onChange={(e) => {
                            if (roleItem.id === "all") {
                              setFAllowedRoles(["all"]);
                            } else {
                              let next = fAllowedRoles.filter((r) => r !== "all");
                              if (e.target.checked) {
                                next.push(roleItem.id);
                              } else {
                                next = next.filter((r) => r !== roleItem.id);
                              }
                              if (next.length === 0) {
                                next = ["all"];
                              }
                              setFAllowedRoles(next);
                            }
                          }}
                        />
                        {roleItem.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsModalOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Save Button
              </button>
            </div>
          </form>
        </div>
      )}

      {isSaving && (
        <div className="saving-overlay">
          <div className="saving-card">
            <div className="spinner" />
            <p className="saving-text">Saving changes...</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// User & Role Management Component (Central Auth DB)
// ─────────────────────────────────────────────────────────────
function UserManagementTab() {
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Modal State
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserWithRole | null>(null);

  // Form Fields
  const [uName, setUName] = useState("");
  const [uEmail, setUEmail] = useState("");
  const [uNim, setUNim] = useState("");
  const [uRoleIds, setURoleIds] = useState<number[]>([2]);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, rRes] = await Promise.all([getUsers(), getRoles()]);
      setUsers(uRes);
      setRoles(rRes);
    } catch (err) {
      console.error("Failed to load user management data", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const openUserModal = (user: UserWithRole | null) => {
    if (user) {
      setEditingUser(user);
      setUName(user.name);
      setUEmail(user.email);
      setUNim(user.nim || "");
      setURoleIds(user.role_ids && user.role_ids.length > 0 ? user.role_ids : [user.role_id || 2]);
    } else {
      setEditingUser(null);
      setUName("");
      setUEmail("");
      setUNim("");
      setURoleIds([2]);
    }
    setIsUserModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uName.trim() || !uEmail.trim()) return;

    setSaving(true);
    try {
      const data = {
        name: uName.trim(),
        email: uEmail.trim(),
        nim: uNim.trim(),
        role_ids: uRoleIds.length > 0 ? uRoleIds : [2],
      };

      const res = editingUser
        ? await updateUser(editingUser.id, data)
        : await createUser(data);

      if (res.success) {
        setIsUserModalOpen(false);
        await loadData();
      } else {
        alert(res.error || "Failed to save user.");
      }
    } catch (err: unknown) {
      alert(errorMessage(err, "Failed to save user."));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = async (id: number, name: string) => {
    if (!confirm(`Are you sure you want to delete user "${name}"?`)) return;
    try {
      const res = await deleteUser(id);
      if (res.success) {
        await loadData();
      } else {
        alert(res.error || "Failed to delete user.");
      }
    } catch (err: unknown) {
      alert(errorMessage(err, "Failed to delete user."));
    }
  };

  const renderRoleBadge = (roleName: string) => {
    const key = roleName?.toLowerCase() || "student";
    switch (key) {
      case "admin":
      case "superadmin":
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600, color: "#4F46E5", background: "#EEF2FF" }}>
            <Shield size={12} weight="bold" /> {roleName}
          </span>
        );
      case "lecturer":
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600, color: "#059669", background: "#ECFDF5" }}>
            <ChalkboardTeacher size={12} weight="bold" /> {roleName}
          </span>
        );
      case "intern":
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600, color: "#D97706", background: "#FFFBEB" }}>
            <Lightning size={12} weight="bold" /> {roleName}
          </span>
        );
      default:
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600, color: "#64748B", background: "#F1F5F9" }}>
            <GraduationCap size={12} weight="bold" /> {roleName}
          </span>
        );
    }
  };

  const filteredUsers = users.filter((u) =>
    u.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  // Superadmin Passcode Management state
  const [currPass, setCurrPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [passMsg, setPassMsg] = useState({ text: "", isError: false });
  const [updatingPass, setUpdatingPass] = useState(false);

  const handleUpdatePasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassMsg({ text: "", isError: false });

    if (newPass !== confirmPass) {
      setPassMsg({ text: "New passcodes do not match.", isError: true });
      return;
    }

    setUpdatingPass(true);
    try {
      const res = await updateSuperadminPasscode(currPass, newPass);
      if (res.success) {
        setPassMsg({ text: "Superadmin passcode successfully updated!", isError: false });
        setCurrPass("");
        setNewPass("");
        setConfirmPass("");
      } else {
        setPassMsg({ text: res.error || "Failed to update passcode.", isError: true });
      }
    } catch (err: unknown) {
      setPassMsg({ text: errorMessage(err, "Failed to update passcode."), isError: true });
    } finally {
      setUpdatingPass(false);
    }
  };

  return (
    <div className="user-management-panel" style={{ marginTop: 8 }}>
      {/* ── Security & Passcode Management Card ── */}
      {SHOW_PASSCODE_MANAGEMENT && (
      <div className="home-content-card" style={{ marginBottom: 28, background: "var(--bg-card)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <Shield size={20} weight="bold" color="var(--primary-color)" />
          <h4 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
            Security & Passcode Management
          </h4>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
          Update the Superadmin Security Key used to unlock sensitive platform controls and Central Auth accounts.
        </p>

        <form onSubmit={handleUpdatePasscode}>
          <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Current Passcode</label>
              <input
                type="password"
                className="form-input"
                placeholder="Current Passcode"
                value={currPass}
                onChange={(e) => setCurrPass(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">New Passcode</label>
              <input
                type="password"
                className="form-input"
                placeholder="New Passcode (min 5 chars)"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                minLength={5}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm New Passcode</label>
              <input
                type="password"
                className="form-input"
                placeholder="Confirm New Passcode"
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                required
              />
            </div>
          </div>

          {passMsg.text && (
            <div
              style={{
                marginTop: 12,
                fontSize: 13,
                fontWeight: 600,
                color: passMsg.isError ? "var(--danger, #EF4444)" : "var(--success, #10B981)",
              }}
            >
              {passMsg.isError ? "✗ " : "✓ "}{passMsg.text}
            </div>
          )}

          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" className="btn-primary" disabled={updatingPass}>
              {updatingPass ? "Updating Passcode..." : "Update Passcode"}
            </button>
          </div>
        </form>
      </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
            Central Auth User Accounts
          </h3>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 0" }}>
            Manage users, assign multiple roles, and configure system permissions in central-auth-binusgat.
          </p>
        </div>
        <button className="btn-primary" onClick={() => openUserModal(null)}>
          <Plus size={14} weight="bold" />
          &nbsp;Add User
        </button>
      </div>

      {/* Name Search Bar */}
      <div style={{ position: "relative", marginBottom: 16 }}>
        <MagnifyingGlass
          size={16}
          weight="bold"
          style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--text-secondary)",
          }}
        />
        <input
          type="text"
          className="form-input"
          placeholder="Search by name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ paddingLeft: 36, width: "100%" }}
        />
      </div>

      {loading ? (
        <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
          Loading user accounts...
        </div>
      ) : (
        <div className="config-list">
          {filteredUsers.map((u) => {
            const roleList = u.role_names && u.role_names.length > 0 ? u.role_names : [u.role_name || "student"];
            return (
              <div key={u.id} className="config-item" style={{ gap: 16 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: "50%",
                    background: "var(--primary-light, #EEF2FF)",
                    color: "var(--primary-color, #4F46E5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 15,
                  }}
                >
                  {u.name.charAt(0).toUpperCase()}
                </div>

                <div className="config-item-details">
                  <div className="config-item-name" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {u.name}
                    {roleList.map((rn: string, rIdx: number) => (
                      <React.Fragment key={rIdx}>
                        {renderRoleBadge(rn)}
                      </React.Fragment>
                    ))}
                  </div>
                  <div className="config-item-url" style={{ fontSize: 12 }}>
                    {u.email} {u.nim ? `• NIM: ${u.nim}` : ""}
                  </div>
                </div>

                <div className="config-item-actions">
                  <button className="btn-icon" onClick={() => openUserModal(u)} title="Edit User">
                    <PencilSimple size={16} weight="bold" />
                  </button>
                  <button className="btn-icon delete" onClick={() => handleDeleteUser(u.id, u.name)} title="Delete User">
                    <Trash size={16} weight="bold" />
                  </button>
                </div>
              </div>
            );
          })}

          {filteredUsers.length === 0 && (
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: 14 }}>
              {searchQuery ? `No user found matching "${searchQuery}".` : "No users found in Central Auth database."}
            </div>
          )}
        </div>
      )}

      {/* ── Add / Edit User Modal ── */}
      {isUserModalOpen && (
        <div className="modal-overlay">
          <form className="modal-card" onSubmit={handleSaveUser}>
            <h3 className="modal-header">
              {editingUser ? `Edit User: ${editingUser.name}` : "Create New User Account"}
            </h3>

            <div className="form-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="user-name">Full Name</label>
                <input
                  id="user-name"
                  type="text"
                  className="form-input"
                  placeholder="Full name"
                  value={uName}
                  onChange={(e) => setUName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="user-email">Email Address</label>
                <input
                  id="user-email"
                  type="email"
                  className="form-input"
                  placeholder="user@domain.com"
                  value={uEmail}
                  onChange={(e) => setUEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="user-nim">NIM</label>
                <input
                  id="user-nim"
                  type="text"
                  className="form-input"
                  placeholder="Student ID"
                  value={uNim}
                  onChange={(e) => setUNim(e.target.value)}
                />
              </div>

              {/* Multi-Role Checkboxes */}
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label className="form-label">Assigned Roles (Multi-Role Support)</label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginTop: 6 }}>
                  {roles.map((r) => {
                    const isChecked = uRoleIds.includes(r.id);
                    return (
                      <label
                        key={r.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "8px 12px",
                          borderRadius: 8,
                          border: `1px solid ${isChecked ? "var(--primary-color, #4F46E5)" : "var(--border-color)"}`,
                          background: isChecked ? "var(--primary-light, rgba(79, 70, 229, 0.1))" : "transparent",
                          cursor: "pointer",
                          fontSize: 13,
                          fontWeight: isChecked ? 600 : 400,
                          color: "var(--text-primary)",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setURoleIds([...uRoleIds, r.id]);
                            } else {
                              setURoleIds(uRoleIds.filter((id) => id !== r.id));
                            }
                          }}
                        />
                        <span>{r.name}</span>
                      </label>
                    );
                  })}
                </div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                  You can assign multiple roles to a single user account simultaneously.
                </p>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsUserModalOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save User"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────
interface MainContentProps {
  button: Button | null;
  onGoHome: () => void;
  isAdminMode?: boolean;
  buttons?: Button[];
  onRefresh?: () => void;
}

export default function MainContent({
  button,
  onGoHome,
  isAdminMode = false,
  buttons = [],
  onRefresh = () => {},
}: MainContentProps) {
  if (isAdminMode) {
    return <AdminPanel initialButtons={buttons} onRefresh={onRefresh} />;
  }
  if (button) {
    return <ContentRenderer key={button.id} button={button} onGoHome={onGoHome} />;
  }
  return null;
}
