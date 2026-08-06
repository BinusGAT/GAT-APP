"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowClockwise, CheckCircle, PencilSimple, Plus, Trash, Warning, XCircle } from "@phosphor-icons/react";
import {
  Announcement,
  deleteAnnouncement,
  getAnnouncements,
  getApplicationHealth,
  getAuditLogs,
  getUsageAnalytics,
  refreshAllApplicationHealth,
  refreshApplicationHealth,
  saveAnnouncement,
} from "@/lib/actions";

export type OperationsView = "audit" | "health" | "announcements" | "analytics";

type GenericRow = Record<string, string | number | null>;

export default function SettingsOperations({ view }: { view: OperationsView }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<GenericRow[]>([]);
  const [health, setHealth] = useState<GenericRow[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [analytics, setAnalytics] = useState<{ totalLaunches: number; uniqueUsers: number; topApps: Array<{ name: string; launches: number }> }>({ totalLaunches: 0, uniqueUsers: 0, topApps: [] });
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<Announcement["severity"]>("info");
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<number | undefined>();
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [auditFilter, setAuditFilter] = useState("");
  const [auditPage, setAuditPage] = useState(1);
  const [displayNow, setDisplayNow] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    setDisplayNow(Date.now());
    try {
      if (view === "audit") { setLogs(await getAuditLogs()); setAuditPage(1); }
      if (view === "health") setHealth(await getApplicationHealth());
      if (view === "announcements") setAnnouncements(await getAnnouncements());
      if (view === "analytics") setAnalytics(await getUsageAnalytics());
    } catch { setError("Unable to load this operational view."); }
    finally { setLoading(false); }
  }, [view]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const checkHealth = async (id: number) => {
    setCheckingId(id); setError("");
    const result = await refreshApplicationHealth(id);
    if (!result.success) setError(result.error || "Health check failed.");
    await load(); setCheckingId(null);
  };

  const createAnnouncement = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    const result = await saveAnnouncement({ id: editingAnnouncementId, title, message, severity, isActive: true,
      startsAt: startsAt ? new Date(startsAt).getTime() : null, endsAt: endsAt ? new Date(endsAt).getTime() : null });
    if (!result.success) { setError(result.error || "Unable to publish announcement."); return; }
    setTitle(""); setMessage(""); setSeverity("info"); setStartsAt(""); setEndsAt(""); setEditingAnnouncementId(undefined); setFormOpen(false); await load();
  };

  const localDateTimeValue = (timestamp: number | null) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  const editAnnouncement = (item: Announcement) => {
    setEditingAnnouncementId(item.id); setTitle(item.title); setMessage(item.message); setSeverity(item.severity);
    setStartsAt(localDateTimeValue(item.starts_at)); setEndsAt(localDateTimeValue(item.ends_at)); setFormOpen(true);
  };

  const checkAllHealth = async () => {
    setCheckingAll(true); setError("");
    const result = await refreshAllApplicationHealth();
    if (!result.success) setError(result.error || "Scheduled health check failed.");
    await load(); setCheckingAll(false);
  };

  const filteredLogs = useMemo(() => {
    const query = auditFilter.trim().toLowerCase();
    if (!query) return logs;
    return logs.filter((log) => [log.created_at, log.actor_email, log.action]
      .some((value) => String(value || "").toLowerCase().includes(query)));
  }, [auditFilter, logs]);
  const auditPageCount = Math.max(1, Math.ceil(filteredLogs.length / 10));
  const currentAuditPage = Math.min(auditPage, auditPageCount);
  const visibleLogs = filteredLogs.slice((currentAuditPage - 1) * 10, currentAuditPage * 10);

  if (loading) return <div className="ops-empty">Loading operational data…</div>;

  return (
    <section className="ops-panel">
      {error && <div className="ops-error">{error}</div>}

      {view === "audit" && <>
        <div className="ops-heading"><div><h2>Audit log</h2><p>Security and administrative activity across the portal.</p></div><button className="btn-secondary" onClick={() => void load()}><ArrowClockwise size={15} />Refresh</button></div>
        <div className="ops-filter-bar"><input className="form-input" type="search" value={auditFilter} onChange={(event) => { setAuditFilter(event.target.value); setAuditPage(1); }} placeholder="Filter by time, actor, or action…" aria-label="Filter audit logs"/><span>{filteredLogs.length} {filteredLogs.length === 1 ? "event" : "events"}</span></div>
        <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th></tr></thead><tbody>
          {visibleLogs.map((log) => <tr key={String(log.id)}><td>{String(log.created_at)}</td><td>{String(log.actor_email || "System")}</td><td><code>{String(log.action)}</code></td></tr>)}
        </tbody></table>{visibleLogs.length === 0 && <div className="ops-empty">No audit events match this filter.</div>}</div>
        <div className="ops-pagination"><span>Page {currentAuditPage} of {auditPageCount} · 10 logs per page</span><div><button className="btn-secondary" disabled={currentAuditPage === 1} onClick={() => setAuditPage((page) => Math.max(1, page - 1))}>Previous</button><button className="btn-secondary" disabled={currentAuditPage === auditPageCount} onClick={() => setAuditPage((page) => Math.min(auditPageCount, page + 1))}>Next</button></div></div>
      </>}

      {view === "health" && <>
        <div className="ops-heading"><div><h2>Application health</h2><p>Scheduled endpoint: <code>/api/cron/health</code>. Configure an hourly bearer-authenticated request.</p></div><button className="btn-primary" disabled={checkingAll} onClick={() => void checkAllHealth()}><ArrowClockwise size={15}/>{checkingAll ? "Checking all…" : "Run all now"}</button></div>
        <div className="ops-list">{health.map((app) => {
          const status = String(app.status); const Icon = status === "healthy" ? CheckCircle : status === "down" ? XCircle : Warning;
          return <div className="ops-list-row" key={String(app.id)}><Icon size={21} weight="fill" className={`health-${status}`} /><div className="ops-grow"><strong>{String(app.button_name)}</strong><span>{String(app.message || "Not checked yet")}</span></div><div className="ops-health-meta"><span>{app.latency_ms == null ? "—" : `${app.latency_ms} ms`}</span><span className={`health-badge ${status}`}>{status}</span></div><button className="btn-secondary" disabled={checkingId === Number(app.id)} onClick={() => void checkHealth(Number(app.id))}>{checkingId === Number(app.id) ? "Checking…" : "Check"}</button></div>;
        })}</div>
      </>}

      {view === "announcements" && <>
        <div className="ops-heading"><div><h2>Announcements</h2><p>Publish immediately or schedule a start and end time.</p></div><button className="btn-primary" onClick={() => { setEditingAnnouncementId(undefined); setTitle(""); setMessage(""); setStartsAt(""); setEndsAt(""); setFormOpen(!formOpen); }}><Plus size={15} />New announcement</button></div>
        {formOpen && <form className="ops-form" onSubmit={createAnnouncement}><input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Announcement title" required maxLength={160}/><textarea className="form-input" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message" required maxLength={2000}/><div className="ops-schedule-fields"><label>Starts at <input className="form-input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}/></label><label>Ends at <input className="form-input" type="datetime-local" value={endsAt} min={startsAt} onChange={(e) => setEndsAt(e.target.value)}/></label></div><div className="ops-form-actions"><select className="form-input" value={severity} onChange={(e) => setSeverity(e.target.value as Announcement["severity"])}><option value="info">Information</option><option value="warning">Warning</option><option value="critical">Critical</option></select><button className="btn-primary" type="submit">{editingAnnouncementId ? "Save changes" : startsAt ? "Schedule" : "Publish"}</button></div></form>}
        <div className="ops-list">{announcements.map((item) => { const schedule = item.starts_at && item.starts_at > displayNow ? `Scheduled ${new Date(item.starts_at).toLocaleString()}` : item.ends_at && item.ends_at < displayNow ? "Expired" : item.ends_at ? `Active until ${new Date(item.ends_at).toLocaleString()}` : "Active"; return <div className="ops-list-row" key={item.id}><div className="ops-grow"><div><span className={`health-badge ${item.severity}`}>{item.severity}</span> <strong>{item.title}</strong></div><span>{item.message}</span><span>{schedule}</span></div><button className="ops-icon-btn" title="Edit announcement" onClick={() => editAnnouncement(item)}><PencilSimple size={17}/></button><button className="ops-icon-btn" title="Delete announcement" onClick={async () => { await deleteAnnouncement(item.id); await load(); }}><Trash size={17}/></button></div>; })}{announcements.length === 0 && <div className="ops-empty">No announcements have been published.</div>}</div>
      </>}

      {view === "analytics" && <>
        <div className="ops-heading"><div><h2>Usage analytics</h2><p>Application launches during the last 30 days.</p></div><button className="btn-secondary" onClick={() => void load()}><ArrowClockwise size={15}/>Refresh</button></div>
        <div className="ops-metrics"><div><span>Total launches</span><strong>{analytics.totalLaunches}</strong></div><div><span>Active users</span><strong>{analytics.uniqueUsers}</strong></div><div><span>Tracked apps</span><strong>{analytics.topApps.length}</strong></div></div>
        <div className="ops-ranking"><h3>Most used applications</h3>{analytics.topApps.map((app, index) => { const max = analytics.topApps[0]?.launches || 1; return <div className="ops-rank-row" key={app.name}><span>{index + 1}</span><strong>{app.name}</strong><div><i style={{ width: `${Math.max(4, app.launches / max * 100)}%` }}/></div><b>{app.launches}</b></div>; })}{analytics.topApps.length === 0 && <div className="ops-empty">Usage will appear after users open applications.</div>}</div>
      </>}
    </section>
  );
}
