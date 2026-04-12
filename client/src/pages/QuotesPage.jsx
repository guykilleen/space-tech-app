import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import JobCreateModal from '../components/JobCreateModal';
import styles from './Page.module.css';

const STATUSES = ['pending','review','accepted','declined'];

function badge(s) {
  const map = { pending:'b-pending Pending', accepted:'b-accepted Accepted', declined:'b-declined Declined', review:'b-review Under Review' };
  const [cls, label] = (map[s] || 'b-pending Pending').split(' ');
  return <span className={`badge ${cls}`}>{label}</span>;
}
function qbBadge(s) {
  const map = { draft:'b-pending Draft', sent:'b-review Sent', submitted:'b-review Submitted', accepted:'b-accepted Accepted', locked:'b-locked Locked' };
  const [cls, label] = (map[s] || `b-pending ${s}`).split(' ');
  return <span className={`badge ${cls}`}>{label}</span>;
}
function fmtDate(v) {
  if (!v) return '—';
  try { const clean = v.includes('T') ? v.split('T')[0] : v; return new Date(clean + 'T00:00:00').toLocaleDateString('en-AU'); } catch { return v; }
}
function fmtMoney(v) {
  return (v != null && v !== '') ? new Intl.NumberFormat('en-AU', { style:'currency', currency:'AUD' }).format(v) : '—';
}

