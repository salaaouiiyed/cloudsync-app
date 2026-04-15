import React, { useState, useEffect, useRef, useCallback } from 'react';
import Keycloak from 'keycloak-js';
import axios from 'axios';
import './App.css';

// ─── CONFIG RUNTIME — AKS UNIQUEMENT ─────────────────────────────────────────
// window._env_ est généré par env.sh AU DÉMARRAGE du container nginx
// Les valeurs viennent du ConfigMap Kubernetes (frontend-configmap.yaml)
// Chargé depuis public/env-config.js AVANT ce bundle (voir public/index.html)
//
// Si window._env_ est vide → le ConfigMap est manquant → erreur explicite
const _env = (typeof window !== 'undefined' && window._env_) || {};

if (!_env.REACT_APP_KEYCLOAK_URL) {
  console.error('[CloudSync] REACT_APP_KEYCLOAK_URL manquant dans window._env_. Vérifiez le ConfigMap Kubernetes et que env.sh s\'est exécuté.');
}

const keycloakConfig = {
  url:      _env.REACT_APP_KEYCLOAK_URL,
  realm:    _env.REACT_APP_KEYCLOAK_REALM     || 'cloudsync-realm',
  clientId: _env.REACT_APP_KEYCLOAK_CLIENT_ID || 'cloudsync-app',
};

// API_URL vide = chemin relatif → nginx proxy /api/ → backend (service K8s interne)
const API_BASE_URL = _env.REACT_APP_API_URL || '';

// ─── API HELPER ───────────────────────────────────────────────────────────────
// BUG FIX: Always refreshes token before creating axios instance.
// Keycloak.token can become stale — updateToken(30) ensures it's valid for ≥30s.
let _kc = null;
const getToken = async () => {
  if (!_kc) return null;
  try { await _kc.updateToken(30); } catch (e) { _kc.login(); }
  return _kc.token;
};
const api = async () => {
  const token = await getToken();
  const instance = axios.create({
    baseURL: API_BASE_URL,
    headers: { Authorization: `Bearer ${token}` },
  });
  // Global response error interceptor: surface API error messages clearly
  instance.interceptors.response.use(
    res => res,
    err => {
      const msg = err.response?.data?.error || err.message || 'An unexpected error occurred';
      return Promise.reject({ ...err, displayMessage: msg });
    }
  );
  return instance;
};

// Centralised error toast — avoids scattered alert() calls
function showError(err) {
  const msg = err.displayMessage || err.response?.data?.error || err.message || 'An unexpected error occurred';
  alert(msg);
}

// ─── UI COMPONENTS ────────────────────────────────────────────────────────────
const PlanBadge = ({ plan }) => {
  const cls = { Starter: 'plan-starter', Business: 'plan-business', Enterprise: 'plan-enterprise' };
  return <span className={`badge ${cls[plan] || 'badge-default'}`}>{plan || '—'}</span>;
};

const StatusBadge = ({ status }) => {
  const cls = {
    Active: 'status-active', Trial: 'status-trial', Suspended: 'status-suspended',
    'On Hold': 'status-onhold', Completed: 'status-completed', Invited: 'status-invited',
    High: 'priority-high', Medium: 'priority-medium', Low: 'priority-low',
  };
  return <span className={`badge ${cls[status] || 'badge-default'}`}>{status}</span>;
};

const Modal = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
};

const StatCard = ({ label, value, icon, accent }) => (
  <div className={`stat-card accent-${accent}`}>
    <div className="stat-icon">{icon}</div>
    <div className="stat-body">
      <p className="stat-value">{value}</p>
      <p className="stat-label">{label}</p>
    </div>
  </div>
);

const ProgressBar = ({ value, max, color }) => {
  const pct = max > 0 ? Math.min(Math.round((value / max) * 100), 100) : 0;
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
};

