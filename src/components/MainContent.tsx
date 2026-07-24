"use client";

import React, { useState, useEffect } from "react";
import {
  ArrowSquareOut,
  LockKey,
  Plus,
  CaretUp,
  CaretDown,
  PencilSimple,
  Trash,
  AppWindow,
  House,
  Code,
  FrameCorners,
  Cube,
} from "@phosphor-icons/react";
import { Button } from "@/lib/db";
import {
  verifyUserCredentials,
  verifyPasscode,
  getButtons,
  addButton,
  updateButton,
  deleteButton,
  reorderButtons,
  getSetting,
  updateSetting,
  isSessionValid,
  logout,
} from "@/lib/actions";
import { getIconComponent } from "./Sidebar";

// ── Icon list for the picker ──────────────────────────────────
const AVAILABLE_ICONS = [
  "House","GraduationCap","FileText","Translate","Books","Trophy",
  "Lifebuoy","Rocket","Compass","ShareNetwork","Scroll","User",
  "Envelope","Calendar","Shield","Clock","Notebook","Chat",
  "Bookmark","AppWindow","Globe","Database","Code","Browsers",
  "PresentationChart","ChartBar","Lightning","Leaf","Star","Heart",
];

const GRADIENTS = [
  "gradient-1","gradient-2","gradient-3","gradient-4","gradient-5",
  "gradient-6","gradient-7","gradient-8","gradient-9","gradient-10",
];

