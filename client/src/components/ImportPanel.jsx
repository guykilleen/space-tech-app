import React, { useRef, useState } from 'react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import styles from './ImportPanel.module.css';

export default function ImportPanel({ onImported }) {
  const { isAdmin, isAdminOrMgr } = useAuth();
  const fileInputRef  = useRef(null);
  const [status, setStatus] = useState({ msg: 'No file imported yet', type: '' });
  const [loading, setLoading] = useState(false);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    setStatus({ msg: '⏳ Reading file…', type: '' });
    setLoading(true);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await api.post('/import/xlsx', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const { quotesAdded, jobsAdded, skipped } = res.data;
      setStatus({
        msg: `✅ Imported ${quotesAdded} quote${quotesAdded !== 1 ? 's' : ''} + ${jobsAdded} job${jobsAdded !== 1 ? 's' : ''}${skipped ? ` (${skipped} duplicates skipped)` : ''}`,
        type: 'ok',
      });
      onImported();
    } catch (err) {
      setStatus({ msg: `❌ Error: ${err.response?.data?.error || err.message}`, type: 'err' });
    } finally {
      setLoading(false);
    }
  }

  async function handleClear() {
    if (!window.confirm('Delete ALL quotes and jobs? This cannot be undone.')) return;
    try {
      await api.delete('/import/clear-all');
      setStatus({ msg: 'Data cleared.', type: '' });
      onImported();
    } catch (err) {
      setStatus({ msg: `❌ Clear failed: ${err.response?.data?.error || err.message}`, type: 'err' });
    }
  }

  if (!isAdminOrMgr) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.text}>
        <div className={styles.title}>📥 Import from Existing Spreadsheet</div>
        <div className={styles.sub}>
          Upload your <strong>.xlsm / .xlsx</strong> file to bulk-import all data.<br />
          Reads <em>Quote No.</em> sheet → Quotes &nbsp;|&nbsp; <em>Job No.</em> + <em>WIP Yearly Calender</em> sheets → Jobs.<br />
          Duplicate quote/job numbers are skipped automatically.
        </div>
        <div className={`${styles.status}${status.type === 'ok' ? ' ' + styles.statusOk : status.type === 'err' ? ' ' + styles.statusErr : ''}`}>
          {status.msg}
        </div>
      </div>

      <div className={styles.actions}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xlsm,.xls"
          style={{ display: 'none' }}
          onChange={handleFile}
        />
        <button
          className={styles.importBtn}
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
        >
          📂 {loading ? 'Importing…' : 'Choose File & Import'}
        </button>
        {isAdmin && (
          <button className="btn-red" onClick={handleClear}>
            🗑 Clear All Data
          </button>
        )}
      </div>
    </div>
  );
}
