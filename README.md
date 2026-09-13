# GAT Portal (GAT App)

[![Next.js](https://img.shields.io/badge/Next.js-16.2-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2-blue?style=flat-square&logo=react)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4.0-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![Database](https://img.shields.io/badge/Database-SQLite-00E599?style=flat-square&logo=sqlite)](https://sqlite.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

> A modern, unified gateway and application launcher providing role-aware navigation, seamless application embedding, dynamic notifications, and administrative governance for the GAT ecosystem.

---

## 🌟 Executive Overview

**GAT Portal** serves as the single pane of glass for all tools, dashboards, internal utilities, and web services across the organization. Instead of juggling dozens of disconnected bookmarks and differing access rules, members access a centralized, personalized launcher that automatically tailors available apps, services, and communications according to their verified identity and active operational role.

### Why GAT Portal?

- **Unified Access Hub**: Brings web applications, external documentation, internal tools, and embedded dashboards into one coherent workspace.
- **Dynamic Context Switching**: Enables team members wearing multiple hats (e.g., teaching, administration, internship) to switch operational roles instantly without re-authenticating.
- **Embedded In-App Experience**: Supports launching applications in isolated, responsive canvas frames alongside the master navigation bar.
- **Enterprise Governance**: Built-in audit trails, application telemetry, and live health monitors to ensure maximum uptime and operational security.

---

## 🚀 Core Features

### 1. 🧭 Dynamic Application Portal & Launcher
- **Multi-Mode Launching**:
  - **Embedded Frame (`embed`)**: Integrates web applications directly within the portal frame with slug-based deep-linking (`/[slug]`), keeping users in flow without tab clutter.
  - **Direct Redirect / New Tab (`link`)**: Seamlessly routes to external destinations, university systems, and cloud providers.
  - **Custom Widgets (`code`)**: Directly renders custom HTML/JavaScript snippets for lightweight utility tools and dashboards.
- **Smart Catalog Navigation**: Real-time fuzzy search by application name, category filtering (e.g., *Apps*, *Utilities*, *Portals*), and custom order sequencing.
- **Custom Visual Branding**: Each application tile supports Phosphor iconography, custom badges, and external image thumbnails.

---

### 2. 🔐 Fine-Grained Role-Based Access Control (RBAC)
Every application, service, and announcement in the portal is governed by a strict, multi-tiered permission engine:

| Access Tier | Description | Typical Use Cases |
| :--- | :--- | :--- |
| **`Public`** | Unrestricted access without requiring login | Campus maps, public schedules, general documentation |
| **`All Roles`** | Accessible to any authenticated account | General internal communication, common student/faculty tools |
| **`Student`** | Restricted to enrolled students | Course materials, project submission portals, student dashboards |
| **`Lecturer`** | Restricted to academic staff & instructors | Grading sheets, teaching utilities, lab booking systems |
| **`Intern`** | Restricted to designated interns & assistants | Operational tools, lab management tasks, triage forms |
| **`Administrator`** | Unrestricted system-wide access | Infrastructure management, user permissions, audit logs |

#### 🔄 Instant Active Role Switching
Users assigned multiple roles (such as a *Lecturer* who also serves as an *Administrator*) can switch their current perspective instantly with a single click. The launcher dynamically re-evaluates visibility rules, access tokens, and interface widgets on the fly.

---

### 3. ⭐ Personalization & Favorites
- **One-Click Pinning**: Users can mark critical applications as favorites using the star toggle.
- **Priority Drawer**: Pinned applications are elevated to a dedicated quick-access section at the top of the launcher.
- **Persistent User State**: Favorites persist across browser sessions and devices, synchronized directly with the database.

---

### 4. 📢 Targeted System Announcements
- **Audience Filtering**: Broadcast notices targeted exclusively to specific audiences (e.g., maintenance alerts for Administrators, deadlines for Students, or lab updates for Interns).
- **Severity-Coded Alerts**: Distinct visual styles for `Info`, `Warning`, and `Critical` bulletins.
- **Scheduled Windows**: Announcements can be scheduled with precise start and end times to automatically activate and expire.

---

### 5. 🛠️ Administrative Suite & System Governance

```
┌─────────────────────────────────────────────────────────────────┐
│                    GAT Admin Operations Console                 │
├─────────────────┬───────────────────┬───────────────────────────┤
│  App Management │ Health Monitoring │  Audit & Telemetry        │
│  - Create / Edit│ - Real-time Pings │  - Immutable Action Logs  │
│  - Reorder Apps │ - Latency Metrics │  - Non-blocking Usage Logs│
│  - Role Binding │ - Uptime Status   │  - 30-Day Auto Retention  │
└─────────────────┴───────────────────┴───────────────────────────┘
```

- **Application Catalog Management**: Full CRUD interface for adding, editing, reordering, and deprecating catalog entries without touching code or database tables.
- **System Health Monitor**:
  - Automated ping worker that actively monitors target services.
  - Instant status indicators: `Healthy` (2xx), `Degraded` (slow response/redirects), `Down` (5xx/unreachable), or `Unsupported`.
  - Latency tracking measured in milliseconds for performance oversight.
- **Audit Logging**:
  - Comprehensive immutable log recording every administrative modification (creation, updates, permission reassignments, deletions).
  - Stores actor identity, action type, target entity, and structured payload diffs.
- **Usage Telemetry**:
  - Non-blocking background telemetry (`navigator.sendBeacon`) tracks application launch frequency.
  - Delivers insights into which applications drive the highest user engagement.
- **Maintenance & Retention**: Automated cleanup workers prune stale rate-limiting tokens, expired session caches, and historical logs older than 30 days.

---

## 🎨 User Interface & Design System

- **Clean Aesthetic**: Built with a modern, high-contrast palette supporting both dark and light modes.
- **Responsive Layout**: Seamlessly transitions between an expansive desktop view with collapsible sidebars and an optimized mobile touch interface.
- **Smooth Transitions**: Micro-interactions, animated states, and non-disruptive feedback powered by Sonner toast notifications.
- **Accessible & Scalable**: Strict semantic markup, accessible dialogs/sheets, and responsive font scaling with Inter and Outfit typefaces.

---

## 📋 Feature Summary Matrix

| Capability | Guest / Public | Student / Lecturer / Intern | Administrator |
| :--- | :---: | :---: | :---: |
| Browse Public Apps | ✅ | ✅ | ✅ |
| Access Role-Restricted Apps | ❌ | ✅ *(Role Dependent)* | ✅ *(All Apps)* |
| Personal Favorites | ❌ | ✅ | ✅ |
| Role Context Switcher | ❌ | ✅ *(If Multi-Role)* | ✅ |
| View System Announcements | ✅ *(Public only)* | ✅ *(Targeted)* | ✅ *(All)* |
| App Catalog CRUD | ❌ | ❌ | ✅ |
| System Health Monitoring | ❌ | ❌ | ✅ |
| View Audit & Telemetry Logs | ❌ | ❌ | ✅ |
| Configure System Settings | ❌ | ❌ | ✅ |

---

*GAT Portal &mdash; Streamlining access, empowering collaboration, and unifying the digital workspace.*