// ── Source type badge colors ──────────────────────────────────
const SOURCE_COLORS: Record<string, { color: string; bg: string }> = {
  link:  { color: "#3b82f6", bg: "#eff6ff" },
  embed: { color: "#10b981", bg: "#f0fdf4" },
  code:  { color: "#8b5cf6", bg: "#f5f3ff" },
};

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

  useEffect(() => {
    setLoading(true);
  }, [button.id]);

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
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        />
        {/* Fallback bar */}
        <div className="iframe-fallback-bar">
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Trouble loading?
          </span>
          <a
            href={button.source}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
            style={{
              padding: "4px 12px",
              fontSize: 12,
              textDecoration: "none",
              borderRadius: "var(--radius-full)",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <ArrowSquareOut size={12} weight="bold" />
            Open in New Tab
          </a>
        </div>
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
  // Auth state
  const [email, setEmail] = useState("");
  const [nim, setNim] = useState("");
  const [verified, setVerified] = useState(false);
  const [authError, setAuthError] = useState("");
  const [userInfo, setUserInfo] = useState<{ name: string; role_name: string } | null>(null);

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

  // Tab switcher state
  const [activeTab, setActiveTab] = useState<"apps" | "home">("apps");

  // Home page content state
  const [homeContentType, setHomeContentType] = useState<"html" | "embed">("html");
  const [homeContentValue, setHomeContentValue] = useState("");
  const [homeSaving, setHomeSaving] = useState(false);
  const [homeSaveMsg, setHomeSaveMsg] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      const ok = await isSessionValid();
      if (ok) {
        setVerified(true);
        // Force reload buttons
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
    }
    checkAuth();
  }, []);

  const loadHomeSettings = async () => {
    try {
      const [type, value] = await Promise.all([
        getSetting("home_content_type"),
        getSetting("home_content_value"),
      ]);
      setHomeContentType((type as "html" | "embed") || "html");
      setHomeContentValue(value || "");
    } catch (err) {
      console.error("Failed to load home page settings", err);
    }
  };

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
    } catch (err: any) {
      setHomeSaveMsg(err.message || "Failed to save.");
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

  // Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    const res = await verifyUserCredentials(email, nim);
    if (res.success) {
      setVerified(true);
      if (res.user) {
        setUserInfo({ name: res.user.name, role_name: res.user.role_name });
      }
      await reload();
      await loadHomeSettings();
    } else {
      setAuthError(res.error || "Invalid Email or NIM.");
    }
  };


  // Open modal
  const openModal = (btn: Button | null) => {
    if (btn) {
      setEditingBtn(btn);
      setFName(btn.button_name);
      setFType(btn.source_type);
      setFSource(btn.source);
      setFIcon(btn.icon);
    } else {
      setEditingBtn(null);
      setFName("");
      setFType("link");
      setFSource("");
      setFIcon("Cube");
    }
    setIsModalOpen(true);
  };

  // Save (add or update)
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fName.trim() || !fSource.trim()) return;

    setIsSaving(true);
    const data = {
      button_name: fName.trim(),
      source_type: fType,
      source: fSource.trim(),
      icon: fIcon,
    };

    try {
      const res = editingBtn?.id
        ? await updateButton("", editingBtn.id, data)
        : await addButton("", data);

      if (res.success) {
        setIsModalOpen(false);
        await reload();
      } else {
        alert(res.error || "Failed to save.");
      }
    } catch (err: any) {
      alert(err.message || "Failed to save.");
    } finally {
      setIsSaving(false);
    }
  };

  // Delete
  const handleDelete = async (id: number) => {
    if (!confirm("Delete this button?")) return;
    setIsSaving(true);
    try {
      const res = await deleteButton("", id);
      if (res.success) await reload();
      else alert(res.error);
    } catch (err: any) {
      alert(err.message || "Failed to delete.");
    } finally {
      setIsSaving(false);
    }
  };

  // Reorder
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
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Login gate ─────────────────────────────────────────────
  if (!verified) {
    return (
      <div className="passcode-container">
        <form className="passcode-card" onSubmit={handleLogin} autoComplete="off">
          <div className="passcode-icon">
            <LockKey size={28} weight="bold" />
          </div>
          <h2 className="card-title">System Settings Access</h2>
          <p className="banner-welcome" style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
            Enter your Email and NIM to verify your admin privileges.
          </p>

          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="form-label" htmlFor="admin-email">
              Email Address
            </label>
            <input
              id="admin-email"
              type="email"
              className="form-input"
              placeholder="user@domain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="admin-nim">
              NIM
            </label>
            <input
              id="admin-nim"
              type="text"
              className="form-input"
              placeholder="Enter NIM"
              value={nim}
              onChange={(e) => setNim(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          {authError && <div className="error-message" style={{ marginTop: 12 }}>{authError}</div>}

          <button type="submit" className="btn-primary" style={{ width: "100%", marginTop: 16 }}>
            Authenticate & Access
          </button>
        </form>
      </div>
    );
  }

  // ── Admin panel ────────────────────────────────────────────
  return (
    <div className="settings-wrapper">
      <div className="config-container">
        {/* Header */}
        <div className="config-header">
          <div>
            <h1 className="config-title">GAT App Admin</h1>
            <p className="config-subtitle">
              Configure GAT App application buttons and home page content.
              {userInfo && (
                <span style={{ display: "block", color: "var(--primary-color)", fontWeight: 600, marginTop: 4 }}>
                  Logged in as: {userInfo.name} ({userInfo.role_name})
                </span>
              )}
            </p>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              className="btn-secondary"
              onClick={async () => {
                await logout();
                setVerified(false);
                setEmail("");
                setNim("");
                setUserInfo(null);
              }}
            >
              <LockKey size={14} weight="bold" />
              &nbsp;Lock
            </button>

            {activeTab === "apps" && (
              <button className="btn-primary" onClick={() => openModal(null)}>
                <Plus size={14} weight="bold" />
                &nbsp;Add Button
              </button>
            )}
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="settings-tabs" style={{ marginBottom: "20px" }}>
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === "apps" ? "active" : ""}`}
            onClick={() => setActiveTab("apps")}
          >
            <AppWindow size={16} weight="bold" />
            Sidebar Buttons
          </button>
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === "home" ? "active" : ""}`}
            onClick={() => setActiveTab("home")}
          >
            <House size={16} weight="bold" />
            Home Page Content
          </button>
        </div>

        {activeTab === "apps" ? (
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

                  {/* Icon */}
                  <div className="config-item-icon" style={{ background: "transparent", color: "var(--text-secondary)", width: "auto", height: "auto" }}>
                    {getIconComponent(btn.icon, 20)}
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
                      onClick={() => handleDelete(btn.id)}
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
        ) : (
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
    return <ContentRenderer button={button} onGoHome={onGoHome} />;
  }
  return null;
}
