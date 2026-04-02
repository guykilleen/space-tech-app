import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import api from '../../utils/api';
import styles from './qb.module.css';

const today = new Date().toISOString().split('T')[0];
let _tempId = 0;
const tempId = () => `_new_${++_tempId}`;

const EMPTY_LINE = () => ({
  _key: tempId(), id: null,
  price_list_id: null, category: 'Materials',
  product: '', price: 0, unit_of_measure: '', quantity: 0,
});
const EMPTY_UNIT = (n) => ({
  _key: tempId(), id: null,
  unit_number: n, drawing_number: '', room_number: '',
  level: '', description: '', quantity: 1,
  lines: [EMPTY_LINE()],
});

function fmtMoney(v) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v || 0);
}

function unitCalc(unit, margin) {
  const matSub = unit.lines.reduce((s, l) =>
    l.category === 'Materials' ? s + (Number(l.price) * Number(l.quantity)) : s, 0);
  const hwSub = unit.lines.reduce((s, l) =>
    l.category === 'Hardware' ? s + (Number(l.price) * Number(l.quantity)) : s, 0);
  const unitCost  = matSub * (1 + Number(margin)) + hwSub;
  const unitTotal = unitCost * Number(unit.quantity);
  return { matSub, hwSub, unitCost, unitTotal };
}

