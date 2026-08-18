"use client";

import React from "react";
import Image from "next/image";
import {
  ArrowSquareOut,
  FrameCorners,
  Code,
  X,
  Gear,
  Cube,
  House,
  GraduationCap,
  FileText,
  Translate,
  Books,
  Trophy,
  Lifebuoy,
  Rocket,
  Compass,
  ShareNetwork,
  Scroll,
  User,
  Envelope,
  Calendar,
  Shield,
  DotsNine,
  Clock,
  Notebook,
  Chat,
  Bookmark,
  AppWindow,
  Globe,
  Database,
  Browsers,
  PresentationChart,
  ChartBar,
  Lightning,
  Leaf,
  Star,
  Heart,
  Smiley,
} from "@phosphor-icons/react";
import type { IconProps } from "@phosphor-icons/react";
import type { ComponentType } from "react";
import { Button } from "@/lib/db";
import { formatRoleName } from "@/lib/permissions";

// ── Icon helper (exported so Home.tsx can reuse it) ───────────
const ICON_MAP: Record<string, ComponentType<IconProps>> = {
  ArrowSquareOut, FrameCorners, Code, X, Gear, Cube, House,
  GraduationCap, FileText, Translate, Books, Trophy, Lifebuoy,
  Rocket, Compass, ShareNetwork, Scroll, User, Envelope, Calendar,
  Shield, Clock, Notebook, Chat, Bookmark, AppWindow, Globe,
  Database, Browsers, PresentationChart, ChartBar, Lightning,
  Leaf, Star, Heart, Smiley,
};

export function getIconComponent(iconName: string, size = 20, weight: "regular" | "bold" | "fill" = "regular") {
  const IconComponent = ICON_MAP[iconName];
  if (IconComponent) return <IconComponent size={size} weight={weight} />;
  return <Cube size={size} weight={weight} />;
}

interface SidebarProps {
  buttons: Button[];
  isLoading?: boolean;
  activeButtonId: number | null;
  isAdminActive: boolean;
  isHomeActive: boolean;
  canAccessSettings?: boolean;
  currentUser?: { name: string; activeRole: string; roles: string[] } | null;
  onOpenRoleSwitch?: () => void;
  onButtonClick: (button: Button) => void;
  onGoHome: () => void;
  onOpenAdmin: () => void;
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({
  buttons,
  isLoading = false,
  activeButtonId,
  isAdminActive,
  isHomeActive,
  canAccessSettings = false,
  currentUser,
  onOpenRoleSwitch,
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
        <button
          className="header-candybox-btn"
          onClick={onClose}
          title="Toggle Menu"
          aria-label="Toggle Menu"
        >
          <DotsNine size={22} weight="bold" />
        </button>
        <div
          className="logo-container"
          style={{ cursor: "pointer" }}
          onClick={onGoHome}
          title="Go to Home"
        >
          <span className="logo-gat">GAT</span>
          <span className="logo-app">APP</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-menu">
        <div className="sidebar-section-title">GAT Applications</div>
        <ul className="menu-list">
          {/* Hardcoded Home page button */}
          <li>
            <button
              className={`menu-item-link ${isHomeActive ? "active" : ""}`}
              onClick={() => {
                onGoHome();
              }}
              title="Home"
            >
              <div className="menu-item-icon-container">
                {getIconComponent("House", 18)}
              </div>
              <span className="menu-item-text">Home</span>
            </button>
          </li>

          {buttons.map((btn) => {
            const isActive = btn.id === activeButtonId;

            return (
              <li key={btn.id}>
                <button
                  className={`menu-item-link ${isActive ? "active" : ""}`}
                  onClick={() => onButtonClick(btn)}
                  title={btn.button_name}
                >
                  <div className="menu-item-icon-container">
                    {btn.image_url ? (
                      <Image
                        src={btn.image_url}
                        alt={btn.button_name}
                        width={18}
                        height={18}
                        unoptimized
                        style={{ width: 18, height: 18, objectFit: "contain", borderRadius: 3 }}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      getIconComponent(btn.icon, 18)
                    )}
                  </div>
                  <span className="menu-item-text">{btn.button_name}</span>
                </button>
              </li>
            );
          })}

          {isLoading && buttons.length === 0 && (
            <>
              <li style={{ padding: "8px 12px", opacity: 0.5 }}>
                <div style={{ height: 32, borderRadius: 6, background: "var(--border-color)", width: "100%", animation: "pulse 1.5s infinite ease-in-out" }} />
              </li>
              <li style={{ padding: "8px 12px", opacity: 0.3 }}>
                <div style={{ height: 32, borderRadius: 6, background: "var(--border-color)", width: "80%", animation: "pulse 1.5s infinite ease-in-out" }} />
              </li>
            </>
          )}

          {!isLoading && buttons.length === 0 && (
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

      {/* Footer & Role Box */}
      <div className="sidebar-footer">
        {currentUser && currentUser.activeRole && (
          <div className="sidebar-role-box">
            <div className="sidebar-role-box-top">
              <div className="sidebar-role-box-title">
                <Smiley size={18} weight="bold" />
                <span>Role</span>
              </div>
              <button
                type="button"
                className="sidebar-role-change-btn"
                onClick={onOpenRoleSwitch}
              >
                CHANGE
              </button>
            </div>
            <div className="sidebar-role-box-name">
              {formatRoleName(currentUser.activeRole)}
            </div>
          </div>
        )}

        {canAccessSettings && (
          <button
            className={`settings-btn ${isAdminActive ? "active" : ""}`}
            onClick={onOpenAdmin}
          >
            <div className="menu-item-icon-container">
              <Gear size={16} weight="bold" />
            </div>
            <span>System Settings</span>
          </button>
        )}
      </div>
    </aside>
  );
}
