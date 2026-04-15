import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import api from '../../utils/api';
import styles from '../Page.module.css';

const STATUS_LABELS = {
  draft:     'Draft',
  sent:      'Sent',
  submitted: 'Submitted',
  accepted:  'Accepted',
  declined:  'Declined',
  locked:    'Locked',
};
const STATUS_BADGE = {
  draft:     'b-pending',
  sent:      'b-review',
  submitted: 'b-review',
  accepted:  'b-accepted',
  declined:  'b-declined',
  locked:    'b-locked',
};

function fmtDate(v) {
  if (!v) return '—';
  try { return new Date(v.split('T')[0] + 'T00:00:00').toLocaleDateString('en-AU'); } catch { return v; }
}
function fmtMoney(v) {
  return v != null ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v) : '—';
}

// Build a display list with groups collapsed/expanded.
// Returns an ordered array of { quote, isRoot, isChild, hasChildren, groupId }.
function buildDisplayList(quotes, expandedGroups) {
  // Separate roots (no parent) from children
  const roots    = quotes.filter(q => !q.parent_quote_id);
  const children = quotes.filter(q =>  q.parent_quote_id);

  const rows = [];
  for (const root of roots) {
    const kids = children
      .filter(c => c.parent_quote_id === root.id)
      .sort((a, b) => a.revision_sequence - b.revision_sequence);
    const hasChildren = kids.length > 0;
    rows.push({ quote: root, isRoot: true, isChild: false, hasChildren, groupId: root.id });
    if (hasChildren && expandedGroups.has(root.id)) {
      for (const kid of kids) {
        rows.push({ quote: kid, isRoot: false, isChild: true, hasChildren: false, groupId: root.id });
      }
    }
  }
  // Orphaned children (parent deleted) — show flat
  const rootIds = new Set(roots.map(r => r.id));
  for (const child of children) {
    if (!rootIds.has(child.parent_quote_id)) {
      rows.push({ quote: child, isRoot: false, isChild: false, hasChildren: false, groupId: child.id });
    }
  }
  return rows;
}

