import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import api from '../../utils/api';
import styles from '../Page.module.css';

function fmtMoney(v) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v || 0);
}
function fmtQty(v) {
  return Number(v).toFixed(3).replace(/\.?0+$/, '');
}

export default function QBBudgetQtyPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [quoteNum, setQuoteNum] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get(`/qb/quotes/${id}/budget`),
      api.get(`/qb/quotes/${id}`),
    ])
      .then(([bRes, qRes]) => {
        setRows(bRes.data);
        setQuoteNum(qRes.data.quote_number);
      })
      .catch(() => toast.error('Failed to load budget quantities'))
      .finally(() => setLoading(false));
  }, [id]);

  const materials = rows.filter(r => r.category === 'Materials');
  const hardware  = rows.filter(r => r.category === 'Hardware');
  const grandTotal = rows.reduce((s, r) => s + Number(r.total_cost_allowed), 0);

  return (
    <div className={styles.page}>
      <div className="section-header">
        <h1 className="section-title">Budget Quantities</h1>
        <span className="section-tag">{quoteNum}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={() => navigate(`/qb/quotes/${id}`)}>← Edit</button>
          <button className="btn btn-outline" onClick={() => navigate(`/qb/quotes/${id}/summary`)}>Summary →</button>
        </div>
      </div>

      {loading ? (
        <div className="empty-state"><div className="empty-text">Loading…</div></div>
      ) : (
        <>
          {[['Materials', materials], ['Hardware', hardware]].map(([cat, items]) =>
            items.length ? (
              <div key={cat} className="table-wrap" style={{ marginBottom: 24 }}>
                <div className="table-toolbar">
                  <span className="ttitle">{cat}</span>
                </div>
                <table className="std-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th style={{ textAlign: 'right' }}>Total Qty</th>
                      <th>UOM</th>
                      <th style={{ textAlign: 'right' }}>Unit Price</th>
                      <th style={{ textAlign: 'right' }}>Total Cost Allowed</th>
                      <th style={{ textAlign: 'right' }}>Actual Order Value</th>
                      <th style={{ textAlign: 'right' }}>Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r, i) => (
                      <tr key={i}>
                        <td>{r.product}</td>
                        <td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtQty(r.total_qty)}</td>
                        <td>{r.unit_of_measure || '—'}</td>
                        <td className="currency">{fmtMoney(r.price)}</td>
                        <td className="currency"><strong>{fmtMoney(r.total_cost_allowed)}</strong></td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>—</td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{
              background: 'var(--white)', border: '1px solid var(--oak-light)',
              borderRadius: 4, padding: '16px 28px', boxShadow: 'var(--shadow-sm)',
              display: 'flex', gap: 48, alignItems: 'center',
            }}>
              <span style={{ fontSize: '.68rem', letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                Total Materials Cost Allowed
              </span>
              <strong style={{ fontSize: '1.1rem', color: 'var(--oak)' }}>{fmtMoney(grandTotal)}</strong>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
