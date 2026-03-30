import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import { toast } from 'react-toastify';
import styles from './JobCreateModal.module.css';

// Modal triggered when a quote is accepted → offer to create a job
// VQ-prefix quotes are variation quotes → let user pick a parent job
export default function JobCreateModal({ quote, onClose, onCreated }) {
  const isVariation = (quote.quote_number || '').toUpperCase().startsWith('VQ');
  const [wipDue, setWipDue]         = useState('');
  const [parentJobId, setParentJobId] = useState('');
  const [jobs, setJobs]             = useState([]);
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    if (isVariation) {
      api.get('/jobs', { params: { wip_completed: false } })
        .then(r => setJobs(r.data.filter(j => !j.parent_job_id))); // base jobs only
    }
  }, [isVariation]);

  async function handleCreate() {
    setLoading(true);
    try {
      // Ensure quote is marked accepted
      await api.patch(`/quotes/${quote.id}/status`, { status: 'accepted' }).catch(() => {});
      const job = await api.post(`/jobs/convert-quote/${quote.id}`, {
        parent_job_id: parentJobId || undefined,
        wip_due: wipDue || undefined,
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
                {jobs.map(j => {
                  const matched = (j.client_name||'').toLowerCase() === (quote.client_name||'').toLowerCase();
                  return (
                    <option key={j.id} value={j.id}>
                      {j.job_number} — {j.project || j.client_name}{matched ? ' ★' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          <div className={styles.field}>
            <label>Due On-Site Date</label>
            <input type="date" value={wipDue} onChange={e => setWipDue(e.target.value)} />
          </div>
        </div>

        <div className={styles.footer}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={loading || (isVariation && !parentJobId)}>
            {loading ? 'Creating…' : `Create Job →`}
          </button>
        </div>
      </div>
    </div>
  );
}
