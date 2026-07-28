"use client";

import React, { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Home from "@/components/Home";
import MainContent from "@/components/MainContent";
import { Button } from "@/lib/db";
import { getButtons, verifyUserCredentials, logout } from "@/lib/actions";
import {
  DotsNine,
  ArrowLeft,
  SignIn,
  SignOut,
  Shield,
  Lightning,
  ChalkboardTeacher,
  GraduationCap,
  CheckCircle,
  X,
  Smiley,
} from "@phosphor-icons/react";

export function formatRoleName(roleName: string): string {
  if (!roleName) return "";
  const key = roleName.toLowerCase();
  if (["admin", "administrator", "superadmin"].includes(key)) return "Administrator";
  if (key === "intern") return "Intern";
  if (key === "student") return "Student";
  if (key === "lecturer") return "Lecturer";
  return roleName.charAt(0).toUpperCase() + roleName.slice(1);
}

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

export interface LoggedInUser {
  name: string;
  email: string;
  roles: string[];
  activeRole: string;
}

let cachedButtons: Button[] = [];

export default function GatAppPage({ params }: PageProps) {
  const { slug } = use(params);
  const router = useRouter();

  const [buttons, setButtons] = useState<Button[]>(cachedButtons);
  const [loading, setLoading] = useState(cachedButtons.length === 0);

  // User Authentication & Role State
  const [currentUser, setCurrentUser] = useState<LoggedInUser | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  // Modal open states
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isRoleSwitchModalOpen, setIsRoleSwitchModalOpen] = useState(false);

  // Login Form fields
  const [loginEmail, setLoginEmail] = useState("");
  const [loginNim, setLoginNim] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Load saved session on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("gat_user_session");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.email && parsed.roles && parsed.roles.length > 0) {
          setCurrentUser(parsed);
        }
      }
    } catch (e) {
      console.error("Failed to restore auth session:", e);
    } finally {
      setSessionLoaded(true);
    }
  }, []);

  const fetchButtons = useCallback(async () => {
    try {
      const data = await getButtons();
      cachedButtons = data;
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

  // Compute admin status based on activeRole
  const isAdmin = !!(
    currentUser &&
    currentUser.activeRole &&
    ["admin", "administrator", "superadmin"].includes(
      currentUser.activeRole.toLowerCase()
    )
  );

  // Redirect / to /home
  useEffect(() => {
    if (!currentSlug && !loading) {
      router.replace("/home");
    }
  }, [currentSlug, loading, router]);

  // Protect /settings route if not admin
  useEffect(() => {
    if (sessionLoaded && currentSlug === "settings" && !isAdmin && !loading) {
      router.replace("/home");
    }
  }, [sessionLoaded, currentSlug, isAdmin, loading, router]);

  let activeView:
    | { kind: "home" }
    | { kind: "admin" }
    | { kind: "content"; button: Button } = { kind: "home" };

  if (currentSlug === "settings" && (isAdmin || !sessionLoaded)) {
    activeView = { kind: "admin" };
  } else if (currentSlug === "home" || !currentSlug || (currentSlug === "settings" && !isAdmin && sessionLoaded)) {
    activeView = { kind: "home" };
  } else if (currentSlug) {
    const matchingButton = buttons.find(
      (btn) => slugify(btn.button_name) === currentSlug
    );
    if (matchingButton) {
      activeView = { kind: "content", button: matchingButton };
    }
  }

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const handleButtonClick = (button: Button) => {
    if (button.source_type === "link") {
      window.open(button.source, "_blank", "noopener,noreferrer");
      return;
    }
    router.push("/" + slugify(button.button_name));
  };

  const handleOpenAdmin = () => {
    if (isAdmin) {
      router.push("/settings");
    }
  };

  const handleGoHome = () => {
    router.push("/home");
  };

  // Login form submit handler
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setIsLoggingIn(true);

    try {
      const res = await verifyUserCredentials(loginEmail, loginNim);
      if (res.success && res.user) {
        const rawRoles: string[] = res.user.roles || res.user.role_name.split(",").map((r: string) => r.trim());
        const userRoles: string[] = Array.from(new Set(rawRoles.filter(Boolean)));

        const hasAdminRole = userRoles.some((r: string) =>
          ["admin", "administrator", "superadmin"].includes(r.toLowerCase())
        );
        const defaultRole = hasAdminRole
          ? "Administrator"
          : userRoles[0] || "User";

        const userObj: LoggedInUser = {
          name: res.user.name,
          email: res.user.email,
          roles: userRoles,
          activeRole: defaultRole,
        };

        setCurrentUser(userObj);
        localStorage.setItem("gat_user_session", JSON.stringify(userObj));
        setIsLoginModalOpen(false);
        setLoginEmail("");
        setLoginNim("");
      } else {
        setLoginError(res.error || "Invalid Email or NIM credentials.");
      }
    } catch (err: any) {
      setLoginError(err.message || "Authentication failed.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  // User Logout handler
  const handleUserLogout = async () => {
    await logout();
    setCurrentUser(null);
    localStorage.removeItem("gat_user_session");
    if (currentSlug === "settings") {
      router.push("/home");
    }
  };

  // Switch Active Role handler
  const handleSelectActiveRole = (roleName: string) => {
    if (!currentUser) return;
    const isNewAdmin = ["admin", "administrator", "superadmin"].includes(
      roleName.toLowerCase()
    );

    const updatedUser: LoggedInUser = {
      ...currentUser,
      activeRole: isNewAdmin ? "Administrator" : roleName,
    };

    setCurrentUser(updatedUser);
    localStorage.setItem("gat_user_session", JSON.stringify(updatedUser));
    setIsRoleSwitchModalOpen(false);

    if (!isNewAdmin && currentSlug === "settings") {
      router.push("/home");
    }
  };

  // Dynamic header title
  let headerTitle = "HOME";
  if (activeView.kind === "admin") headerTitle = "SYSTEM SETTINGS";
  else if (activeView.kind === "content")
    headerTitle = activeView.button.button_name.toUpperCase();

  const activeButtonId = activeView.kind === "content" ? activeView.button.id : null;

  // Filter visible buttons based on user activeRole / public access
  const visibleButtons = buttons.filter((btn) => {
    const rawAllowed = (btn.allowed_roles || "all").toLowerCase();
    if (rawAllowed === "all" || rawAllowed.includes("all")) return true;
    if (!currentUser || !currentUser.activeRole) return false;

    const userRole = currentUser.activeRole.toLowerCase();
    const allowedList = rawAllowed.split(",").map((r) => r.trim());

    if (
      ["admin", "administrator", "superadmin"].includes(userRole) &&
      (allowedList.includes("admin") || allowedList.includes("administrator") || allowedList.includes("superadmin"))
    ) {
      return true;
    }

    return allowedList.includes(userRole);
  });

  return (
    <div className="app-container">
      {/* ── Sidebar ── */}
      <Sidebar
        buttons={visibleButtons}
        isLoading={loading}
        activeButtonId={activeButtonId}
        isAdminActive={activeView.kind === "admin"}
        isHomeActive={activeView.kind === "home"}
        canAccessSettings={isAdmin}
        currentUser={currentUser}
        onOpenRoleSwitch={() => setIsRoleSwitchModalOpen(true)}
        onButtonClick={handleButtonClick}
        onGoHome={handleGoHome}
        onOpenAdmin={handleOpenAdmin}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      {/* ── Main Wrapper ── */}
      <div className="main-wrapper">
        {/* ── Header ── */}
        <header className="app-header">
          {!isSidebarOpen && (
            <button
              className="header-candybox-btn"
              onClick={() => setIsSidebarOpen(true)}
              title="Toggle Menu"
            >
              <DotsNine size={22} weight="bold" />
            </button>
          )}

          {!isSidebarOpen && (
            <div
              className="logo-container"
              style={{ cursor: "pointer" }}
              onClick={handleGoHome}
              title="Go to Home"
            >
              <span className="logo-gat">GAT</span>
              <span className="logo-app">APP</span>
            </div>
          )}

          {!isSidebarOpen && <div className="header-divider" />}
          <span className="header-title">{headerTitle}</span>

          {/* Back button when viewing content */}
          {activeView.kind === "content" && (
            <button
              className="btn-secondary"
              onClick={handleGoHome}
              style={{ padding: "6px 14px", fontSize: 13, marginLeft: 16 }}
            >
              <ArrowLeft size={14} weight="bold" />
              &nbsp;Back
            </button>
          )}

          {/* Header Right Auth Controls */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            {!currentUser ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => setIsLoginModalOpen(true)}
                style={{ padding: "6px 18px", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}
              >
                <SignIn size={16} weight="bold" />
                Login
              </button>
            ) : (
              <div className="user-profile-pill">
                <div className="user-avatar-circle">
                  {currentUser.name.charAt(0).toUpperCase()}
                </div>
                <div className="user-info-text">
                  <span className="user-name-title">{currentUser.name}</span>
                  <span className="user-role-subtitle">{formatRoleName(currentUser.activeRole)}</span>
                </div>
                <button
                  type="button"
                  className="btn-logout-pill"
                  onClick={handleUserLogout}
                  title="Logout"
                  style={{
                    padding: 0,
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <SignOut size={16} weight="bold" />
                </button>
              </div>
            )}
          </div>
        </header>

        {/* ── Main Viewport Content ── */}
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
              {activeView.kind === "home" && <Home buttons={visibleButtons} currentUser={currentUser} />}

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

      {/* ── Login Modal ── */}
      {isLoginModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: 420, padding: 24, borderRadius: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
                Sign In to GAT App
              </h3>
              <button
                className="btn-icon"
                onClick={() => setIsLoginModalOpen(false)}
                style={{ padding: 4 }}
              >
                <X size={18} weight="bold" />
              </button>
            </div>

            <form onSubmit={handleLoginSubmit} style={{ marginTop: 8 }}>
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label" htmlFor="header-login-email">Email Address</label>
                <input
                  id="header-login-email"
                  type="email"
                  className="form-input"
                  placeholder="user@domain.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label" htmlFor="header-login-nim">NIM</label>
                <input
                  id="header-login-nim"
                  type="password"
                  className="form-input"
                  placeholder="Enter NIM"
                  value={loginNim}
                  onChange={(e) => setLoginNim(e.target.value)}
                  required
                />
              </div>

              {loginError && (
                <div className="error-message" style={{ marginBottom: 16 }}>
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                className="btn-primary"
                style={{ width: "100%", justifyContent: "center", padding: "10px 0" }}
                disabled={isLoggingIn}
              >
                {isLoggingIn ? "Authenticating…" : "Sign In"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Switch Active Role Modal (Modern Unique Design) ── */}
      {isRoleSwitchModalOpen && currentUser && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: 480, padding: 28, borderRadius: 16 }}>
            {/* Header */}
            <div style={{ marginBottom: 6 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
                Switch Active Role
              </h3>
            </div>

            <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, margin: "0 0 20px" }}>
              Choose which role to use for this session. Your permissions and access will update instantly across GAT App.
            </p>

            {/* Role List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
              {currentUser.roles.map((roleName) => {
                const key = roleName.toLowerCase();
                const isActive =
                  currentUser.activeRole.toLowerCase() === key ||
                  (key === "admin" && currentUser.activeRole.toLowerCase() === "administrator") ||
                  (key === "administrator" && currentUser.activeRole.toLowerCase() === "admin");

                let title = roleName;
                let desc = "Standard user access";
                let icon = <GraduationCap size={22} weight="bold" color="#64748B" />;
                let iconBg = "#F1F5F9";

                if (["admin", "administrator", "superadmin"].includes(key)) {
                  title = "Administrator";
                  desc = "Full system control, buttons & platform settings";
                  icon = <Shield size={22} weight="bold" color="#4F46E5" />;
                  iconBg = "#EEF2FF";
                } else if (key === "intern") {
                  title = "Intern";
                  desc = "Social Media Intern";
                  icon = <Lightning size={22} weight="bold" color="#D97706" />;
                  iconBg = "#FFFBEB";
                } else if (key === "lecturer") {
                  title = "Lecturer";
                  desc = "Lecturer Academic Access";
                  icon = <ChalkboardTeacher size={22} weight="bold" color="#059669" />;
                  iconBg = "#ECFDF5";
                } else if (key === "student") {
                  title = "Student";
                  desc = "Student Learning Access";
                  icon = <GraduationCap size={22} weight="bold" color="#64748B" />;
                  iconBg = "#F1F5F9";
                }

                return (
                  <div
                    key={roleName}
                    onClick={() => handleSelectActiveRole(roleName)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: "14px 16px",
                      borderRadius: 12,
                      border: `1.5px solid ${isActive ? "#4F46E5" : "var(--border-color)"}`,
                      background: isActive ? "#EEF2FF" : "var(--bg-secondary)",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 10,
                        background: iconBg,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                        {title}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                        {desc}
                      </div>
                    </div>
                    {isActive && (
                      <CheckCircle size={22} weight="fill" color="#4F46E5" />
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIsRoleSwitchModalOpen(false)}
              style={{ width: "100%", justifyContent: "center", padding: "10px 0", fontSize: 14, fontWeight: 600 }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
