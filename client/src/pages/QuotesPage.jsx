import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import JobCreateModal from '../components/JobCreateModal';
import ImportPanel from '../components/ImportPanel';
import styles from './Page.module.css';

const STATUSES = ['pending','review','accepted','declined'];

function badge(s) {
  const map = { pending:'b-pending Pending', accepted:'b-accepted Accepted', declined:'b-declined Declined', review:'b-review Under Review' };
  const [cls, label] = (map[s] || 'b-pending Pending').split(' ');
  return <span className={`badge ${cls}`}>{label}</span>;
}
function fmtDate(v) {
  if (!v) return '—';
  try { const clean = v.includes('T') ? v.split('T')[0] : v; return new Date(clean + 'T00:00:00').toLocaleDateString('en-AU'); } catch { return v; }
}
function fmtMoney(v) {
  return (v != null && v !== '') ? new Intl.NumberFormat('en-AU', { style:'currency', currency:'AUD' }).format(v) : '—';
}

const today = new Date().toISOString().split('T')[0];

export default function QuotesPage() {
  const { isAdminOrMgr } = useAuth();
  const [quotes, setQuotes]     = useState([]);
  const [search, setSearch]     = useState('');
  const [editId, setEditId]     = useState(null);
  const [editData, setEditData] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [jobModal, setJobModal] = useState(null); // quote to convert
  const [qCount, setQCount]     = useState(0);
  const formRef = useRef({});

  // New quote form state
  const [form, setForm] = useState({
    quote_number:'', initials:'', date: today, client_name:'', project:'',
    value:'', status:'pending', accept_details:'', accept_date:'',
  });

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

  async function handleSaveNew(e) {
    e.preventDefault();
    try {
      await api.post('/quotes', form);
      toast.success('Quote saved');
      setForm({ quote_number:'', initials:'', date: today, client_name:'', project:'', value:'', status:'pending', accept_details:'', accept_date:'' });
      const data = await load();
      // Suggest next number
      const nums = data.map(q => parseInt((q.quote_number||'').match(/(\d+)$/)?.[1] || '0', 10));
      const max  = nums.length ? Math.max(...nums) : 0;
      const sample = data.find(q => parseInt((q.quote_number||'').match(/(\d+)$/)?.[1]||'0',10) === max);
      if (sample) {
        const m = String(sample.quote_number).match(/^(.*?)(\d+)$/);
        if (m) setForm(f => ({ ...f, quote_number: m[1] + String(max + 1).padStart(m[2].length, '0') }));
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this quote?')) return;
    try { await api.delete(`/quotes/${id}`); toast.success('Deleted'); load(); }
    catch { toast.error('Delete failed'); }
  }

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

  async function handleSaveEdit(id) {
    const prevStatus = quotes.find(q => q.id === id)?.status;
    try {
      const res = await api.put(`/quotes/${id}`, editData);
      toast.success('Quote updated');
      closeEdit();
      await load();
      if (prevStatus !== 'accepted' && res.data.status === 'accepted') {
        setJobModal(res.data);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    }
  }

  return (
    <div className={styles.page}>

      {/* ── Import Panel ── */}
      <ImportPanel onImported={load} />

      {/* ── New Quote Form ── */}
      <div className="section-header">
        <h1 className="section-title">Quote Intake</h1>
        <span className="section-tag">New Entry</span>
      </div>

      <form className="form-panel" onSubmit={handleSaveNew}>
        <div className="form-panel-title">Quote Details</div>
        <div className="form-grid cols-4">
          <div className="field">
            <label>Quote Number</label>
            <input value={form.quote_number} onChange={e => setForm(f=>({...f,quote_number:e.target.value}))} placeholder="Q-001" />
          </div>
          <div className="field">
            <label>Preparer's Initials</label>
            <input value={form.initials} onChange={e => setForm(f=>({...f,initials:e.target.value}))} placeholder="G.K." maxLength={6} />
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" value={form.date} onChange={e => setForm(f=>({...f,date:e.target.value}))} />
          </div>
          <div className="field">
            <label>Quote Value ($ excl. GST)</label>
            <input type="number" value={form.value} onChange={e => setForm(f=>({...f,value:e.target.value}))} placeholder="0.00" step="0.01" min="0" />
          </div>
          <div className="field span-2">
            <label>Client Name</label>
            <input required value={form.client_name} onChange={e => setForm(f=>({...f,client_name:e.target.value}))} placeholder="Client full name or company" />
          </div>
          <div className="field span-2">
            <label>Project Name</label>
            <input value={form.project} onChange={e => setForm(f=>({...f,project:e.target.value}))} placeholder="Project description or title" />
          </div>
          <div className="field">
            <label>Status</label>
            <select value={form.status} onChange={e => setForm(f=>({...f,status:e.target.value}))}>
              {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1).replace('_',' ')}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Acceptance Date</label>
            <input type="date" value={form.accept_date} onChange={e => setForm(f=>({...f,accept_date:e.target.value}))} />
          </div>
          <div className="field span-2">
            <label>Acceptance Details</label>
            <input value={form.accept_details} onChange={e => setForm(f=>({...f,accept_details:e.target.value}))} placeholder="PO number, verbal, email ref…" />
          </div>
        </div>
        {isAdminOrMgr && (
          <div className="btn-row">
            <button type="button" className="btn btn-outline" onClick={() => setForm({ quote_number:'', initials:'', date:today, client_name:'', project:'', value:'', status:'pending', accept_details:'', accept_date:'' })}>Clear</button>
            <button type="submit" className="btn btn-primary">Save Quote →</button>
          </div>
        )}
      </form>

      {/* ── Quote Register ── */}
      <div className="section-header" style={{ marginTop: 40 }}>
        <h2 className="section-title">Quote Register</h2>
        <span className="section-tag" id="q-count">{qCount} Entr{qCount === 1 ? 'y' : 'ies'}</span>
      </div>

      <div className="table-wrap">
        <div className="table-toolbar">
          <span className="ttitle">All Quotes</span>
          <input className="search-box" type="text" placeholder="Search quotes…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="std-table">
            <thead>
              <tr>
                <th>Quote #</th><th>By</th><th>Date</th><th>Client</th><th>Project</th>
                <th>Value</th><th>Status</th><th>Acceptance</th><th>Accepted</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length ? sorted.map(q => (
                <React.Fragment key={q.id}>
                  <tr id={`qrow-${q.id}`}>
                    <td><strong>{q.quote_number || '—'}</strong></td>
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
                            {editId === q.id ? 'Close' : 'Edit'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
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
              )) : (
                <tr><td colSpan={10}><div className="empty-state"><div className="empty-icon">📋</div><div className="empty-text">No quotes found</div></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
