"use client";

import React from "react";
import * as Icons from "@phosphor-icons/react";
import { Button } from "@/lib/db";

// ── Icon helper (exported so Home.tsx can reuse it) ───────────
export function getIconComponent(iconName: string, size = 20, weight: "regular" | "bold" | "fill" = "regular") {
  const IconComponent = (Icons as any)[iconName];
  if (IconComponent) return <IconComponent size={size} weight={weight} />;
  return <Icons.Cube size={size} weight={weight} />;
}

// ── Source type metadata ──────────────────────────────────────
const SOURCE_META = {
  link:  { icon: <Icons.ArrowSquareOut size={11} weight="bold" />, color: "#3b82f6" },
  embed: { icon: <Icons.FrameCorners   size={11} weight="bold" />, color: "#10b981" },
  code:  { icon: <Icons.Code           size={11} weight="bold" />, color: "#8b5cf6" },
};

// ── Gradient classes ──────────────────────────────────────────
const GRADIENTS = [
  "gradient-1","gradient-2","gradient-3","gradient-4","gradient-5",
  "gradient-6","gradient-7","gradient-8","gradient-9","gradient-10",
];

interface SidebarProps {
  buttons: Button[];
  activeButtonId: number | null;
  isAdminActive: boolean;
  isHomeActive: boolean;
  onButtonClick: (button: Button) => void;
  onGoHome: () => void;
  onOpenAdmin: () => void;
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({
  buttons,
  activeButtonId,
  isAdminActive,
  isHomeActive,
  onButtonClick,
  onGoHome,
  onOpenAdmin,
  isOpen,
  onClose,
}: SidebarProps) {
  return (
    <aside className={`sidebar ${isOpen ? "open" : ""}`}>
      {/* Header */}
      <div className="sidebar-header">
        <div className="sidebar-header-top">
          <div className="logo-container">
            <span className="logo-gat">GAT</span>
            <span className="logo-app">APP</span>
          </div>
          <button
            className="header-candybox-btn"
            onClick={onClose}
            title="Close menu"
            style={{ width: 32, height: 32 }}
          >
            <Icons.X size={18} weight="bold" />
          </button>
        </div>
        <div className="sidebar-title">GAT Applications</div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-menu">
        <ul className="menu-list">
          {/* Hardcoded Home page button */}
          <li>
            <button
              className={`menu-item-link ${isHomeActive ? "active" : ""}`}
              onClick={() => {
                onGoHome();
                onClose();
              }}
              title="Home"
            >
              <div className="menu-item-icon-container">
                {getIconComponent("House", 18)}
              </div>
              <span className="menu-item-text">Home</span>
            </button>
          </li>

          {buttons.map((btn, index) => {
            const isActive = btn.id === activeButtonId;

            return (
              <li key={btn.id}>
                <button
                  className={`menu-item-link ${isActive ? "active" : ""}`}
                  onClick={() => onButtonClick(btn)}
                  title={btn.button_name}
                >
                  <div className="menu-item-icon-container">
                    {getIconComponent(btn.icon, 18)}
                  </div>
                  <span className="menu-item-text">{btn.button_name}</span>
                </button>
              </li>
            );
          })}

          {buttons.length === 0 && (
            <li>
              <div className="menu-empty-state">
                No apps yet.
                <br />
                Add one in Settings.
              </div>
            </li>
          )}
        </ul>
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <button
          className={`settings-btn ${isAdminActive ? "active" : ""}`}
          onClick={onOpenAdmin}
        >
          <div className="menu-item-icon-container">
            <Icons.Gear size={16} weight="bold" />
          </div>
          <span>System Settings</span>
        </button>
      </div>
    </aside>
  );
}
