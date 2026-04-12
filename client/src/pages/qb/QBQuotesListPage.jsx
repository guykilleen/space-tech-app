import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import api from '../../utils/api';
import styles from '../Page.module.css';

const STATUS_LABELS = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined' };
const STATUS_BADGE  = { draft: 'b-pending', sent: 'b-review', accepted: 'b-accepted', declined: 'b-declined' };

function fmtDate(v) {
  if (!v) return '—';
  try { return new Date(v.split('T')[0] + 'T00:00:00').toLocaleDateString('en-AU'); } catch { return v; }
}
function fmtMoney(v) {
  return v != null ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v) : '—';
}

export default function QBQuotesListPage() {
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

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

  const filtered = quotes.filter(q => {
    if (!search) return true;
    const l = search.toLowerCase();
    return [q.quote_number, q.client_name, q.client_company, q.project, q.prepared_by]
      .some(v => (v || '').toLowerCase().includes(l));
  });

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
                <th>Date</th>
                <th>Client</th>
                <th>Company</th>
                <th>Project</th>
                <th>Prepared By</th>
                <th>Value (ex GST)</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9}><div className="empty-state"><div className="empty-text">Loading…</div></div></td></tr>
              ) : filtered.length ? filtered.map(q => (
                <tr key={q.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/qb/quotes/${q.id}`)}>
                  <td><strong>{q.quote_number}</strong></td>
                  <td>{fmtDate(q.date)}</td>
                  <td>{q.client_name || '—'}</td>
                  <td>{q.client_company || '—'}</td>
                  <td>{q.project || '—'}</td>
                  <td>{q.prepared_by || '—'}</td>
                  <td className="currency">{fmtMoney(q.subtotal_ex_gst)}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[q.status] || 'b-pending'}`}>
                      {STATUS_LABELS[q.status] || q.status}
                    </span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="act-btn edit" onClick={() => navigate(`/qb/quotes/${q.id}`)}>Edit</button>
                      <button className="act-btn edit" onClick={() => navigate(`/qb/quotes/${q.id}/summary`)}>Summary</button>
                      <button className="act-btn del" onClick={() => handleDelete(q.id, q.quote_number)}>Del</button>
                    </div>
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
          ) : filtered.length ? (
            <div className="mobile-card-list">
              {filtered.map(q => (
                <div key={q.id} className="mobile-card" onClick={() => navigate(`/qb/quotes/${q.id}`)}>
                  <div className="mobile-card-top">
                    <span className="mobile-card-number">{q.quote_number}</span>
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
                    <button className="act-btn edit" onClick={() => navigate(`/qb/quotes/${q.id}`)}>Edit</button>
                    <button className="act-btn edit" onClick={() => navigate(`/qb/quotes/${q.id}/summary`)}>Summary</button>
                    <button className="act-btn del" onClick={() => handleDelete(q.id, q.quote_number)}>Delete</button>
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
