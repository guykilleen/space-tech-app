import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import api from '../../utils/api';
import styles from '../Page.module.css';

function fmtMoney(v) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v || 0);
}
function fmtDate(v) {
  if (!v) return '—';
  try { return new Date(v.split('T')[0] + 'T00:00:00').toLocaleDateString('en-AU'); } catch { return v; }
}

export default function QBQuoteSummaryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    api.get(`/qb/quotes/${id}/summary`)
      .then(r => setData(r.data))
      .catch(() => toast.error('Failed to load summary'));
  }, [id]);

  async function handleDownloadPdf() {
    setDownloading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/qb/quotes/${id}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`PDF failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch {
      toast.error('Failed to generate PDF');
    } finally {
      setDownloading(false);
    }
  }

  if (!data) return <div style={{ padding: 48, color: 'var(--muted)', fontSize: '.8rem' }}>Loading…</div>;

  return (
    <div className={styles.page}>
      <div className="section-header">
        <h1 className="section-title">Quote Summary</h1>
        <span className="section-tag">{data.quote_number}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={() => navigate(`/qb/quotes/${id}`)}>← Edit</button>
          <button className="btn btn-outline" onClick={() => navigate(`/qb/quotes/${id}/budget`)}>Budget Qty →</button>
          <button type="button" className="btn btn-primary" onClick={handleDownloadPdf} disabled={downloading}>
            {downloading ? 'Generating…' : 'Download PDF'}
          </button>
        </div>
      </div>

      {/* Quote meta */}
      <div className="form-panel" style={{ marginBottom: 32 }}>
        <div className="form-panel-title">Quote Details</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: '12px 24px', fontSize: '.8rem' }}>
          {[
            ['Date',        fmtDate(data.date)],
            ['Client',      data.client_name  || '—'],
            ['Company',     data.contact_company || '—'],
            ['Project',     data.project || '—'],
            ['Prepared By', data.prepared_by || '—'],
            ['Margin',      `${(Number(data.margin) * 100).toFixed(0)}%`],
          ].map(([l, v]) => (
            <div key={l} className="field">
              <label>{l}</label>
              <div style={{ paddingTop: 6, color: 'var(--ink)', fontWeight: 500 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Units table */}
      <div className="table-wrap" style={{ marginBottom: 32 }}>
        <div className="table-toolbar">
          <span className="ttitle">Summary of Works</span>
        </div>
        <table className="std-table">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Room</th>
              <th>Level</th>
              <th>Description</th>
              <th>Drawing #</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th style={{ textAlign: 'right' }}>Unit Price</th>
              <th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {data.units.map(u => (
              <tr key={u.id}>
                <td><strong>{u.unit_number}</strong></td>
                <td>{u.room_number || '—'}</td>
                <td>{u.level || '—'}</td>
                <td>{u.description || '—'}</td>
                <td>{u.drawing_number || '—'}</td>
                <td style={{ textAlign: 'right' }}>{u.quantity}</td>
                <td className="currency">{fmtMoney(u.unit_cost)}</td>
                <td className="currency"><strong>{fmtMoney(u.total)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{
          background: 'var(--white)', border: '1px solid var(--oak-light)',
          borderRadius: 4, padding: '24px 36px', minWidth: 320,
          boxShadow: 'var(--shadow-sm)',
        }}>
          {[
            ['Subtotal (ex GST)', fmtMoney(data.subtotal)],
            ['GST (10%)',         fmtMoney(data.gst)],
          ].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: '.82rem' }}>
              <span style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', fontSize: '.68rem' }}>{l}</span>
              <strong>{v}</strong>
            </div>
          ))}
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            borderTop: '2px solid var(--oak)', paddingTop: 12, marginTop: 4,
          }}>
            <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: '1rem', color: 'var(--mid)' }}>Total (incl. GST)</span>
            <strong style={{ fontFamily: "'DM Serif Display', serif", fontSize: '1.2rem', color: 'var(--oak)' }}>
              {fmtMoney(data.total_incl_gst)}
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}
