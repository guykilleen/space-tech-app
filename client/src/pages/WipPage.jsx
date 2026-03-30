import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import styles from './WipPage.module.css';

function parseJobNum(job) {
  const s = String(job || '');
  const m = s.match(/^(\d+)(?:_(\d+))?$/);
  if (m) return { base: parseInt(m[1], 10), sub: m[2] ? parseInt(m[2], 10) : 0 };
  return { base: 0, sub: 0 };
}

function fmtMoney(v) {
  return (v != null && v !== '') ? new Intl.NumberFormat('en-AU', { style:'currency', currency:'AUD' }).format(v) : '—';
}

export default function WipPage() {
  const { canEdit } = useAuth();
  const [jobs, setJobs]               = useState([]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [activeCount, setActiveCount] = useState(0);

  async function load() {
    const res = await api.get('/jobs');
    const all = res.data;
    setActiveCount(all.filter(j => !j.wip_completed).length);
    setJobs(all);
  }

  useEffect(() => { load(); }, []);

  const visible = jobs
    .filter(j => showCompleted || !j.wip_completed)
    .sort((a, b) => {
      const na = parseJobNum(a.job_number), nb = parseJobNum(b.job_number);
      if (nb.base !== na.base) return nb.base - na.base;
      return na.sub - nb.sub;
    });

  async function setDue(id, val) {
    try {
      await api.patch(`/jobs/${id}/wip`, { wip_due: val });
      setJobs(prev => prev.map(j => j.id === id ? { ...j, wip_due: val } : j));
    } catch { toast.error('Failed to update due date'); }
  }

  async function setPct(id, val) {
    const pct = Math.min(100, Math.max(0, parseInt(val) || 0));
    try {
      await api.patch(`/jobs/${id}/wip`, { wip_complete: pct });
      setJobs(prev => prev.map(j => j.id === id ? { ...j, wip_complete: pct } : j));
    } catch { toast.error('Failed to update progress'); }
  }

  async function toggleDone(id, currentlyDone) {
    if (!currentlyDone) {
      if (!window.confirm('Mark this job as completed? It will be hidden from the active WIP list.')) return;
    }
    try {
      await api.patch(`/jobs/${id}/wip`, { wip_completed: !currentlyDone });
      load();
    } catch { toast.error('Failed'); }
  }

  return (
    <div className={styles.pageFull}>
      <div className="section-header">
        <h1 className="section-title">Work in Progress</h1>
        <span className="section-tag">{activeCount} Active Job{activeCount === 1 ? '' : 's'}</span>
      </div>

      <div className={styles.tableWrap}>
        <div className={styles.toolbar}>
          <span className="ttitle">Active Jobs</span>
          <label className={styles.showCompleted}>
            <input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)} />
            Show completed
          </label>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table className={styles.wipTable}>
            <thead>
              <tr>
                <th>Job #</th><th>Project</th><th>Client</th><th>PM</th>
                <th>Due On-Site</th>
                <th>Admin</th><th>Mach.</th><th>Asm.</th><th>Del.</th><th>Install</th>
                <th>Total Hrs</th><th>Complete %</th>
                <th>Value</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.length ? visible.map(j => {
                const isSub = parseJobNum(j.job_number).sub > 0;
                const pm    = j.quote_initials || '—';
                const val   = j.quote_value != null ? fmtMoney(j.quote_value) : '—';
                const pct   = j.wip_complete || 0;
                const pctColor = pct >= 100 ? '#3A7D44' : pct >= 50 ? 'var(--oak)' : '#5B8DB8';
                const rowCls = [j.wip_completed ? styles.completedRow : '', isSub ? styles.subRow : ''].join(' ');
                const jobDisp = isSub
                  ? <><span className={styles.subArrow}>↳</span><strong>{j.job_number}</strong></>
                  : <strong>{j.job_number}</strong>;

                return (
                  <tr key={j.id} className={rowCls}>
                    <td>{jobDisp}</td>
                    <td>{j.project || '—'}</td>
                    <td>{j.client_name || '—'}</td>
                    <td style={{ textAlign:'center' }}>{pm}</td>
                    <td>
                      {canEdit ? (
                        <input
                          type="date"
                          value={j.wip_due ? j.wip_due.split('T')[0] : ''}
                          onChange={e => setDue(j.id, e.target.value)}
                          className={styles.dueDateInput}
                        />
                      ) : (
                        j.wip_due ? new Date((j.wip_due.includes('T') ? j.wip_due.split('T')[0] : j.wip_due) + 'T00:00:00').toLocaleDateString('en-AU') : '—'
                      )}
                    </td>
                    <td style={{ textAlign:'right', color:'var(--muted)' }}>{parseFloat(j.hours_admin||0).toFixed(1)}</td>
                    <td style={{ textAlign:'right', color:'var(--muted)' }}>{parseFloat(j.hours_machining||0).toFixed(1)}</td>
                    <td style={{ textAlign:'right', color:'var(--muted)' }}>{parseFloat(j.hours_assembly||0).toFixed(1)}</td>
                    <td style={{ textAlign:'right', color:'var(--muted)' }}>{parseFloat(j.hours_delivery||0).toFixed(1)}</td>
                    <td style={{ textAlign:'right', color:'var(--muted)' }}>{parseFloat(j.hours_install||0).toFixed(1)}</td>
                    <td style={{ textAlign:'right', fontWeight:500, color:'var(--mid)' }}>{parseFloat(j.total_hours||0).toFixed(1)}</td>
                    <td>
                      <div className={styles.pctWrap}>
                        {canEdit ? (
                          <input
                            className={styles.pctInput}
                            type="number" value={pct} min="0" max="100" step="5"
                            onChange={e => setPct(j.id, e.target.value)}
                          />
                        ) : (
                          <span className={styles.pctInput}>{pct}</span>
                        )}
                        <span style={{ fontSize:'.6rem', color:'var(--muted)' }}>%</span>
                        <div className={styles.pctBar}>
                          <div className={styles.pctFill} style={{ width:`${pct}%`, background: pctColor }} />
                        </div>
                      </div>
                    </td>
                    <td style={{ fontWeight:500, color:'var(--mid)' }}>{val}</td>
                    <td>
                      {canEdit && (
                        j.wip_completed
                          ? <button className={styles.undoneBtn} onClick={() => toggleDone(j.id, true)}>Reopen</button>
                          : <button className={styles.doneBtn} onClick={() => toggleDone(j.id, false)}>✓ Done</button>
                      )}
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={14}>
                    <div className="empty-state">
                      <div className="empty-icon">🔨</div>
                      <div className="empty-text">No active jobs</div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
