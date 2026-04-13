import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import api from '../../utils/api';
import styles from './qb.module.css';

function fmtMoney(v) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v || 0);
}
function fmtQty(v) {
  return Number(v).toFixed(3).replace(/\.?0+$/, '');
}

export default function QBBudgetQtyPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [quoteNum, setQuoteNum] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get(`/qb/quotes/${id}/budget`),
      api.get(`/qb/quotes/${id}`),
    ])
      .then(([bRes, qRes]) => {
        setData(bRes.data);
        setQuoteNum(qRes.data.quote_number);
      })
      .catch(() => toast.error('Failed to load budget quantities'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className={styles.loadingMsg}>Loading…</div>
  );

  const { margin, waste_pct, lines, labour, subtrades = [], totals } = data;
  const materials = lines.filter(r => r.category === 'Materials');
  const hardware  = lines.filter(r => r.category === 'Hardware');

  const SUBTRADE_LABELS = {
    '2pac_flat':     '2 Pac Flat',
    '2pac_recessed': '2 Pac Recessed',
    'stone':         'Stone',
    'upholstery':    'Upholstery',
    'glass':         'Glass',
    'steel':         'Steel',
  };

  const labourRows = [
    { label: 'Admin',        hoursField: 'admin_hours',        costField: 'admin_cost' },
    { label: 'CNC',          hoursField: 'cnc_hours',          costField: 'cnc_cost' },
    { label: 'Edgebander',   hoursField: 'edgebander_hours',   costField: 'edgebander_cost' },
    { label: 'Assembly',     hoursField: 'assembly_hours',     costField: 'assembly_cost' },
    { label: 'Delivery',     hoursField: 'delivery_hours',     costField: 'delivery_cost' },
    { label: 'Installation', hoursField: 'installation_hours', costField: 'installation_cost' },
  ];

  const tableClass = 'std-table';

  return (
    <div className={styles.builderPage}>
      <div className={styles.builderHeader}>
        <div className={styles.builderTitle}>Budget Quantities — {quoteNum}</div>
        <div className={styles.builderActions}>
          <button className="btn btn-outline" onClick={() => navigate(`/qb/quotes/${id}`)}>← Edit</button>
          <button className="btn btn-outline" onClick={() => navigate(`/qb/quotes/${id}/summary`)}>Summary →</button>
        </div>
      </div>

      {/* Materials */}
      {materials.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 24 }}>
          <div className="table-toolbar">
            <span className="ttitle">Materials</span>
            <span style={{ marginLeft: 'auto', fontSize: '.68rem', color: 'var(--muted)' }}>
              Raw cost — margin applied in summary below
            </span>
          </div>
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table className={tableClass}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Product</th>
                <th style={{ textAlign: 'right' }}>Total Qty</th>
                <th style={{ textAlign: 'left' }}>UOM</th>
                <th style={{ textAlign: 'right' }}>Unit Price</th>
                <th style={{ textAlign: 'right' }}>Cost Allowed</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((r, i) => (
                <tr key={i}>
                  <td>{r.product}</td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtQty(r.total_qty)}</td>
                  <td>{r.unit_of_measure || '—'}</td>
                  <td className="currency">{fmtMoney(r.price)}</td>
                  <td className="currency"><strong>{fmtMoney(r.total_cost_allowed)}</strong></td>
                </tr>
              ))}
              <tr style={{ background: 'var(--sawdust)', fontWeight: 600 }}>
                <td colSpan={4} style={{ textAlign: 'right', fontSize: '.7rem', letterSpacing: '.1em', color: 'var(--muted)', textTransform: 'uppercase' }}>
                  Materials subtotal
                </td>
                <td className="currency">{fmtMoney(totals.materials)}</td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Hardware */}
      {hardware.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 24 }}>
          <div className="table-toolbar">
            <span className="ttitle">Hardware</span>
          </div>
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table className={tableClass}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Product</th>
                <th style={{ textAlign: 'right' }}>Total Qty</th>
                <th style={{ textAlign: 'left' }}>UOM</th>
                <th style={{ textAlign: 'right' }}>Unit Price</th>
                <th style={{ textAlign: 'right' }}>Cost Allowed</th>
              </tr>
            </thead>
            <tbody>
              {hardware.map((r, i) => (
                <tr key={i}>
                  <td>{r.product}</td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtQty(r.total_qty)}</td>
                  <td>{r.unit_of_measure || '—'}</td>
                  <td className="currency">{fmtMoney(r.price)}</td>
                  <td className="currency"><strong>{fmtMoney(r.total_cost_allowed)}</strong></td>
                </tr>
              ))}
              <tr style={{ background: 'var(--sawdust)', fontWeight: 600 }}>
                <td colSpan={4} style={{ textAlign: 'right', fontSize: '.7rem', letterSpacing: '.1em', color: 'var(--muted)', textTransform: 'uppercase' }}>
                  Hardware subtotal
                </td>
                <td className="currency">{fmtMoney(totals.hardware)}</td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Labour */}
      <div className="table-wrap" style={{ marginBottom: 32 }}>
        <div className="table-toolbar">
          <span className="ttitle">Labour</span>
        </div>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table className={tableClass}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Type</th>
              <th style={{ textAlign: 'right' }}>Total Hours</th>
              <th style={{ textAlign: 'right' }}>Cost Allowed</th>
            </tr>
          </thead>
          <tbody>
            {labourRows.map(({ label, hoursField, costField }) => (
              <tr key={hoursField}>
                <td>{label}</td>
                <td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtQty(labour[hoursField])}</td>
                <td className="currency"><strong>{fmtMoney(labour[costField])}</strong></td>
              </tr>
            ))}
            <tr style={{ background: 'var(--sawdust)', fontWeight: 600 }}>
              <td colSpan={2} style={{ textAlign: 'right', fontSize: '.7rem', letterSpacing: '.1em', color: 'var(--muted)', textTransform: 'uppercase' }}>
                Labour subtotal
              </td>
              <td className="currency">{fmtMoney(totals.labour)}</td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>

      {/* Subtrades */}
      {subtrades.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 32 }}>
          <div className="table-toolbar">
            <span className="ttitle">Subtrades</span>
          </div>
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table className={tableClass}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Item</th>
                <th style={{ textAlign: 'right' }}>Cost (before margin)</th>
                <th style={{ textAlign: 'right' }}>Sell (after margin)</th>
              </tr>
            </thead>
            <tbody>
              {subtrades.map(r => (
                <tr key={r.type}>
                  <td>{SUBTRADE_LABELS[r.type] || r.type}</td>
                  <td className="currency">{fmtMoney(r.total_cost)}</td>
                  <td className="currency"><strong>{fmtMoney(r.total_sell)}</strong></td>
                </tr>
              ))}
              <tr style={{ background: 'var(--sawdust)', fontWeight: 600 }}>
                <td style={{ textAlign: 'right', fontSize: '.7rem', letterSpacing: '.1em', color: 'var(--muted)', textTransform: 'uppercase' }}>
                  Subtrades subtotal
                </td>
                <td className="currency">{fmtMoney(totals.subtrades_cost)}</td>
                <td className="currency">{fmtMoney(totals.subtrades_sell)}</td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Cost summary */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div className={styles.budgetSummary}>
          <div className={styles.budgetSummaryTitle}>Project Cost Summary</div>

          <div className={styles.budgetSummaryRow}>
            <span>Materials (raw)</span>
            <strong>{fmtMoney(totals.materials_raw)}</strong>
          </div>
          <div className={styles.budgetSummaryRow}>
            <span>Waste ({(waste_pct * 100).toFixed(0)}%)</span>
            <strong>{fmtMoney(totals.waste_amount)}</strong>
          </div>
          <div className={`${styles.budgetSummaryRow} ${styles.budgetSubline}`}>
            <span>Materials inc. waste</span>
            <strong>{fmtMoney(totals.materials)}</strong>
          </div>
          <div className={styles.budgetSummaryRow}>
            <span>Hardware</span>
            <strong>{fmtMoney(totals.hardware)}</strong>
          </div>
          <div className={`${styles.budgetSummaryRow} ${styles.budgetSubline}`}>
            <span>Labour</span>
            <strong>{fmtMoney(totals.labour)}</strong>
          </div>
          <div className={styles.budgetSummaryRow}>
            <span>Total costs</span>
            <strong>{fmtMoney(totals.costs_total)}</strong>
          </div>
          <div className={`${styles.budgetSummaryRow} ${styles.budgetSummarySubtotal}`}>
            <span>Profit margin ({(margin * 100).toFixed(0)}%)</span>
            <strong>{fmtMoney(totals.margin_amount)}</strong>
          </div>
          {totals.subtrades_sell > 0 && (
            <div className={`${styles.budgetSummaryRow} ${styles.budgetSubline}`}>
              <span>Subtrades (incl. margin)</span>
              <strong>{fmtMoney(totals.subtrades_sell)}</strong>
            </div>
          )}
          <div className={styles.budgetSummaryRow}>
            <span>Subtotal (ex GST)</span>
            <strong>{fmtMoney(totals.subtotal)}</strong>
          </div>
          <div className={styles.budgetSummaryRow}>
            <span>GST (10%)</span>
            <strong>{fmtMoney(totals.gst)}</strong>
          </div>
          <div className={`${styles.budgetSummaryRow} ${styles.budgetSummaryGrand}`}>
            <span>Total (incl. GST)</span>
            <strong>{fmtMoney(totals.total)}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