export default function QBQuotesListPage() {
  const navigate = useNavigate();
  const [quotes,         setQuotes]         = useState([]);
  const [search,         setSearch]         = useState('');
  const [loading,        setLoading]        = useState(true);
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  async function load() {
    setLoading(true);
    try {
      const res = await api.get('/qb/quotes');
      setQuotes(res.data);
    } catch { toast.error('Failed to load quotes'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id, qn) {
    if (!window.confirm(`Delete QB quote ${qn}? This cannot be undone.`)) return;
    try {
      await api.delete(`/qb/quotes/${id}`);
      toast.success('Quote deleted');
      load();
    } catch { toast.error('Delete failed'); }
  }

  function toggleGroup(rootId) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(rootId)) next.delete(rootId); else next.add(rootId);
      return next;
    });
  }

  // Filter: show a quote if it or any quote in its group matches the search
  const searchLower = search.toLowerCase();
  const filtered = !search ? quotes : (() => {
    // Build a set of matching IDs + their whole group
    const matchIds = new Set();
    for (const q of quotes) {
      const matches = [q.quote_number, q.client_name, q.client_company, q.project, q.prepared_by]
        .some(v => (v || '').toLowerCase().includes(searchLower));
      if (matches) {
        matchIds.add(q.id);
        // Include root and all siblings
        const rootId = q.parent_quote_id || q.id;
        quotes.forEach(r => {
          if (r.id === rootId || r.parent_quote_id === rootId) matchIds.add(r.id);
        });
      }
    }
    return quotes.filter(q => matchIds.has(q.id));
  })();

  // When search is active, auto-expand groups that have matching children
  const displayRows = buildDisplayList(filtered, search
    ? (() => {
        const autoExpand = new Set(expandedGroups);
        filtered.forEach(q => { if (q.parent_quote_id) autoExpand.add(q.parent_quote_id); });
        return autoExpand;
      })()
    : expandedGroups
  );

  function renderActionCells(q, stopProp = false) {
    const wrap = stopProp ? (fn) => (e) => { e.stopPropagation(); fn(e); } : (fn) => fn;
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="act-btn edit" onClick={wrap(() => navigate(`/qb/quotes/${q.id}`))}>
          {['submitted', 'sent', 'accepted', 'locked'].includes(q.status) ? 'View' : 'Edit'}
        </button>
        <button className="act-btn edit" onClick={wrap(() => navigate(`/qb/quotes/${q.id}/summary`))}>Summary</button>
        <button className="act-btn del"  onClick={wrap(() => handleDelete(q.id, q.quote_number))}>Del</button>
      </div>
    );
  }

  return (
    <div className={`${styles.page} has-mobile-fab`}>
      <div className="section-header">
        <h1 className="section-title">QB Quotes</h1>
        <span className="section-tag">{quotes.length} quote{quotes.length !== 1 ? 's' : ''}</span>
        <button className="btn btn-primary desktop-only" style={{ marginLeft: 'auto' }} onClick={() => navigate('/qb/quotes/new')}>
          + New Quote
        </button>
      </div>

      <div className="table-wrap">
        <div className="table-toolbar">
          <span className="ttitle">All Quotes</span>
          <input
            className="search-box"
            type="text"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* ── Desktop table ── */}
        <div className="desktop-only" style={{ overflowX: 'auto' }}>
          <table className="std-table">
            <thead>
              <tr>
                <th>Quote #</th>
                <th>Prepared By</th>
                <th>Date</th>
                <th>Project</th>
                <th>Company</th>
                <th>Client</th>
                <th>Value (Ex GST)</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9}><div className="empty-state"><div className="empty-text">Loading…</div></div></td></tr>
              ) : displayRows.length ? displayRows.map(({ quote: q, isRoot, isChild, hasChildren, groupId }) => (
                <tr
                  key={q.id}
                  style={{
                    cursor: 'pointer',
                    background: isChild ? 'rgba(200,169,110,.04)' : undefined,
                    opacity: q.status === 'locked' ? 0.65 : 1,
                  }}
                  onClick={() => navigate(`/qb/quotes/${q.id}`)}
                >
                  <td>
                    {isRoot && hasChildren && (
                      <button
                        className="act-btn edit"
                        style={{ marginRight: 6, padding: '2px 6px', fontSize: '.7rem' }}
                        onClick={e => { e.stopPropagation(); toggleGroup(groupId); }}
                        title={expandedGroups.has(groupId) ? 'Collapse revisions' : 'Expand revisions'}
                      >
                        {expandedGroups.has(groupId) ? '▼' : '▶'}
                      </button>
                    )}
                    {isChild && <span style={{ color: 'var(--muted)', marginRight: 6 }}>↳</span>}
                    <strong>{q.quote_number}</strong>
                    {isRoot && hasChildren && (
                      <span style={{ marginLeft: 6, fontSize: '.68rem', color: 'var(--muted)' }}>
                        ({filtered.filter(r => r.parent_quote_id === q.id).length} rev)
                      </span>
                    )}
                  </td>
                  <td>{q.prepared_by    || '—'}</td>
                  <td>{fmtDate(q.date)}</td>
                  <td>{q.project        || '—'}</td>
                  <td>{q.client_company || '—'}</td>
                  <td>{q.client_name    || '—'}</td>
                  <td className="currency">{fmtMoney(q.subtotal_ex_gst)}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[q.status] || 'b-pending'}`}>
                      {STATUS_LABELS[q.status] || q.status}
                    </span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    {renderActionCells(q)}
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={9}><div className="empty-state"><div className="empty-icon">📄</div><div className="empty-text">No quotes found</div></div></td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Mobile card list ── */}
        <div className="mobile-only">
          {loading ? (
            <div className="empty-state"><div className="empty-text">Loading…</div></div>
          ) : displayRows.length ? (
            <div className="mobile-card-list">
              {displayRows.map(({ quote: q, isChild, isRoot, hasChildren, groupId }) => (
                <div
                  key={q.id}
                  className="mobile-card"
                  style={{ opacity: q.status === 'locked' ? 0.65 : 1, marginLeft: isChild ? 16 : 0 }}
                  onClick={() => navigate(`/qb/quotes/${q.id}`)}
                >
                  <div className="mobile-card-top">
                    <span className="mobile-card-number">
                      {isRoot && hasChildren && (
                        <button
                          style={{ background: 'none', border: 'none', padding: '0 4px 0 0', cursor: 'pointer', fontSize: '.8rem' }}
                          onClick={e => { e.stopPropagation(); toggleGroup(groupId); }}
                        >
                          {expandedGroups.has(groupId) ? '▼' : '▶'}
                        </button>
                      )}
                      {isChild && <span style={{ color: 'var(--muted)' }}>↳ </span>}
                      {q.quote_number}
                    </span>
                    <span className={`badge ${STATUS_BADGE[q.status] || 'b-pending'}`}>
                      {STATUS_LABELS[q.status] || q.status}
                    </span>
                  </div>
                  <div className="mobile-card-client">{q.client_name || '—'}{q.client_company ? ` — ${q.client_company}` : ''}</div>
                  <div className="mobile-card-project">{q.project || 'No project name'}</div>
                  <div className="mobile-card-meta">
                    <span className="mobile-card-value">{fmtMoney(q.subtotal_ex_gst)}</span>
                    <span className="mobile-card-date">{fmtDate(q.date)}</span>
                  </div>
                  <div className="mobile-card-actions" onClick={e => e.stopPropagation()}>
                    <button className="act-btn edit" onClick={() => navigate(`/qb/quotes/${q.id}`)}>
                      {['submitted', 'sent', 'accepted', 'locked'].includes(q.status) ? 'View' : 'Edit'}
                    </button>
                    <button className="act-btn edit" onClick={() => navigate(`/qb/quotes/${q.id}/summary`)}>Summary</button>
                    <button className="act-btn del"  onClick={() => handleDelete(q.id, q.quote_number)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state"><div className="empty-icon">📄</div><div className="empty-text">No quotes found</div></div>
          )}
        </div>

      </div>

      {/* ── Mobile FAB — New Quote ── */}
      <div className="mobile-fab-wrap">
        <button className="mobile-fab" onClick={() => navigate('/qb/quotes/new')}>+ New Quote</button>
      </div>
    </div>
  );
}