export default function QuotesPage() {
  const { isAdminOrMgr } = useAuth();
  const navigate = useNavigate();
  const [quotes, setQuotes]     = useState([]);
  const [search, setSearch]     = useState('');
  const [editId, setEditId]     = useState(null);
  const [editData, setEditData] = useState({});
  const [jobModal,    setJobModal]    = useState(null); // quote to convert
  const [buildingId,  setBuildingId]  = useState(null); // QB open in progress
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [qCount, setQCount]           = useState(0);

  async function load(params = {}) {
    const res = await api.get('/quotes', { params });
    const data = res.data;
    setQuotes(data);
    setQCount(data.length);
    return data;
  }

  useEffect(() => { load(); }, []);

  const filtered = quotes.filter(q => {
    if (!search) return true;
    const l = search.toLowerCase();
    return [q.quote_number, q.client_name, q.project, q.initials].some(v => (v||'').toLowerCase().includes(l));
  });

  // Sort by numeric portion of quote number descending
  const sorted = [...filtered].sort((a, b) => {
    const na = parseInt((a.quote_number||'').match(/(\d+)$/)?.[1] || '0', 10);
    const nb = parseInt((b.quote_number||'').match(/(\d+)$/)?.[1] || '0', 10);
    return nb - na;
  });

  function openEdit(q) {
    setEditId(q.id);
    setEditData({
      quote_number: q.quote_number, initials: q.initials || '',
      date: q.date?.split('T')[0] || '', client_name: q.client_name,
      project: q.project || '', value: q.value,
      status: q.status, accept_details: q.accept_details || '',
      accept_date: q.accept_date?.split('T')[0] || '',
    });
  }

  function closeEdit() { setEditId(null); }

  function toggleGroup(jtId) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(jtId)) next.delete(jtId); else next.add(jtId);
      return next;
    });
  }

  async function openInBuilder(q) {
    // If quote has revisions, navigate directly to the latest (highest revision_sequence)
    const revisions = q.qb_revisions || [];
    if (revisions.length > 0) {
      const latest = revisions.reduce((best, r) => r.revision_sequence > best.revision_sequence ? r : best, revisions[0]);
      navigate(`/qb/quotes/${latest.qb_id}`);
      return;
    }
    // No existing QB quote — create one from JT quote
    setBuildingId(q.id);
    try {
      const res = await api.post(`/qb/quotes/from-quote/${q.id}`);
      navigate(`/qb/quotes/${res.data.id}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to open Quote Builder');
    } finally {
      setBuildingId(null);
    }
  }

  async function handleSaveEdit(id) {
    const prevStatus = quotes.find(q => q.id === id)?.status;
    try {
      const res = await api.put(`/quotes/${id}`, editData);
      toast.success('Quote updated');
      closeEdit();
      await load();
      if ((prevStatus !== 'accepted' && res.data.status === 'accepted') || res.data._statusChanged) {
        setJobModal(res.data);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    }
  }

  return (
    <div className={`${styles.page} has-mobile-fab`}>

      {/* ── Quote Register ── */}
      <div className="section-header">
        <h1 className="section-title">Quote Register</h1>
        <span className="section-tag" id="q-count">{qCount} Entr{qCount === 1 ? 'y' : 'ies'}</span>
        {isAdminOrMgr && (
          <button className="btn btn-primary desktop-only" style={{ marginLeft: 'auto' }} onClick={() => navigate('/qb/quotes/new')}>
            + New Quote
          </button>
        )}
      </div>

      <div className="table-wrap">
        <div className="table-toolbar">
          <span className="ttitle">All Quotes</span>
          <input className="search-box" type="text" placeholder="Search quotes…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* ── Desktop table ── */}
        <div className="desktop-only" style={{ overflowX: 'auto' }}>
          <table className="std-table">
            <thead>
              <tr>
                <th>Quote #</th><th>By</th><th>Date</th><th>Client</th><th>Project</th>
                <th>Value</th><th>Status</th><th>Acceptance</th><th>Accepted</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length ? sorted.map(q => {
                const revisions = q.qb_revisions || [];
                const hasRevisions = revisions.some(r => r.revision_sequence > 0);
                const isExpanded = expandedGroups.has(q.id);
                const revCount = revisions.filter(r => r.revision_sequence > 0).length;
                return (
                <React.Fragment key={q.id}>
                  <tr id={`qrow-${q.id}`}>
                    <td>
                      {hasRevisions && (
                        <button
                          className="act-btn edit"
                          style={{ marginRight: 6, padding: '2px 6px', fontSize: '.7rem' }}
                          onClick={e => { e.stopPropagation(); toggleGroup(q.id); }}
                          title={isExpanded ? 'Collapse revisions' : 'Expand revisions'}
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      )}
                      <strong>{q.quote_number || '—'}</strong>
                      {hasRevisions && (
                        <span style={{ marginLeft: 6, fontSize: '.68rem', color: 'var(--muted)' }}>
                          ({revCount} rev)
                        </span>
                      )}
                    </td>
                    <td>{q.initials || '—'}</td>
                    <td>{fmtDate(q.date)}</td>
                    <td>{q.client_name || '—'}</td>
                    <td>{q.project || '—'}</td>
                    <td className="currency">{fmtMoney(q.value)}</td>
                    <td>{badge(q.status)}</td>
                    <td>{q.accept_details || '—'}</td>
                    <td>{fmtDate(q.accept_date)}</td>
                    <td>
                      {isAdminOrMgr && (
                        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                          <button className="act-btn edit" onClick={() => editId === q.id ? closeEdit() : openEdit(q)}>
                            {editId === q.id ? 'Close' : 'Edit Details'}
                          </button>
                          <button
                            className="act-btn"
                            title="Open Quote Builder"
                            disabled={buildingId === q.id}
                            onClick={() => openInBuilder(q)}
                          >
                            {buildingId === q.id ? '…' : 'Open Quote'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {/* QB revision sub-rows */}
                  {hasRevisions && isExpanded && revisions
                    .sort((a, b) => a.revision_sequence - b.revision_sequence)
                    .map(rev => (
                      <tr key={rev.qb_id} style={{ background: 'rgba(200,169,110,.04)', fontSize: '.82rem' }}>
                        <td style={{ paddingLeft: 28 }}>
                          <span style={{ color: 'var(--muted)', marginRight: 6 }}>↳</span>
                          <span>{rev.qb_number}</span>
                          {rev.revision_suffix && (
                            <span style={{ marginLeft: 4, fontSize: '.7rem', color: 'var(--muted)' }}>Rev_{rev.revision_suffix}</span>
                          )}
                        </td>
                        <td colSpan={7} />
                        <td>{qbBadge(rev.qb_status)}</td>
                        <td>
                          {isAdminOrMgr && (
                            <button className="act-btn edit" onClick={() => navigate(`/qb/quotes/${rev.qb_id}`)}>
                              {['submitted','sent','accepted','locked'].includes(rev.qb_status) ? 'View' : 'Edit'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  }
                  {editId === q.id && (
                    <tr className="edit-row">
                      <td colSpan={10}>
                        <div style={{ padding:'4px 0 8px', fontSize:'.6rem', letterSpacing:'.2em', textTransform:'uppercase', color:'var(--oak-dark)', marginBottom:10 }}>
                          Editing Quote {q.quote_number || ''}
                        </div>
                        <div className="edit-row-inner">
                          <div className="edit-field">
                            <label>Quote Number</label>
                            <input value={editData.quote_number} onChange={e => setEditData(d=>({...d,quote_number:e.target.value}))} />
                          </div>
                          <div className="edit-field">
                            <label>Preparer's Initials</label>
                            <input value={editData.initials} onChange={e => setEditData(d=>({...d,initials:e.target.value}))} maxLength={6} />
                          </div>
                          <div className="edit-field">
                            <label>Date</label>
                            <input type="date" value={editData.date} onChange={e => setEditData(d=>({...d,date:e.target.value}))} />
                          </div>
                          <div className="edit-field">
                            <label>Value ($ excl. GST)</label>
                            <input type="number" value={editData.value} onChange={e => setEditData(d=>({...d,value:e.target.value}))} step="0.01" min="0" />
                          </div>
                          <div className="edit-field" style={{ flex:1, minWidth:180 }}>
                            <label>Client Name</label>
                            <input value={editData.client_name} onChange={e => setEditData(d=>({...d,client_name:e.target.value}))} />
                          </div>
                          <div className="edit-field" style={{ flex:2, minWidth:220 }}>
                            <label>Project Name</label>
                            <input value={editData.project} onChange={e => setEditData(d=>({...d,project:e.target.value}))} />
                          </div>
                          <div className="edit-field">
                            <label>Status</label>
                            <select value={editData.status} onChange={e => setEditData(d=>({...d,status:e.target.value}))}>
                              {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1).replace('_',' ')}</option>)}
                            </select>
                          </div>
                          <div className="edit-field" style={{ flex:1, minWidth:180 }}>
                            <label>Acceptance Details</label>
                            <input value={editData.accept_details} onChange={e => setEditData(d=>({...d,accept_details:e.target.value}))} placeholder="PO number, verbal, email ref…" />
                          </div>
                          <div className="edit-field">
                            <label>Acceptance Date</label>
                            <input type="date" value={editData.accept_date} onChange={e => setEditData(d=>({...d,accept_date:e.target.value}))} />
                          </div>
                        </div>
                        <div className="edit-actions" style={{ marginTop: 14 }}>
                          <button className="smbtn smbtn-save" onClick={() => handleSaveEdit(q.id)}>Save Changes</button>
                          <button className="smbtn smbtn-cancel" onClick={closeEdit}>Cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ); }) : (
                <tr><td colSpan={10}><div className="empty-state"><div className="empty-icon">📋</div><div className="empty-text">No quotes found</div></div></td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Mobile card list ── */}
        <div className="mobile-only">
          {sorted.length ? (
            <div className="mobile-card-list">
              {sorted.map(q => (
                <div key={q.id} className="mobile-card">
                  <div className="mobile-card-top">
                    <span className="mobile-card-number">{q.quote_number || '—'}</span>
                    {badge(q.status)}
                  </div>
                  <div className="mobile-card-client">{q.client_name || '—'}</div>
                  <div className="mobile-card-project">{q.project || 'No project name'}</div>
                  <div className="mobile-card-meta">
                    <span className="mobile-card-value">{fmtMoney(q.value)}</span>
                    <span className="mobile-card-date">{fmtDate(q.date)}</span>
                  </div>
                  {isAdminOrMgr && (
                    <div className="mobile-card-actions">
                      <button className="act-btn edit" onClick={() => editId === q.id ? closeEdit() : openEdit(q)}>
                        {editId === q.id ? 'Close' : 'Edit'}
                      </button>
                      <button className="act-btn" onClick={() => openInBuilder(q)} disabled={buildingId === q.id}>
                        {buildingId === q.id ? '…' : 'Open Quote'}
                      </button>
                    </div>
                  )}
                  {editId === q.id && (
                    <div className="mobile-edit-panel">
                      <div style={{ fontSize:'.6rem', letterSpacing:'.2em', textTransform:'uppercase', color:'var(--oak-dark)', marginBottom:12 }}>
                        Editing {q.quote_number || ''}
                      </div>
                      <div className="edit-row-inner">
                        <div className="edit-field">
                          <label>Quote Number</label>
                          <input value={editData.quote_number} onChange={e => setEditData(d=>({...d,quote_number:e.target.value}))} />
                        </div>
                        <div className="edit-field">
                          <label>Preparer's Initials</label>
                          <input value={editData.initials} onChange={e => setEditData(d=>({...d,initials:e.target.value}))} maxLength={6} />
                        </div>
                        <div className="edit-field">
                          <label>Date</label>
                          <input type="date" value={editData.date} onChange={e => setEditData(d=>({...d,date:e.target.value}))} />
                        </div>
                        <div className="edit-field">
                          <label>Value ($ excl. GST)</label>
                          <input type="number" value={editData.value} onChange={e => setEditData(d=>({...d,value:e.target.value}))} step="0.01" min="0" />
                        </div>
                        <div className="edit-field">
                          <label>Client Name</label>
                          <input value={editData.client_name} onChange={e => setEditData(d=>({...d,client_name:e.target.value}))} />
                        </div>
                        <div className="edit-field">
                          <label>Project Name</label>
                          <input value={editData.project} onChange={e => setEditData(d=>({...d,project:e.target.value}))} />
                        </div>
                        <div className="edit-field">
                          <label>Status</label>
                          <select value={editData.status} onChange={e => setEditData(d=>({...d,status:e.target.value}))}>
                            {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1).replace('_',' ')}</option>)}
                          </select>
                        </div>
                        <div className="edit-field">
                          <label>Acceptance Details</label>
                          <input value={editData.accept_details} onChange={e => setEditData(d=>({...d,accept_details:e.target.value}))} placeholder="PO number, verbal, email ref…" />
                        </div>
                        <div className="edit-field">
                          <label>Acceptance Date</label>
                          <input type="date" value={editData.accept_date} onChange={e => setEditData(d=>({...d,accept_date:e.target.value}))} />
                        </div>
                      </div>
                      <div className="edit-actions">
                        <button className="smbtn smbtn-save" onClick={() => handleSaveEdit(q.id)}>Save Changes</button>
                        <button className="smbtn smbtn-cancel" onClick={closeEdit}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state"><div className="empty-icon">📋</div><div className="empty-text">No quotes found</div></div>
          )}
        </div>

      </div>

      {/* ── Mobile FAB — New Quote ── */}
      {isAdminOrMgr && (
        <div className="mobile-fab-wrap">
          <button className="mobile-fab" onClick={() => navigate('/qb/quotes/new')}>+ New Quote</button>
        </div>
      )}

      {jobModal && (
        <JobCreateModal
          quote={jobModal}
          onClose={() => setJobModal(null)}
          onCreated={() => { setJobModal(null); toast.success(`Job created from ${jobModal.quote_number}`); }}
        />
      )}
    </div>
  );
}