const Shimmer = () => (
  <div className="loading-shimmer"><div /><div /><div /></div>
);

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
const DashboardPage = ({ projects, tenantProfile }) => {
  const s = {
    total: projects.length,
    active: projects.filter(p => p.status === 'Active').length,
    onHold: projects.filter(p => p.status === 'On Hold').length,
    completed: projects.filter(p => p.status === 'Completed').length,
    high: projects.filter(p => p.priority === 'High').length,
  };

  return (
    <div className="page">
      {tenantProfile && (
        <div className="tenant-hero">
          <div className="tenant-hero-left">
            <div className="tenant-avatar" style={{ background: tenantProfile.primaryColor || '#3b82f6' }}>
              {tenantProfile.name?.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="tenant-hero-name">{tenantProfile.name}</h2>
              <div className="tenant-hero-meta">
                <PlanBadge plan={tenantProfile.plan} />
                <StatusBadge status={tenantProfile.status} />
                {tenantProfile.industry && <span className="tenant-industry">{tenantProfile.industry}</span>}
              </div>
            </div>
          </div>
          <div className="tenant-hero-limits">
            <div className="limit-item">
              <span className="limit-label">Projects</span>
              <span className="limit-count">{s.total}/{tenantProfile.maxProjects}</span>
              <ProgressBar value={s.total} max={tenantProfile.maxProjects} color={tenantProfile.primaryColor || '#3b82f6'} />
            </div>
            <div className="limit-item">
              <span className="limit-label">Members</span>
              <span className="limit-count">{tenantProfile.memberCount || 0}/{tenantProfile.maxUsers}</span>
              <ProgressBar value={tenantProfile.memberCount || 0} max={tenantProfile.maxUsers} color="#8b5cf6" />
            </div>
          </div>
        </div>
      )}

      <div className="stats-row">
        <StatCard label="Total Projects" value={s.total} accent="blue" icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>} />
        <StatCard label="Active" value={s.active} accent="green" icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>} />
        <StatCard label="On Hold" value={s.onHold} accent="amber" icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/></svg>} />
        <StatCard label="Completed" value={s.completed} accent="indigo" icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>} />
        <StatCard label="High Priority" value={s.high} accent="red" icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>} />
      </div>

      <div className="recent-card">
        <div className="card-header-row">
          <h3 className="card-title">Recent Activity</h3>
        </div>
        {projects.length === 0
          ? <div className="empty-inline">No projects yet — create your first one!</div>
          : (
            <div className="activity-list">
              {projects.slice(0, 6).map(p => (
                <div key={p._id} className="activity-row">
                  <div className={`activity-dot priority-dot-${p.priority?.toLowerCase()}`} />
                  <div className="activity-info">
                    <span className="activity-name">{p.name}</span>
                    {p.description && <span className="activity-desc">{p.description}</span>}
                  </div>
                  <div className="activity-right">
                    <StatusBadge status={p.status} />
                    <span className="activity-date">{new Date(p.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
};

// ─── PROJECTS ─────────────────────────────────────────────────────────────────
const ProjectsPage = ({ projects, isAdmin, onDelete, onAdd, onUpdate }) => {
  const [search, setSearch] = useState('');
  const [filterP, setFilterP] = useState('All');
  const [filterS, setFilterS] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [editProject, setEditProject] = useState(null);
  const emptyForm = { name: '', description: '', priority: 'Medium', status: 'Active', progress: 0, assignee: '' };
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const filtered = projects.filter(p => {
    if (filterP !== 'All' && p.priority !== filterP) return false;
    if (filterS !== 'All' && p.status !== filterS) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) &&
        !p.description?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const openEdit = p => { setEditProject(p); setForm({ name: p.name, description: p.description || '', priority: p.priority, status: p.status, progress: p.progress || 0, assignee: p.assignee || '' }); setShowModal(true); };
  const openCreate = () => { setEditProject(null); setForm(emptyForm); setShowModal(true); };

  const handleSubmit = async e => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editProject) await onUpdate(editProject._id, form);
      else await onAdd(form);
      setShowModal(false);
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-toolbar">
        <div className="search-box">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input placeholder="Search projects..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="filter-row">
          <select value={filterP} onChange={e => setFilterP(e.target.value)} className="select-sm">
            <option value="All">All Priorities</option>
            <option>Low</option><option>Medium</option><option>High</option>
          </select>
          <select value={filterS} onChange={e => setFilterS(e.target.value)} className="select-sm">
            <option value="All">All Status</option>
            <option>Active</option><option value="On Hold">On Hold</option><option>Completed</option>
          </select>
          {isAdmin && <button className="btn-primary" onClick={openCreate}>+ New Project</button>}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/></svg>
          <p>No projects match your filters.</p>
        </div>
      ) : (
        <div className="projects-grid">
          {filtered.map(p => (
            <div key={p._id} className="project-card">
              <div className="project-card-header">
                <div className={`project-priority-stripe priority-stripe-${p.priority?.toLowerCase()}`} />
                <div className="project-card-top">
                  <h4 className="project-name">{p.name}</h4>
                  <div className="project-badges">
                    <StatusBadge status={p.priority} />
                    <StatusBadge status={p.status} />
                  </div>
                </div>
              </div>
              <p className="project-desc">{p.description || 'No description provided.'}</p>
              {typeof p.progress === 'number' && (
                <div className="project-progress">
                  <div className="progress-label-row"><span>Progress</span><span>{p.progress}%</span></div>
                  <ProgressBar value={p.progress} max={100} color="#3b82f6" />
                </div>
              )}
              <div className="project-card-footer">
                <div className="project-meta">
                  {p.assignee && <span className="assignee-chip">{p.assignee}</span>}
                  <span className="project-date">{new Date(p.createdAt).toLocaleDateString()}</span>
                </div>
                {isAdmin && (
                  <div className="project-actions">
                    <button className="btn-icon btn-edit" onClick={() => openEdit(p)} title="Edit">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button className="btn-icon btn-delete" onClick={() => onDelete(p._id)} title="Delete">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editProject ? 'Edit Project' : 'New Project'}>
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label>Project Name *</label>
            <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Enter project name" />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Describe the project..." />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Priority</label>
              <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                <option>Low</option><option>Medium</option><option>High</option>
              </select>
            </div>
            <div className="form-group">
              <label>Status</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                <option>Active</option><option value="On Hold">On Hold</option><option>Completed</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Assignee</label>
              <input value={form.assignee} onChange={e => setForm({ ...form, assignee: e.target.value })} placeholder="@username" />
            </div>
            <div className="form-group">
              <label>Progress ({form.progress}%)</label>
              <input type="range" min={0} max={100} value={form.progress} onChange={e => setForm({ ...form, progress: Number(e.target.value) })} />
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Saving…' : editProject ? 'Save Changes' : 'Create Project'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

// ─── MEMBERS ──────────────────────────────────────────────────────────────────
const MembersPage = ({ isAdmin }) => {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ username: '', email: '', role: 'member' });

  const fetchMembers = useCallback(async () => {
    try {
      const a = await api();
      const res = await a.get('/api/members');
      setMembers(res.data);
    } catch (e) { console.error('fetchMembers', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const invite = async e => {
    e.preventDefault();
    try {
      const a = await api();
      await a.post('/api/members', form);
      setShowModal(false);
      setForm({ username: '', email: '', role: 'member' });
      fetchMembers();
    } catch (err) { showError(err); }
  };

  const remove = async id => {
    if (!window.confirm('Remove this member?')) return;
    const a = await api();
    await a.delete(`/api/members/${id}`);
    fetchMembers();
  };

  const roleColor = { admin: 'badge-admin', member: 'badge-member', viewer: 'badge-viewer' };

  return (
    <div className="page">
      <div className="page-toolbar">
        <h2 className="section-title">Team Members</h2>
        {isAdmin && <button className="btn-primary" onClick={() => setShowModal(true)}>+ Invite Member</button>}
      </div>
      {loading ? <Shimmer /> : members.length === 0 ? (
        <div className="empty-state">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
          <p>No members yet. Invite your team!</p>
        </div>
      ) : (
        <div className="members-table-wrap">
          <table className="members-table">
            <thead><tr><th>Member</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th>{isAdmin && <th>Actions</th>}</tr></thead>
            <tbody>
              {members.map(m => (
                <tr key={m._id}>
                  <td><div className="member-cell"><div className="member-avatar">{m.username?.charAt(0).toUpperCase()}</div><span className="member-username">{m.username}</span></div></td>
                  <td className="member-email">{m.email}</td>
                  <td><span className={`badge ${roleColor[m.role] || 'badge-default'}`}>{m.role}</span></td>
                  <td><StatusBadge status={m.status} /></td>
                  <td className="member-date">{new Date(m.joinedAt).toLocaleDateString()}</td>
                  {isAdmin && <td><button className="btn-icon btn-delete" onClick={() => remove(m._id)} title="Remove"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Invite Team Member">
        <form onSubmit={invite} className="modal-form">
          <div className="form-group"><label>Username *</label><input required value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="john.doe" /></div>
          <div className="form-group"><label>Email *</label><input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="john@company.com" /></div>
          <div className="form-group"><label>Role</label><select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}><option value="viewer">Viewer</option><option value="member">Member</option><option value="admin">Admin</option></select></div>
          <div className="form-actions"><button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Cancel</button><button type="submit" className="btn-primary">Send Invite</button></div>
        </form>
      </Modal>
    </div>
  );
};

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
const SettingsPage = ({ tenantProfile, onProfileUpdate }) => {
  const [form, setForm] = useState({
    name: tenantProfile?.name || '',
    industry: tenantProfile?.industry || 'Technology',
    contactEmail: tenantProfile?.contactEmail || '',
    primaryColor: tenantProfile?.primaryColor || '#3b82f6',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async e => {
    e.preventDefault();
    setSaving(true);
    try {
      const a = await api();
      const res = await a.patch('/api/tenant/profile', form);
      onProfileUpdate(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) { showError(err); }
    finally { setSaving(false); }
  };

  return (
    <div className="page">
      <div className="settings-layout">
        <div className="settings-card">
          <h3 className="card-title">Workspace Settings</h3>
          <form onSubmit={save} className="modal-form">
            <div className="form-group"><label>Workspace Name</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="form-row">
              <div className="form-group">
                <label>Industry</label>
                <select value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })}>
                  {['Technology','Finance','Healthcare','Education','Retail','Manufacturing','Media','Other'].map(i => <option key={i}>{i}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Brand Color</label>
                <div className="color-picker-row">
                  <input type="color" value={form.primaryColor} onChange={e => setForm({ ...form, primaryColor: e.target.value })} className="color-input" />
                  <span className="color-hex">{form.primaryColor}</span>
                </div>
              </div>
            </div>
            <div className="form-group"><label>Contact Email</label><input type="email" value={form.contactEmail} onChange={e => setForm({ ...form, contactEmail: e.target.value })} /></div>
            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Settings'}</button>
            </div>
          </form>
        </div>
        <div className="settings-card plan-card">
          <h3 className="card-title">Current Plan</h3>
          <div className="plan-display">
            <PlanBadge plan={tenantProfile?.plan || 'Starter'} />
            <div className="plan-limits">
              <div className="plan-limit-row"><span>Projects</span><span>{tenantProfile?.projectCount || 0} / {tenantProfile?.maxProjects || 10}</span></div>
              <ProgressBar value={tenantProfile?.projectCount || 0} max={tenantProfile?.maxProjects || 10} color="#3b82f6" />
              <div className="plan-limit-row mt-2"><span>Members</span><span>{tenantProfile?.memberCount || 0} / {tenantProfile?.maxUsers || 5}</span></div>
              <ProgressBar value={tenantProfile?.memberCount || 0} max={tenantProfile?.maxUsers || 5} color="#8b5cf6" />
            </div>
            <div className="upgrade-cta">
              <span className="upgrade-text">Need more capacity?</span>
              <button className="btn-upgrade">Upgrade Plan</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────
const AuditPage = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const a = await api();
        const res = await a.get('/api/audit-logs?limit=50');
        setLogs(res.data);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  const colors = {
    PROJECT_CREATED: '#10b981', PROJECT_DELETED: '#ef4444', PROJECT_UPDATED: '#3b82f6',
    MEMBER_INVITED: '#8b5cf6', MEMBER_REMOVED: '#f59e0b', MEMBER_UPDATED: '#6366f1',
    PROFILE_UPDATED: '#0ea5e9', TENANT_CREATED: '#10b981', TENANT_UPDATED: '#3b82f6',
  };

  return (
    <div className="page">
      <h2 className="section-title">Audit Log</h2>
      {loading ? <Shimmer /> : logs.length === 0 ? (
        <div className="empty-state"><p>No activity recorded yet.</p></div>
      ) : (
        <div className="audit-list">
          {logs.map(l => (
            <div key={l._id} className="audit-row">
              <div className="audit-dot" style={{ background: colors[l.action] || '#94a3b8' }} />
              <div className="audit-content">
                <span className="audit-action" style={{ color: colors[l.action] || '#64748b' }}>{l.action}</span>
                {l.entity && <span className="audit-entity"> · {l.entity}</span>}
                {l.actor && <span className="audit-actor"> by {l.actor}</span>}
              </div>
              <span className="audit-time">{new Date(l.timestamp).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};


// ─── TENANT SWITCHER (Super Admin) ────────────────────────────────────────────
// Allows a super_admin to impersonate any tenant context for viewing.
const TenantSwitcher = ({ tenants, selectedTenantId, onSelect }) => {
  const [open, setOpen] = useState(false);
  const selected = tenants.find(t => t.tenantId === selectedTenantId);
  return (
    <div className="tenant-switcher" style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="btn-ghost"
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
        {selected ? selected.name : 'All Tenants'}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: '110%', left: 0, zIndex: 100, background: 'var(--surface, #1e2535)',
            border: '1px solid var(--border, #2d3748)', borderRadius: 8, minWidth: 220,
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)', maxHeight: 300, overflowY: 'auto',
          }}
          onMouseLeave={() => setOpen(false)}
        >
          <div
            className="switcher-item"
            style={{ padding: '8px 14px', cursor: 'pointer', opacity: !selectedTenantId ? 1 : 0.6 }}
            onClick={() => { onSelect(null); setOpen(false); }}
          >
            <span style={{ fontWeight: !selectedTenantId ? 700 : 400 }}>All Tenants</span>
          </div>
          {tenants.map(t => (
            <div
              key={t.tenantId}
              className="switcher-item"
              style={{
                padding: '8px 14px', cursor: 'pointer',
                background: selectedTenantId === t.tenantId ? 'var(--primary-alpha, rgba(59,130,246,0.15))' : 'transparent',
              }}
              onClick={() => { onSelect(t.tenantId); setOpen(false); }}
            >
              <div style={{ fontWeight: 500, fontSize: 13 }}>{t.name}</div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>{t.tenantId}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── SUPER ADMIN ──────────────────────────────────────────────────────────────
const SuperAdminPage = () => {
  const [tenants, setTenants] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTenant, setEditTenant] = useState(null);
  const [viewingTenantId, setViewingTenantId] = useState(null); // null = all
  const emptyForm = { tenantId: '', name: '', plan: 'Starter', status: 'Trial', industry: 'Technology', maxProjects: 10, maxUsers: 5, contactEmail: '' };
  const [form, setForm] = useState(emptyForm);

  const fetchAll = useCallback(async () => {
    try {
      const a = await api();
      const [t, an] = await Promise.all([a.get('/api/admin/tenants'), a.get('/api/admin/analytics')]);
      setTenants(t.data);
      setAnalytics(an.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openCreate = () => { setEditTenant(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = t => { setEditTenant(t); setForm({ tenantId: t.tenantId, name: t.name, plan: t.plan, status: t.status, industry: t.industry || 'Technology', maxProjects: t.maxProjects, maxUsers: t.maxUsers, contactEmail: t.contactEmail || '' }); setShowModal(true); };

  const handleSubmit = async e => {
    e.preventDefault();
    try {
      const a = await api();
      if (editTenant) await a.patch(`/api/admin/tenants/${editTenant.tenantId}`, form);
      else await a.post('/api/admin/tenants', form);
      setShowModal(false);
      fetchAll();
    } catch (err) { showError(err); }
  };

  const deleteTenant = async (id, name) => {
    const confirmed = window.confirm(
      `⚠️ PERMANENT DELETION\n\nThis will irreversibly delete tenant "${name}" (${id}) and ALL associated projects, members, and audit logs.\n\nType OK to confirm.`
    );
    if (!confirmed) return;
    try {
      const a = await api();
      await a.delete(`/api/admin/tenants/${id}`, { data: { confirm: id } });
      fetchAll();
    } catch (err) { showError(err); }
  };

  return (
    <div className="page">
      <div className="super-admin-header">
        <div className="super-admin-badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Super Admin Console
        </div>
        <h2 className="section-title" style={{ marginTop: 8 }}>Tenant Management</h2>
      </div>

      {analytics && (
        <div className="admin-stats-row">
          <StatCard label="Total Tenants" value={analytics.totals.tenants} accent="blue" icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>} />
          <StatCard label="Total Projects" value={analytics.totals.projects} accent="green" icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>} />
          <StatCard label="Total Members" value={analytics.totals.members} accent="indigo" icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>} />
          {analytics.planDistribution?.map(p => (
            <StatCard key={p._id} label={`${p._id} Plan`} value={p.count} accent="amber" icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>} />
          ))}
        </div>
      )}

      <div className="toolbar-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="tenant-count">{tenants.length} tenant{tenants.length !== 1 ? 's' : ''}</span>
          <TenantSwitcher
            tenants={tenants}
            selectedTenantId={viewingTenantId}
            onSelect={setViewingTenantId}
          />
        </div>
        <button className="btn-primary" onClick={openCreate}>+ New Tenant</button>
      </div>

      {loading ? <Shimmer /> : (
        <div className="tenants-grid">
          {(viewingTenantId ? tenants.filter(t => t.tenantId === viewingTenantId) : tenants).map(t => (
            <div key={t.tenantId} className="tenant-card">
              <div className="tenant-card-header">
                <div className="tenant-card-avatar" style={{ background: t.primaryColor || '#3b82f6' }}>{t.name?.charAt(0).toUpperCase()}</div>
                <div className="tenant-card-info">
                  <h4 className="tenant-card-name">{t.name}</h4>
                  <code className="tenant-id-code">{t.tenantId}</code>
                </div>
                <div className="tenant-card-actions">
                  <button className="btn-icon btn-edit" onClick={() => openEdit(t)} title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                  <button className="btn-icon btn-delete" onClick={() => deleteTenant(t.tenantId, t.name)} title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
                </div>
              </div>
              <div className="tenant-card-badges"><PlanBadge plan={t.plan} /><StatusBadge status={t.status} />{t.industry && <span className="badge badge-industry">{t.industry}</span>}</div>
              <div className="tenant-card-stats">
                <div className="tc-stat"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg><span>{t.projectCount} / {t.maxProjects} projects</span></div>
                <div className="tc-stat"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><span>{t.memberCount} / {t.maxUsers} members</span></div>
              </div>
              <div className="tc-progress"><ProgressBar value={t.projectCount} max={t.maxProjects} color={t.primaryColor || '#3b82f6'} /></div>
              {t.contactEmail && <p className="tc-email">{t.contactEmail}</p>}
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editTenant ? 'Edit Tenant' : 'Create Tenant'}>
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-row">
            <div className="form-group"><label>Tenant ID *</label><input required value={form.tenantId} onChange={e => setForm({ ...form, tenantId: e.target.value })} placeholder="acme-corp" disabled={!!editTenant} /></div>
            <div className="form-group"><label>Workspace Name *</label><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Acme Corp" /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Plan</label><select value={form.plan} onChange={e => setForm({ ...form, plan: e.target.value })}><option>Starter</option><option>Business</option><option>Enterprise</option></select></div>
            <div className="form-group"><label>Status</label><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}><option>Trial</option><option>Active</option><option>Suspended</option></select></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Industry</label><select value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })}>{['Technology','Finance','Healthcare','Education','Retail','Manufacturing','Media','Other'].map(i => <option key={i}>{i}</option>)}</select></div>
            <div className="form-group"><label>Contact Email</label><input type="email" value={form.contactEmail} onChange={e => setForm({ ...form, contactEmail: e.target.value })} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Max Projects</label><input type="number" min={1} value={form.maxProjects} onChange={e => setForm({ ...form, maxProjects: Number(e.target.value) })} /></div>
            <div className="form-group"><label>Max Users</label><input type="number" min={1} value={form.maxUsers} onChange={e => setForm({ ...form, maxUsers: Number(e.target.value) })} /></div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
            <button type="submit" className="btn-primary">{editTenant ? 'Save Changes' : 'Create Tenant'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

// =============================================================================
// ROOT APP
// =============================================================================
const App = () => {
  const [keycloak, setKeycloak] = useState(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [projects, setProjects] = useState([]);
  const [tenantProfile, setTenantProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [error, setError] = useState(null);
  const isInitialized = useRef(false);

  // BUG FIX: use the shared `api()` helper that always refreshes the token
  const fetchProjects = useCallback(async () => {
    try {
      const a = await api();
      const res = await a.get('/api/projects');
      setProjects(res.data);
    } catch (e) { console.error('fetchProjects', e); }
  }, []);

  const fetchTenantProfile = useCallback(async () => {
    try {
      const a = await api();
      const res = await a.get('/api/tenant/profile');
      setTenantProfile(res.data);
    } catch (e) { console.error('fetchTenantProfile', e); }
  }, []);

  useEffect(() => {
    if (isInitialized.current) return;
    isInitialized.current = true;

    const kc = new Keycloak(keycloakConfig);
    kc.init({ onLoad: 'login-required', checkLoginIframe: false, pkceMethod: 'S256' })
      .then(auth => {
        _kc = kc; // make available to api() helper
        setKeycloak(kc);
        setAuthenticated(auth);
        if (auth) {
          const admin      = kc.hasRealmRole('admin');
          const superAdmin = kc.hasRealmRole('super_admin');
          setIsAdmin(admin || superAdmin);
          setIsSuperAdmin(superAdmin);

          Promise.all([fetchProjects(), fetchTenantProfile()])
            .finally(() => setLoading(false));

          // Proactive token refresh every 55s
          const iv = setInterval(async () => {
            try {
              const refreshed = await kc.updateToken(70);
              if (refreshed) { fetchProjects(); fetchTenantProfile(); }
            } catch (e) { kc.login(); }
          }, 55_000);
          return () => clearInterval(iv);
        } else {
          setLoading(false);
        }
      })
      .catch(err => {
        console.error('Keycloak init error:', err);
        setError('Authentication service unavailable. Make sure Keycloak is running on port 8080.');
        setLoading(false);
      });
  }, [fetchProjects, fetchTenantProfile]);

  const addProject = async form => {
    const a = await api();
    await a.post('/api/projects', form);
    await Promise.all([fetchProjects(), fetchTenantProfile()]);
  };
  const updateProject = async (id, form) => {
    const a = await api();
    await a.patch(`/api/projects/${id}`, form);
    await fetchProjects();
  };
  const deleteProject = async id => {
    if (!window.confirm('Delete this project?')) return;
    const a = await api();
    await a.delete(`/api/projects/${id}`);
    await Promise.all([fetchProjects(), fetchTenantProfile()]);
  };

  if (loading) return (
    <div className="splash">
      <div className="splash-logo"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg></div>
      <h1 className="splash-title">CloudSync <span>Pro</span></h1>
      <p className="splash-sub">Loading enterprise workspace…</p>
      <div className="splash-spinner" />
    </div>
  );

  if (error && !authenticated) return (
    <div className="error-screen">
      <div className="error-card">
        <h2>System Unavailable</h2>
        <p>{error}</p>
        <button onClick={() => window.location.reload()} className="btn-primary">Retry</button>
      </div>
    </div>
  );

  const nav = [
    { id: 'dashboard',   label: 'Dashboard',     icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> },
    { id: 'projects',    label: 'Projects',       icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> },
    { id: 'members',     label: 'Members',        show: isAdmin, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg> },
    { id: 'audit',       label: 'Audit Log',      show: isAdmin, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> },
    { id: 'settings',    label: 'Settings',       show: isAdmin, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg> },
    { id: 'super-admin', label: 'Admin Console',  show: isSuperAdmin, badge: 'super', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> },
  ];

  const pageLabels = { dashboard: 'Dashboard', projects: 'Projects', members: 'Team Members', audit: 'Audit Log', settings: 'Settings', 'super-admin': 'Admin Console' };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
        <div className="sidebar-brand">
          <div className="brand-logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
          </div>
          {sidebarOpen && <div className="brand-text"><span className="brand-name">CloudSync</span><span className="brand-pro">Pro</span></div>}
          <button className="sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {sidebarOpen ? <path d="M15 19l-7-7 7-7"/> : <path d="M9 18l6-6-6-6"/>}
            </svg>
          </button>
        </div>

        {sidebarOpen && tenantProfile && (
          <div className="sidebar-tenant">
            <div className="sidebar-tenant-dot" style={{ background: tenantProfile.primaryColor || '#3b82f6' }} />
            <div className="sidebar-tenant-info">
              <p className="sidebar-tenant-name">{tenantProfile.name}</p>
              <PlanBadge plan={tenantProfile.plan} />
            </div>
          </div>
        )}

        <nav className="sidebar-nav">
          {nav.filter(n => n.show !== false).map(n => (
            <button key={n.id} className={`nav-item ${activeTab === n.id ? 'nav-active' : ''} ${n.badge === 'super' ? 'nav-super' : ''}`} onClick={() => setActiveTab(n.id)} title={!sidebarOpen ? n.label : ''}>
              {n.icon}
              {sidebarOpen && <span className="nav-label">{n.label}</span>}
              {sidebarOpen && n.badge === 'super' && <span className="nav-badge">SA</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-user">
          <div className="user-avatar-sm">{keycloak?.tokenParsed?.preferred_username?.charAt(0).toUpperCase()}</div>
          {sidebarOpen && (
            <div className="user-details">
              <p className="user-name">{keycloak?.tokenParsed?.preferred_username}</p>
              <p className="user-role-label">{isSuperAdmin ? 'Super Admin' : isAdmin ? 'Admin' : 'Viewer'}</p>
            </div>
          )}
          <button className="logout-btn" onClick={() => keycloak?.logout()} title="Sign Out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <h1 className="page-heading">{pageLabels[activeTab]}</h1>
          </div>
          <div className="topbar-right">
            <div className="tenant-chip">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
              {tenantProfile?.name || keycloak?.tokenParsed?.preferred_username || 'workspace'}
            </div>
          </div>
        </header>

        <div className="content-area">
          {activeTab === 'dashboard'   && <DashboardPage projects={projects} tenantProfile={tenantProfile} isAdmin={isAdmin} />}
          {activeTab === 'projects'    && <ProjectsPage projects={projects} isAdmin={isAdmin} onAdd={addProject} onUpdate={updateProject} onDelete={deleteProject} />}
          {activeTab === 'members'     && isAdmin     && <MembersPage isAdmin={isAdmin} />}
          {activeTab === 'audit'       && isAdmin     && <AuditPage />}
          {activeTab === 'settings'    && isAdmin     && <SettingsPage tenantProfile={tenantProfile} onProfileUpdate={setTenantProfile} />}
          {activeTab === 'super-admin' && isSuperAdmin && <SuperAdminPage />}
        </div>
      </main>
    </div>
  );
};

export default App;