export default function QBQuoteBuilderPage() {
  const { id }         = useParams();
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const isNew          = !id;

  const [priceList,  setPriceList]  = useState([]);
  const [contacts,   setContacts]   = useState([]);
  const [saving,     setSaving]     = useState(false);
  const [loading,    setLoading]    = useState(!isNew);

  const [header, setHeader] = useState({
    quote_number: searchParams.get('quote_number') || '',
    date:         today,
    client_id:    '',
    project:      searchParams.get('project') || '',
    prepared_by:  '',
    margin:       0.10,
    status:       'draft',
    notes:        '',
  });

  const [units,          setUnits]          = useState([EMPTY_UNIT(1)]);
  const deletedUnitIds = useRef([]);
  const deletedLineIds = useRef([]);

  // ── Load reference data ─────────────────────────────────────────────────
  useEffect(() => {
    async function loadRef() {
      const [pl, co] = await Promise.all([
        api.get('/qb/price-list?active=true'),
        api.get('/qb/contacts'),
      ]);
      setPriceList(pl.data);
      setContacts(co.data);
    }
    loadRef().catch(() => toast.error('Failed to load reference data'));
  }, []);

  // Auto-load next number for new quotes if not pre-filled
  useEffect(() => {
    if (isNew && !header.quote_number) {
      api.get('/qb/quotes/next-number')
        .then(r => setHeader(h => ({ ...h, quote_number: r.data.next_number })))
        .catch(() => {});
    }
  }, [isNew]); // eslint-disable-line

  // ── Load existing quote ─────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.get(`/qb/quotes/${id}`)
      .then(res => {
        const q = res.data;
        setHeader({
          quote_number: q.quote_number,
          date:         q.date?.split('T')[0] || today,
          client_id:    q.client_id || '',
          project:      q.project || '',
          prepared_by:  q.prepared_by || '',
          margin:       q.margin ?? 0.10,
          status:       q.status,
          notes:        q.notes || '',
        });
        setUnits(q.units.map(u => ({
          ...u,
          _key: u.id,
          lines: (u.lines || []).map(l => ({ ...l, _key: l.id })),
        })));
        deletedUnitIds.current = [];
        deletedLineIds.current = [];
      })
      .catch(() => toast.error('Failed to load quote'))
      .finally(() => setLoading(false));
  }, [id]);

  // ── Header helpers ──────────────────────────────────────────────────────
  const setH = (field, val) => setHeader(h => ({ ...h, [field]: val }));

  // ── Unit helpers ────────────────────────────────────────────────────────
  function addUnit() {
    const nextNum = units.length ? Math.max(...units.map(u => u.unit_number)) + 1 : 1;
    setUnits(u => [...u, EMPTY_UNIT(nextNum)]);
  }

  function removeUnit(key) {
    setUnits(u => {
      const target = u.find(x => x._key === key);
      if (target?.id) deletedUnitIds.current.push(target.id);
      return u.filter(x => x._key !== key);
    });
  }

  function setUnit(key, field, val) {
    setUnits(u => u.map(x => x._key === key ? { ...x, [field]: val } : x));
  }

  // ── Line helpers ────────────────────────────────────────────────────────
  function addLine(unitKey) {
    setUnits(u => u.map(x => x._key === unitKey
      ? { ...x, lines: [...x.lines, EMPTY_LINE()] }
      : x));
  }

  function removeLine(unitKey, lineKey) {
    setUnits(u => u.map(x => {
      if (x._key !== unitKey) return x;
      const target = x.lines.find(l => l._key === lineKey);
      if (target?.id) deletedLineIds.current.push(target.id);
      return { ...x, lines: x.lines.filter(l => l._key !== lineKey) };
    }));
  }

  function setLine(unitKey, lineKey, field, val) {
    setUnits(u => u.map(x => {
      if (x._key !== unitKey) return x;
      return {
        ...x,
        lines: x.lines.map(l => l._key !== lineKey ? l : { ...l, [field]: val }),
      };
    }));
  }

  function pickProduct(unitKey, lineKey, plId) {
    const item = priceList.find(p => p.id === plId);
    if (!item) return;
    setUnits(u => u.map(x => {
      if (x._key !== unitKey) return x;
      return {
        ...x,
        lines: x.lines.map(l => l._key !== lineKey ? l : {
          ...l,
          price_list_id: item.id,
          category: item.category,
          product: item.product,
          price: item.price,
          unit_of_measure: item.unit || '',
        }),
      };
    }));
  }

  // ── Save ────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!header.quote_number.trim()) return toast.error('Quote number required');
    setSaving(true);
    try {
      const body = {
        ...header,
        margin:            Number(header.margin),
        client_id:         header.client_id || null,
        units:             units.map((u, i) => ({
          id:             u.id || undefined,
          unit_number:    u.unit_number,
          drawing_number: u.drawing_number,
          room_number:    u.room_number,
          level:          u.level,
          description:    u.description,
          quantity:       Number(u.quantity),
          sort_order:     i,
          lines:          u.lines.map((l, j) => ({
            id:             l.id || undefined,
            price_list_id:  l.price_list_id || null,
            category:       l.category,
            product:        l.product,
            price:          Number(l.price),
            unit_of_measure: l.unit_of_measure,
            quantity:       Number(l.quantity),
            sort_order:     j,
          })).filter(l => l.product.trim()),
        })),
        deleted_unit_ids: deletedUnitIds.current,
        deleted_line_ids: deletedLineIds.current,
      };

      let res;
      if (isNew) {
        res = await api.post('/qb/quotes', body);
        toast.success('Quote created');
        navigate(`/qb/quotes/${res.data.id}`, { replace: true });
      } else {
        res = await api.put(`/qb/quotes/${id}`, body);
        toast.success('Quote saved');
        // Re-sync IDs
        const q = res.data;
        setUnits(q.units.map(u => ({
          ...u, _key: u.id,
          lines: (u.lines || []).map(l => ({ ...l, _key: l.id })),
        })));
        deletedUnitIds.current = [];
        deletedLineIds.current = [];
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [header, units, id, isNew, navigate]);

  // ── Derived totals ──────────────────────────────────────────────────────
  const margin    = Number(header.margin);
  const subtotal  = units.reduce((s, u) => s + unitCalc(u, margin).unitTotal, 0);
  const gst       = subtotal * 0.10;
  const totalIncl = subtotal + gst;

  if (loading) return <div className={styles.loadingMsg}>Loading quote…</div>;

  return (
    <div className={styles.builderPage}>

      {/* ── Header ── */}
      <div className={styles.builderHeader}>
        <div className={styles.builderTitle}>
          {isNew ? 'New Quote' : `Editing ${header.quote_number}`}
        </div>
        <div className={styles.builderActions}>
          {!isNew && (
            <>
              <button className="btn btn-outline" onClick={() => navigate(`/qb/quotes/${id}/summary`)}>Summary →</button>
              <button className="btn btn-outline" onClick={() => navigate(`/qb/quotes/${id}/budget`)}>Budget Qty →</button>
              <a className="btn btn-outline" href={`/api/qb/quotes/${id}/pdf`} target="_blank" rel="noreferrer">PDF →</a>
            </>
          )}
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Create Quote' : 'Save Quote'}
          </button>
        </div>
      </div>

      {/* ── Quote details ── */}
      <div className="form-panel">
        <div className="form-panel-title">Quote Details</div>
        <div className="form-grid cols-4">
          <div className="field">
            <label>Quote Number</label>
            <input value={header.quote_number} onChange={e => setH('quote_number', e.target.value)} placeholder="V-0001" />
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" value={header.date} onChange={e => setH('date', e.target.value)} />
          </div>
          <div className="field">
            <label>Status</label>
            <select value={header.status} onChange={e => setH('status', e.target.value)}>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="accepted">Accepted</option>
              <option value="declined">Declined</option>
            </select>
          </div>
          <div className="field">
            <label>Margin (%)</label>
            <input
              type="number" step="0.01" min="0" max="1"
              value={header.margin}
              onChange={e => setH('margin', e.target.value)}
            />
          </div>

          <div className="field span-2">
            <label>Client</label>
            <select value={header.client_id} onChange={e => setH('client_id', e.target.value)}>
              <option value="">— Select contact —</option>
              {contacts.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.company ? ` — ${c.company}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field span-2">
            <label>Project</label>
            <input value={header.project} onChange={e => setH('project', e.target.value)} placeholder="Project name or address" />
          </div>

          <div className="field span-2">
            <label>Prepared By</label>
            <input value={header.prepared_by} onChange={e => setH('prepared_by', e.target.value)} placeholder="e.g. Guy Killeen" />
          </div>
          <div className="field span-2">
            <label>Notes</label>
            <input value={header.notes} onChange={e => setH('notes', e.target.value)} placeholder="Internal notes or client-facing exclusions" />
          </div>
        </div>
      </div>

      {/* ── Units ── */}
      {units.map((unit, ui) => {
        const { matSub, hwSub, unitTotal } = unitCalc(unit, margin);
        return (
          <div key={unit._key} className={styles.unitCard}>
            <div className={styles.unitCardHeader}>
              <div className={styles.unitNum}>Unit {unit.unit_number}</div>
              <div className={styles.unitMeta}>
                <div className={styles.unitField}>
                  <label>Drawing #</label>
                  <input value={unit.drawing_number} onChange={e => setUnit(unit._key, 'drawing_number', e.target.value)} placeholder="D.01" />
                </div>
                <div className={styles.unitField}>
                  <label>Room</label>
                  <input value={unit.room_number} onChange={e => setUnit(unit._key, 'room_number', e.target.value)} placeholder="Kitchen" />
                </div>
                <div className={styles.unitField}>
                  <label>Level</label>
                  <input value={unit.level} onChange={e => setUnit(unit._key, 'level', e.target.value)} placeholder="L1" />
                </div>
                <div className={styles.unitField} style={{ flex: 2 }}>
                  <label>Description</label>
                  <input value={unit.description} onChange={e => setUnit(unit._key, 'description', e.target.value)} placeholder="e.g. Tas Oak veneer on 40mm LDF joinery" />
                </div>
                <div className={styles.unitField} style={{ width: 80 }}>
                  <label>Qty</label>
                  <input type="number" min="0" step="1" value={unit.quantity} onChange={e => setUnit(unit._key, 'quantity', e.target.value)} />
                </div>
              </div>
              {units.length > 1 && (
                <button className={styles.removeUnit} onClick={() => removeUnit(unit._key)} title="Remove unit">✕</button>
              )}
            </div>

            {/* Lines table */}
            <table className={styles.linesTable}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th style={{ width: 80 }}>Qty</th>
                  <th style={{ width: 100 }}>Price</th>
                  <th style={{ width: 60 }}>UOM</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Total</th>
                  <th style={{ width: 32 }}></th>
                </tr>
              </thead>
              <tbody>
                {unit.lines.map(line => (
                  <tr key={line._key}>
                    <td>
                      <select
                        className={styles.productSelect}
                        value={line.price_list_id || ''}
                        onChange={e => {
                          if (e.target.value === '__custom') {
                            setLine(unit._key, line._key, 'price_list_id', null);
                          } else {
                            pickProduct(unit._key, line._key, e.target.value);
                          }
                        }}
                      >
                        <option value="">— pick from list —</option>
                        <option value="__custom">Custom item…</option>
                        {['Materials', 'Hardware'].map(cat => {
                          const items = priceList.filter(p => p.category === cat);
                          if (!items.length) return null;
                          return (
                            <optgroup key={cat} label={cat}>
                              {items.map(p => (
                                <option key={p.id} value={p.id}>{p.product} ({p.unit})</option>
                              ))}
                            </optgroup>
                          );
                        })}
                      </select>
                      {!line.price_list_id && (
                        <input
                          className={styles.customProduct}
                          value={line.product}
                          onChange={e => setLine(unit._key, line._key, 'product', e.target.value)}
                          placeholder="Product description"
                        />
                      )}
                    </td>
                    <td>
                      <select
                        value={line.category}
                        onChange={e => setLine(unit._key, line._key, 'category', e.target.value)}
                        style={{ width: 110 }}
                      >
                        <option value="Materials">Materials</option>
                        <option value="Hardware">Hardware</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="number" min="0" step="any"
                        value={line.quantity}
                        onChange={e => setLine(unit._key, line._key, 'quantity', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number" min="0" step="any"
                        value={line.price}
                        onChange={e => setLine(unit._key, line._key, 'price', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        value={line.unit_of_measure}
                        onChange={e => setLine(unit._key, line._key, 'unit_of_measure', e.target.value)}
                        placeholder="m2"
                        style={{ width: 56 }}
                      />
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 500 }}>
                      {fmtMoney(Number(line.price) * Number(line.quantity))}
                    </td>
                    <td>
                      <button className={styles.removeLine} onClick={() => removeLine(unit._key, line._key)} title="Remove line">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className={styles.unitFooter}>
              <button className={styles.addLineBtn} onClick={() => addLine(unit._key)}>+ Add Line</button>
              <div className={styles.unitTotals}>
                <span>Materials sub: <strong>{fmtMoney(matSub)}</strong></span>
                <span>Hardware sub: <strong>{fmtMoney(hwSub)}</strong></span>
                <span>Unit cost × {unit.quantity}: <strong>{fmtMoney(unitTotal)}</strong></span>
              </div>
            </div>
          </div>
        );
      })}

      <button className={styles.addUnitBtn} onClick={addUnit}>+ Add Unit</button>

      {/* ── Quote totals ── */}
      <div className={styles.quoteTotals}>
        <div className={styles.totalsRow}><span>Subtotal (ex GST)</span><strong>{fmtMoney(subtotal)}</strong></div>
        <div className={styles.totalsRow}><span>GST (10%)</span><strong>{fmtMoney(gst)}</strong></div>
        <div className={`${styles.totalsRow} ${styles.totalsGrand}`}><span>Total (incl. GST)</span><strong>{fmtMoney(totalIncl)}</strong></div>
      </div>

      <div className="btn-row" style={{ marginTop: 32, marginBottom: 48 }}>
        {!isNew && (
          <>
            <button className="btn btn-outline" onClick={() => navigate(`/qb/quotes/${id}/summary`)}>View Summary →</button>
            <button className="btn btn-outline" onClick={() => navigate(`/qb/quotes/${id}/budget`)}>Budget Quantities →</button>
          </>
        )}
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isNew ? 'Create Quote' : 'Save Quote'}
        </button>
      </div>
    </div>
  );
}
