import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import styles from './Page.module.css';

function parseJobNum(job) {
  const s = String(job || '');
  const m = s.match(/^(\d+)(?:_(\d+))?$/);
  if (m) return { base: parseInt(m[1], 10), sub: m[2] ? parseInt(m[2], 10) : 0 };
  const n = s.match(/(\d+)$/);
  return { base: n ? parseInt(n[1], 10) : 0, sub: 0 };
}

const HRS_FIELDS = ['hours_admin','hours_machining','hours_assembly','hours_delivery','hours_install'];
const HRS_LABELS = ['Admin / Draw','Machining','Assembly','Delivery','Installation'];

export default function JobsPage() {
  const { isAdminOrMgr } = useAuth();
  const [jobs, setJobs]       = useState([]);
  const [search, setSearch]   = useState('');
  const [editId, setEditId]   = useState(null);
  const [editData, setEditData] = useState({});
  const [pCount, setPCount]   = useState(0);

  const emptyForm = { job:'', quoteNum:'', client_name:'', project:'',
    wip_start:'', wip_due:'',
    hours_admin:0, hours_machining:0, hours_assembly:0, hours_delivery:0, hours_install:0 };
  const [form, setForm]       = useState(emptyForm);

  function totalHrs(d) {
    return HRS_FIELDS.reduce((s, k) => s + (parseFloat(d[k]) || 0), 0);
  }

  async function load() {
    const res = await api.get('/jobs');
    const data = res.data;
    setJobs(data);
    setPCount(data.length);
    return data;
  }

  useEffect(() => { load(); }, []);

  const filtered = jobs.filter(j => {
    if (!search) return true;
    const l = search.toLowerCase();
    return [j.job_number, j.client_name, j.project, j.quote_number].some(v => (v||'').toLowerCase().includes(l));
  });

  // Sort: highest base first, sub-jobs ascending under parent
  const sorted = [...filtered].sort((a, b) => {
    const na = parseJobNum(a.job_number), nb = parseJobNum(b.job_number);
    if (nb.base !== na.base) return nb.base - na.base;
    return na.sub - nb.sub;
  });

  async function handleSaveNew(e) {
    e.preventDefault();
    try {
      await api.post('/jobs', {
        job_number:   form.job      || undefined,
        quote_number: form.quoteNum || undefined,
        client_name:  form.client_name,
        project:      form.project,
        wip_start:    form.wip_start || undefined,
        wip_due:      form.wip_due   || undefined,
        hours_admin:     parseFloat(form.hours_admin)     || 0,
        hours_machining: parseFloat(form.hours_machining) || 0,
        hours_assembly:  parseFloat(form.hours_assembly)  || 0,
        hours_delivery:  parseFloat(form.hours_delivery)  || 0,
        hours_install:   parseFloat(form.hours_install)   || 0,
      });
      toast.success('Job saved');
      setForm(emptyForm);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this job?')) return;
    try { await api.delete(`/jobs/${id}`); toast.success('Deleted'); load(); }
    catch { toast.error('Delete failed'); }
  }

  function openEdit(j) {
    setEditId(j.id);
    setEditData({
      job_number: j.job_number, quote_number: j.quote_number || '',
      client_name: j.client_name, project: j.project || '',
      wip_start: j.wip_start ? j.wip_start.split('T')[0] : '',
      wip_due:   j.wip_due   ? j.wip_due.split('T')[0]   : '',
      hours_admin: j.hours_admin, hours_machining: j.hours_machining,
      hours_assembly: j.hours_assembly, hours_delivery: j.hours_delivery,
      hours_install: j.hours_install,
    });
  }

  async function handleSaveEdit(id) {
    try {
      await api.put(`/jobs/${id}`, {
        ...editData,
        wip_start: editData.wip_start || null,
        wip_due:   editData.wip_due   || null,
        hours_admin:     parseFloat(editData.hours_admin)     || 0,
        hours_machining: parseFloat(editData.hours_machining) || 0,
        hours_assembly:  parseFloat(editData.hours_assembly)  || 0,
        hours_delivery:  parseFloat(editData.hours_delivery)  || 0,
        hours_install:   parseFloat(editData.hours_install)   || 0,
      });
      toast.success('Job updated');
      setEditId(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    }
  }

  return (
    <div className={styles.page}>

      {/* ── New Job Form ── */}
      <div className="section-header">
        <h1 className="section-title">Project Tracking</h1>
        <span className="section-tag">New Entry</span>
      </div>

      <form className="form-panel" onSubmit={handleSaveNew}>
        <div className="form-panel-title">Job Details</div>
        <div className="form-grid cols-4">
          <div className="field">
            <label>Job Number</label>
            <input value={form.job} onChange={e => setForm(f=>({...f,job:e.target.value}))} placeholder="001" />
          </div>
          <div className="field">
            <label>Quote Number</label>
            <input value={form.quoteNum} onChange={e => setForm(f=>({...f,quoteNum:e.target.value}))} placeholder="Q-001" />
          </div>
          <div className="field span-2">
            <label>Client Name</label>
            <input required value={form.client_name} onChange={e => setForm(f=>({...f,client_name:e.target.value}))} placeholder="Client full name or company" />
          </div>
          <div className="field span-full">
            <label>Project Name</label>
            <input value={form.project} onChange={e => setForm(f=>({...f,project:e.target.value}))} placeholder="Project title" />
          </div>
          <div className="field">
            <label>Start Date</label>
            <input type="date" value={form.wip_start} onChange={e => setForm(f=>({...f,wip_start:e.target.value}))} />
          </div>
          <div className="field">
            <label>Due On-Site</label>
            <input type="date" value={form.wip_due} onChange={e => setForm(f=>({...f,wip_due:e.target.value}))} />
          </div>
        </div>

        <div className="divider" />
        <div className="form-panel-title">Hours Tracking</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12 }}>
          {HRS_FIELDS.map((key, i) => (
            <div key={key} style={{ background:'var(--grain)', border:'1px solid var(--oak-light)', borderRadius:3, padding:'12px 14px', textAlign:'center' }}>
              <label style={{ display:'block', marginBottom:8 }}>{HRS_LABELS[i]}</label>
              <input
                type="number" value={form[key]} min="0" step="0.5"
                onChange={e => setForm(f=>({...f,[key]:e.target.value}))}
                style={{ textAlign:'center', background:'var(--white)', padding:'8px 6px', fontSize:'1rem', fontWeight:500, borderRadius:2 }}
              />
            </div>
          ))}
        </div>
        <div style={{ marginTop:12, display:'flex', justifyContent:'flex-end' }}>
          <div style={{ background:'var(--dark)', borderRadius:3, padding:'12px 14px', textAlign:'center', minWidth:160 }}>
            <label style={{ display:'block', color:'var(--muted)', marginBottom:8 }}>Total Hours</label>
            <div style={{ fontSize:'1.2rem', fontWeight:500, color:'var(--oak)' }}>{totalHrs(form).toFixed(1)} hrs</div>
          </div>
        </div>

        {isAdminOrMgr && (
          <div className="btn-row">
            <button type="button" className="btn btn-outline" onClick={() => setForm(emptyForm)}>Clear</button>
            <button type="submit" className="btn btn-primary">Save Job →</button>
          </div>
        )}
      </form>

      {/* ── Job Register ── */}
      <div className="section-header" style={{ marginTop: 40 }}>
        <h2 className="section-title">Job Register</h2>
        <span className="section-tag">{pCount} Job{pCount === 1 ? '' : 's'}</span>
      </div>

      <div className="table-wrap">
        <div className="table-toolbar">
          <span className="ttitle">All Jobs</span>
          <input className="search-box" type="text" placeholder="Search jobs…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="std-table">
            <thead>
              <tr>
                <th>Job #</th><th>Quote #</th><th>Client</th><th>Project</th>
                <th>Admin/Draw</th><th>Machining</th><th>Assembly</th><th>Delivery</th><th>Install</th>
                <th>Total Hrs</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length ? sorted.map(j => {
                const isSub = parseJobNum(j.job_number).sub > 0;
                return (
                  <React.Fragment key={j.id}>
                    <tr id={`prow-${j.id}`} style={isSub ? { background:'rgba(200,169,110,.04)' } : {}}>
                      <td>
                        {isSub && <span style={{ color:'var(--muted)', marginRight:4 }}>↳</span>}
                        <strong>{j.job_number || '—'}</strong>
                      </td>
                      <td>{j.quote_number || '—'}</td>
                      <td>{j.client_name || '—'}</td>
                      <td>{j.project || '—'}</td>
                      <td>{parseFloat(j.hours_admin||0).toFixed(1)}</td>
                      <td>{parseFloat(j.hours_machining||0).toFixed(1)}</td>
                      <td>{parseFloat(j.hours_assembly||0).toFixed(1)}</td>
                      <td>{parseFloat(j.hours_delivery||0).toFixed(1)}</td>
                      <td>{parseFloat(j.hours_install||0).toFixed(1)}</td>
                      <td><strong>{parseFloat(j.total_hours||0).toFixed(1)} hrs</strong></td>
                      <td>
                        {isAdminOrMgr && (
                          <>
                            <button className="act-btn edit" onClick={() => editId === j.id ? setEditId(null) : openEdit(j)}>
                              {editId === j.id ? 'Close' : 'Edit'}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                    {editId === j.id && (
                      <tr className="edit-row">
                        <td colSpan={11}>
                          <div style={{ padding:'4px 0 8px', fontSize:'.6rem', letterSpacing:'.2em', textTransform:'uppercase', color:'var(--oak-dark)', marginBottom:10 }}>
                            Editing Job {j.job_number || ''}
                          </div>
                          <div className="edit-row-inner">
                            <div className="edit-field">
                              <label>Job Number</label>
                              <input value={editData.job_number} onChange={e=>setEditData(d=>({...d,job_number:e.target.value}))} />
                            </div>
                            <div className="edit-field">
                              <label>Quote Number</label>
                              <input value={editData.quote_number} onChange={e=>setEditData(d=>({...d,quote_number:e.target.value}))} />
                            </div>
                            <div className="edit-field" style={{ flex:1, minWidth:180 }}>
                              <label>Client Name</label>
                              <input value={editData.client_name} onChange={e=>setEditData(d=>({...d,client_name:e.target.value}))} />
                            </div>
                            <div className="edit-field" style={{ flex:2, minWidth:220 }}>
                              <label>Project Name</label>
                              <input value={editData.project} onChange={e=>setEditData(d=>({...d,project:e.target.value}))} />
                            </div>
                            <div className="edit-field">
                              <label>Start Date</label>
                              <input type="date" value={editData.wip_start} onChange={e=>setEditData(d=>({...d,wip_start:e.target.value}))} />
                            </div>
                            <div className="edit-field">
                              <label>Due On-Site</label>
                              <input type="date" value={editData.wip_due} onChange={e=>setEditData(d=>({...d,wip_due:e.target.value}))} />
                            </div>
                          </div>
                          <div style={{ marginTop:12, fontSize:'.6rem', letterSpacing:'.18em', textTransform:'uppercase', color:'var(--oak-dark)', marginBottom:8 }}>Hours</div>
                          <div className="edit-row-inner">
                            {HRS_FIELDS.map((key, i) => (
                              <div key={key} className="edit-field">
                                <label>{HRS_LABELS[i]}</label>
                                <input type="number" min="0" step="0.5" value={editData[key]}
                                  onChange={e=>setEditData(d=>({...d,[key]:e.target.value}))} />
                              </div>
                            ))}
                            <div className="edit-field">
                              <label>Total Hours</label>
                              <input value={totalHrs(editData).toFixed(1)+' hrs'} readOnly style={{ background:'var(--dark)', color:'var(--oak)', fontWeight:500, cursor:'default' }} />
                            </div>
                          </div>
                          <div className="edit-actions" style={{ marginTop:14 }}>
                            <button className="smbtn smbtn-save" onClick={() => handleSaveEdit(j.id)}>Save Changes</button>
                            <button className="smbtn smbtn-cancel" onClick={() => setEditId(null)}>Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              }) : (
                <tr><td colSpan={11}><div className="empty-state"><div className="empty-icon">🔨</div><div className="empty-text">No jobs found</div></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
