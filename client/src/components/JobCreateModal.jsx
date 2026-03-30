import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import { toast } from 'react-toastify';
import styles from './JobCreateModal.module.css';

const HRS_FIELDS = ['hours_admin','hours_machining','hours_assembly','hours_delivery','hours_install'];
const HRS_LABELS = ['Admin / Draw','Machining','Assembly','Delivery','Installation'];

export default function JobCreateModal({ quote, onClose, onCreated }) {
  const isVariation = (quote.quote_number || '').toUpperCase().startsWith('VQ');
  const [wipDue, setWipDue]           = useState('');
  const [parentJobId, setParentJobId] = useState('');
  const [jobs, setJobs]               = useState([]);
  const [loading, setLoading]         = useState(false);
  const [hours, setHours]             = useState({ hours_admin:0, hours_machining:0, hours_assembly:0, hours_delivery:0, hours_install:0 });

  const totalHrs = HRS_FIELDS.reduce((s, k) => s + (parseFloat(hours[k]) || 0), 0);

  useEffect(() => {
    if (isVariation) {
      api.get('/jobs').then(r => {
        const baseJobs = r.data.filter(j => !j.parent_job_id);
        const qClient  = (quote.client_name || '').toLowerCase();
        const qProject = (quote.project || '').toLowerCase();
        const scored = baseJobs.map(j => {
          let score = 0;
          if ((j.client_name || '').toLowerCase() === qClient)  score += 2;
          if (qProject && (j.project || '').toLowerCase() === qProject) score += 3;
          return { ...j, _score: score };
        }).sort((a, b) => b._score - a._score || b.job_number - a.job_number);
        setJobs(scored);
        if (scored[0]?._score > 0) setParentJobId(scored[0].id);
      });
    }
  }, [isVariation]);

  async function handleCreate() {
    setLoading(true);
    try {
      await api.patch(`/quotes/${quote.id}/status`, { status: 'accepted' }).catch(() => {});
      const job = await api.post(`/jobs/convert-quote/${quote.id}`, {
        parent_job_id:    parentJobId || undefined,
        wip_due:          wipDue || undefined,
        hours_admin:      parseFloat(hours.hours_admin)     || 0,
        hours_machining:  parseFloat(hours.hours_machining) || 0,
        hours_assembly:   parseFloat(hours.hours_assembly)  || 0,
        hours_delivery:   parseFloat(hours.hours_delivery)  || 0,
        hours_install:    parseFloat(hours.hours_install)   || 0,
      });
      toast.success(`Job ${job.data.job_number} created`);
      onCreated(job.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create job');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>{isVariation ? 'Variation Quote Accepted' : `Create Job from ${quote.quote_number}`}</div>
          <div className={styles.sub}>Quote <strong>{quote.quote_number}</strong> — {quote.project || quote.client_name}</div>
        </div>

        <div className={styles.body}>
          <div className={styles.details}>
            <div>
              <div className={styles.detLabel}>Client</div>
              <div className={styles.detValue}>{quote.client_name || '—'}</div>
            </div>
            <div>
              <div className={styles.detLabel}>Project</div>
              <div className={styles.detValue}>{quote.project || '—'}</div>
            </div>
          </div>

          {isVariation && (
            <div className={styles.field}>
              <label>Select Parent Job (this variation belongs to)</label>
              <select value={parentJobId} onChange={e => setParentJobId(e.target.value)}>
                <option value="">— Select parent job —</option>
                {jobs.map(j => (
                  <option key={j.id} value={j.id}>
                    {j._score >= 5 ? '★★ ' : j._score >= 2 ? '★ ' : ''}{j.job_number} — {j.client_name}{j.project ? ` · ${j.project}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className={styles.field}>
            <label>Due On-Site Date</label>
            <input type="date" value={wipDue} onChange={e => setWipDue(e.target.value)} />
          </div>

          <div className={styles.hrsSection}>
            <div className={styles.hrsSectionTitle}>Hours Allowed</div>
            <div className={styles.hrsGrid}>
              {HRS_FIELDS.map((key, i) => (
                <div key={key} className={styles.hrsBox}>
                  <label>{HRS_LABELS[i]}</label>
                  <input
                    type="number" min="0" step="0.5"
                    value={hours[key]}
                    onChange={e => setHours(h => ({ ...h, [key]: e.target.value }))}
                  />
                </div>
              ))}
              <div className={styles.hrsTotalBox}>
                <label>Total</label>
                <div className={styles.hrsTotalVal}>{totalHrs.toFixed(1)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={loading || (isVariation && !parentJobId)}>
            {loading ? 'Creating…' : 'Create Job →'}
          </button>
        </div>
      </div>
    </div>
  );
}
