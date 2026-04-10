import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQBDirty } from '../../context/QBDirtyContext';
import { toast } from 'react-toastify';
import api from '../../utils/api';
import styles from './qb.module.css';
import JobCreateModal from '../../components/JobCreateModal';

const today = new Date().toISOString().split('T')[0];
let _tempId = 0;
const tempId = () => `_new_${++_tempId}`;

const EMPTY_LINE = () => ({
  _key: tempId(), id: null,
  price_list_id: null, category: 'Materials',
  product: '', price: 0, unit_of_measure: '', quantity: 0,
  price_overridden: false,
});

const EMPTY_UNIT = (n) => ({
  _key: tempId(), id: null,
  unit_number: n, drawing_number: '', room_number: '',
  level: '', description: '', quantity: 1,
  admin_hours: 0, cnc_hours: 0, edgebander_hours: 0, assembly_hours: 0,
  delivery_hours: 0, installation_hours: 0,
  admin_rate_overridden: false, cnc_rate_overridden: false,
  edgebander_rate_overridden: false, assembly_rate_overridden: false,
  delivery_rate_overridden: false, installation_rate_overridden: false,
  subtrade_margin: 0,
  subtrades: SUBTRADE_ITEMS.map(s => EMPTY_SUBTRADE(s.type)),
  lines: [], // populated with defaults once priceList loads
});

const LABOUR_FIELDS = [
  { hoursField: 'admin_hours',        rateField: 'admin_rate',        type: 'admin',        label: 'Admin' },
  { hoursField: 'cnc_hours',          rateField: 'cnc_rate',          type: 'cnc',          label: 'CNC' },
  { hoursField: 'edgebander_hours',   rateField: 'edgebander_rate',   type: 'edgebander',   label: 'Edgebander' },
  { hoursField: 'assembly_hours',     rateField: 'assembly_rate',     type: 'assembly',     label: 'Assembly' },
  { hoursField: 'delivery_hours',     rateField: 'delivery_rate',     type: 'delivery',     label: 'Delivery' },
  { hoursField: 'installation_hours', rateField: 'installation_rate', type: 'installation', label: 'Installation' },
];

const SUBTRADE_ITEMS = [
  { type: '2pac_flat',     label: '2 Pac Flat' },
  { type: '2pac_recessed', label: '2 Pac Recessed' },
  { type: 'stone',         label: 'Stone' },
  { type: 'upholstery',    label: 'Upholstery' },
  { type: 'glass',         label: 'Glass' },
  { type: 'steel',         label: 'Steel' },
];
const EMPTY_SUBTRADE = (type) => ({ type, mode: 'fixed', cost: '', quantity: '', rate: '' });

// ── Default pre-populated lines ─────────────────────────────────────────────
const DEFAULT_MAT_NAMES = [
  '16mm HMR White', '16mm HMR Black', '25mm HMR White',
  'Polytec 162412 Matt', 'Polytec 162412 WM',
  '18mm STD MDF', '16mm STD MDF',
  '22x1 ABS', '22x1 ABS Colour',
];
const DEFAULT_HW_NAMES = [
  'Handle', 'Tip On Push to Open', 'Std Finista', 'Gallery Finista', 'Pot Finista',
  '110 Degree Hinges', '170 & Cnr Hinges', 'Sauth Vagel Bin w Inner', 'Cutlery Tray',
  'KD & Rafix', 'Freight Charge', 'Sundry Expenses',
];

function buildDefaultLines(priceList) {
  const lines = [];
  for (const name of DEFAULT_MAT_NAMES) {
    const item = priceList.find(p => p.product === name && p.category === 'Materials');
    if (item) lines.push({
      _key: tempId(), id: null,
      price_list_id: item.id, category: item.category,
      product: item.product, price: Number(item.price),
      unit_of_measure: item.unit || '', quantity: 0, price_overridden: false,
    });
  }
  for (const name of DEFAULT_HW_NAMES) {
    const item = priceList.find(p => p.product === name && p.category === 'Hardware');
    if (item) lines.push({
      _key: tempId(), id: null,
      price_list_id: item.id, category: item.category,
      product: item.product, price: Number(item.price),
      unit_of_measure: item.unit || '', quantity: 0, price_overridden: false,
    });
  }
  return lines;
}

// Merges missing default lines (at qty=0) into an existing set of saved lines.
function mergeWithDefaults(lines, priceList) {
  const defaults = buildDefaultLines(priceList);
  const result = [...lines];
  for (const def of defaults) {
    const alreadyPresent = lines.some(l => l.price_list_id === def.price_list_id);
    if (!alreadyPresent) result.push(def);
  }
  return result;
}

function fmtMoney(v) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v || 0);
}

// Use per-unit stored rate snapshot for existing units; fall back to current global rates for new units
function unitCalc(unit, margin, wastePct, labourRates) {
  const R = (rateField, type) => Number(unit[rateField] ?? labourRates[type] ?? 100);
  const matSub    = unit.lines.reduce((s, l) =>
    l.category === 'Materials' ? s + (Number(l.price) * Number(l.quantity)) : s, 0);
  const hwSub     = unit.lines.reduce((s, l) =>
    l.category === 'Hardware'  ? s + (Number(l.price) * Number(l.quantity)) : s, 0);
  const wasteSub  = matSub * (Number(wastePct) / 100);
  const labourSub = LABOUR_FIELDS.reduce((s, { hoursField, rateField, type }) =>
    s + Number(unit[hoursField] ?? 0) * R(rateField, type), 0);
  const subtradeCost = (unit.subtrades || []).reduce((s, st) =>
    s + (st.mode === 'qty_rate'
      ? (Number(st.quantity) || 0) * (Number(st.rate) || 0)
      : (Number(st.cost) || 0)), 0);
  const subtradeSell = subtradeCost * (1 + Number(unit.subtrade_margin || 0) / 100);
  const unitCost  = (matSub + wasteSub + hwSub + labourSub) * (1 + Number(margin) / 100) + subtradeSell;
  const unitTotal = unitCost * Number(unit.quantity);
  return { matSub, wasteSub, hwSub, labourSub, subtradeCost, subtradeSell, unitCost, unitTotal };
}

function mapUnit(u) {
  return {
    ...u,
    _key: u.id,
    drawing_number:     u.drawing_number     ?? '',
    room_number:        u.room_number        ?? '',
    level:              u.level              ?? '',
    description:        u.description        ?? '',
    admin_hours:        u.admin_hours        ?? 0,
    cnc_hours:          u.cnc_hours          ?? 0,
    edgebander_hours:   u.edgebander_hours   ?? 0,
    assembly_hours:     u.assembly_hours     ?? 0,
    delivery_hours:     u.delivery_hours     ?? 0,
    installation_hours: u.installation_hours ?? 0,
    admin_rate:         Number(u.admin_rate        ?? 100),
    cnc_rate:           Number(u.cnc_rate          ?? 100),
    edgebander_rate:    Number(u.edgebander_rate   ?? 100),
    assembly_rate:      Number(u.assembly_rate     ?? 100),
    delivery_rate:      Number(u.delivery_rate     ?? 100),
    installation_rate:  Number(u.installation_rate ?? 100),
    admin_rate_overridden:        u.admin_rate_overridden        ?? false,
    cnc_rate_overridden:          u.cnc_rate_overridden          ?? false,
    edgebander_rate_overridden:   u.edgebander_rate_overridden   ?? false,
    assembly_rate_overridden:     u.assembly_rate_overridden     ?? false,
    delivery_rate_overridden:     u.delivery_rate_overridden     ?? false,
    installation_rate_overridden: u.installation_rate_overridden ?? false,
    subtrade_margin: Number(u.subtrade_margin ?? 0) * 100,
    subtrades: SUBTRADE_ITEMS.map(s => {
      const found = (u.subtrades || []).find(st => st.type === s.type);
      return found
        ? { type: s.type, mode: found.mode, cost: found.cost, quantity: found.quantity, rate: found.rate }
        : EMPTY_SUBTRADE(s.type);
    }),
    lines: (u.lines || []).map(l => ({
      ...l,
      _key:            l.id,
      product:         l.product         ?? '',
      unit_of_measure: l.unit_of_measure ?? '',
      price_overridden: l.price_overridden ?? false,
    })),
  };
}

export default function QBQuoteBuilderPage() {
  const { id }         = useParams();
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const isNew          = !id;

  const [priceList,    setPriceList]    = useState([]);
  const [contacts,     setContacts]     = useState([]);
  const [labourRates,  setLabourRates]  = useState({});
  const [saving,       setSaving]       = useState(false);
  const [loading,      setLoading]      = useState(!isNew);
  const [linkedQuoteId,   setLinkedQuoteId]   = useState(null);
  const [jtClientName,    setJtClientName]    = useState('');
  const [rateDiff,     setRateDiff]     = useState(null); // { unitId, unitNum, materials, labour }
  const [syncing,      setSyncing]      = useState(false);
  const [pdfLoading,   setPdfLoading]   = useState(false);
  const [jobModal,     setJobModal]     = useState(null);
  const savedStatusRef = useRef(null); // tracks last-saved QB status to detect accepted transition

  const [header, setHeader] = useState({
    quote_number: searchParams.get('quote_number') || '',
    date:         today,
    client_id:    '',
    project:      searchParams.get('project') || '',
    prepared_by:  '',
    margin:       15,
    waste_pct:    10,
    status:       'draft',
    notes:        '',
  });

  const [units,          setUnits]          = useState([EMPTY_UNIT(1)]);
  const deletedUnitIds = useRef([]);
  const deletedLineIds = useRef([]);
  const { isDirty, setIsDirty } = useQBDirty();

  // Rates are locked on accepted quotes only
  const isLocked = header.status === 'accepted';

  // ── Load reference data ─────────────────────────────────────────────────
  useEffect(() => {
    async function loadRef() {
      const [pl, co, lr] = await Promise.all([
        api.get('/qb/price-list?active=true'),
        api.get('/qb/contacts'),
        api.get('/qb/labour-rates'),
      ]);
      setPriceList(pl.data);
      setContacts(co.data);
      setLabourRates(lr.data);
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
        setLinkedQuoteId(q.quote_id || null);
        setJtClientName(q.jt_client_name || '');
        savedStatusRef.current = q.status;
        setHeader({
          quote_number: q.quote_number,
          date:         q.date?.split('T')[0] || today,
          client_id:    q.client_id || '',
          project:      q.project || '',
          prepared_by:  q.prepared_by || '',
          margin:       (q.margin ?? 0.10) * 100,
          waste_pct:    (q.waste_pct ?? 0.05) * 100,
          status:       q.status,
          notes:        q.notes || '',
        });
        setUnits(q.units.map(u => { const m = mapUnit(u); return { ...m, lines: mergeWithDefaults(m.lines, priceList) }; }));
        deletedUnitIds.current = [];
        deletedLineIds.current = [];
        setIsDirty(false);
      })
      .catch(() => toast.error('Failed to load quote'))
      .finally(() => setLoading(false));
  }, [id]);

  // ── Merge defaults when priceList loads ────────────────────────────────
  // Handles both new quotes (lines: []) and existing quotes where priceList
  // arrives after the quote data. If priceList arrives first, the mapUnit
  // call sites below merge inline; this effect handles the reverse order.
  useEffect(() => {
    if (!priceList.length) return;
    setUnits(prev => prev.map(u => ({
      ...u,
      lines: mergeWithDefaults(u.lines, priceList),
    })));
  }, [priceList]); // eslint-disable-line

  // ── Unsaved-changes guard ───────────────────────────────────────────────
  // Browser tab close / refresh
  useEffect(() => {
    const handler = (e) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Clear dirty when builder unmounts (user confirmed leave via sidebar/switcher)
  useEffect(() => () => setIsDirty(false), []); // eslint-disable-line

  const CONFIRM_MSG = 'You have unsaved changes. Are you sure you want to leave? Your changes will be lost.';
  function safeNavigate(to, opts) {
    if (isDirty && !window.confirm(CONFIRM_MSG)) return;
    navigate(to, opts);
  }

  // ── Header helpers ──────────────────────────────────────────────────────
  const setH = (field, val) => { setIsDirty(true); setHeader(h => ({ ...h, [field]: val })); };

  // ── Unit helpers ────────────────────────────────────────────────────────
  function addUnit() {
    setIsDirty(true);
    const nextNum = units.length ? Math.max(...units.map(u => u.unit_number)) + 1 : 1;
    const unit = EMPTY_UNIT(nextNum);
    unit.lines = buildDefaultLines(priceList);
    setUnits(u => [...u, unit]);
  }

  function removeUnit(key) {
    setIsDirty(true);
    setUnits(u => {
      const target = u.find(x => x._key === key);
      if (target?.id) deletedUnitIds.current.push(target.id);
      return u.filter(x => x._key !== key);
    });
  }

  function setUnit(key, field, val) {
    setIsDirty(true);
    setUnits(u => u.map(x => x._key === key ? { ...x, [field]: val } : x));
  }

  // Sets a labour rate and marks it as manually overridden
  function handleLabourRateChange(unitKey, rateField, type, val) {
    setIsDirty(true);
    setUnits(u => u.map(x => x._key !== unitKey ? x : {
      ...x,
      [rateField]: val,
      [`${type}_rate_overridden`]: true,
    }));
  }

  // ── Line helpers ────────────────────────────────────────────────────────
  function addLine(unitKey) {
    setIsDirty(true);
    setUnits(u => u.map(x => x._key === unitKey
      ? { ...x, lines: [...x.lines, EMPTY_LINE()] }
      : x));
  }

  function removeLine(unitKey, lineKey) {
    setIsDirty(true);
    setUnits(u => u.map(x => {
      if (x._key !== unitKey) return x;
      const target = x.lines.find(l => l._key === lineKey);
      if (target?.id) deletedLineIds.current.push(target.id);
      return { ...x, lines: x.lines.filter(l => l._key !== lineKey) };
    }));
  }

  function setLine(unitKey, lineKey, field, val) {
    setIsDirty(true);
    setUnits(u => u.map(x => {
      if (x._key !== unitKey) return x;
      return {
        ...x,
        lines: x.lines.map(l => l._key !== lineKey ? l : { ...l, [field]: val }),
      };
    }));
  }

  function setSubtrade(unitKey, type, field, val) {
    setIsDirty(true);
    setUnits(u => u.map(x => {
      if (x._key !== unitKey) return x;
      return {
        ...x,
        subtrades: x.subtrades.map(st => st.type !== type ? st : { ...st, [field]: val }),
      };
    }));
  }

  // Sets price and marks as overridden when the line is linked to the price list
  function setLinePrice(unitKey, lineKey, val) {
    setIsDirty(true);
    setUnits(u => u.map(x => {
      if (x._key !== unitKey) return x;
      return {
        ...x,
        lines: x.lines.map(l => l._key !== lineKey ? l : {
          ...l,
          price: val,
          price_overridden: l.price_list_id ? true : l.price_overridden,
        }),
      };
    }));
  }

  function pickProduct(unitKey, lineKey, plId) {
    setIsDirty(true);
    const item = priceList.find(p => p.id === plId);
    if (!item) return;
    setUnits(u => u.map(x => {
      if (x._key !== unitKey) return x;
      return {
        ...x,
        lines: x.lines.map(l => l._key !== lineKey ? l : {
          ...l,
          price_list_id:   item.id,
          category:        item.category,
          product:         item.product,
          price:           item.price,
          unit_of_measure: item.unit || '',
          price_overridden: false, // fresh pick clears any previous override
        }),
      };
    }));
  }

  // ── Rate diff / sync ────────────────────────────────────────────────────
  async function handleRefreshRates(unit) {
    if (!unit.id) {
      toast.info('Save the quote first, then you can refresh rates');
      return;
    }
    try {
      const res = await api.get(`/qb/quotes/${id}/units/${unit.id}/rate-diff`);
      setRateDiff({ unitId: unit.id, unitNum: unit.unit_number, ...res.data });
    } catch {
      toast.error('Failed to check rates');
    }
  }

  async function handleConfirmSync() {
    if (!rateDiff) return;
    setSyncing(true);
    try {
      const res = await api.post(`/qb/quotes/${id}/units/${rateDiff.unitId}/sync-rates`);
      const q = res.data;
      setUnits(q.units.map(mapUnit));
      deletedUnitIds.current = [];
      deletedLineIds.current = [];
      setRateDiff(null);
      toast.success('Rates updated');
    } catch {
      toast.error('Failed to sync rates');
    } finally {
      setSyncing(false);
    }
  }

  // ── PDF ─────────────────────────────────────────────────────────────────
  async function handleOpenPdf() {
    setPdfLoading(true);
    try {
      const token = localStorage.getItem('token');
      console.log('[PDF] token present:', !!token, '| value:', token);
      if (!token) {
        toast.error('Not authenticated — please log in again');
        setPdfLoading(false);
        return;
      }
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
      setPdfLoading(false);
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!header.quote_number.trim()) return toast.error('Quote number required');
    const prevQbStatus = savedStatusRef.current;
    setSaving(true);
    try {
      const body = {
        ...header,
        margin:    Number(header.margin) / 100,
        waste_pct: Number(header.waste_pct) / 100,
        client_id: header.client_id || null,
        units: units.map((u, i) => ({
          id:               u.id || undefined,
          unit_number:      u.unit_number,
          drawing_number:   u.drawing_number,
          room_number:      u.room_number,
          level:            u.level,
          description:      u.description,
          quantity:         Number(u.quantity),
          sort_order:       i,
          admin_hours:        Number(u.admin_hours)        || 0,
          cnc_hours:          Number(u.cnc_hours)          || 0,
          edgebander_hours:   Number(u.edgebander_hours)   || 0,
          assembly_hours:     Number(u.assembly_hours)     || 0,
          delivery_hours:     Number(u.delivery_hours)     || 0,
          installation_hours: Number(u.installation_hours) || 0,
          // Send current rates so manual overrides are persisted on UPDATE
          admin_rate:        Number(u.admin_rate        ?? labourRates.admin        ?? 100),
          cnc_rate:          Number(u.cnc_rate          ?? labourRates.cnc          ?? 100),
          edgebander_rate:   Number(u.edgebander_rate   ?? labourRates.edgebander   ?? 100),
          assembly_rate:     Number(u.assembly_rate     ?? labourRates.assembly     ?? 100),
          delivery_rate:     Number(u.delivery_rate     ?? labourRates.delivery     ?? 100),
          installation_rate: Number(u.installation_rate ?? labourRates.installation ?? 100),
          admin_rate_overridden:        u.admin_rate_overridden        ?? false,
          cnc_rate_overridden:          u.cnc_rate_overridden          ?? false,
          edgebander_rate_overridden:   u.edgebander_rate_overridden   ?? false,
          assembly_rate_overridden:     u.assembly_rate_overridden     ?? false,
          delivery_rate_overridden:     u.delivery_rate_overridden     ?? false,
          installation_rate_overridden: u.installation_rate_overridden ?? false,
          subtrade_margin: Number(u.subtrade_margin || 0) / 100,
          subtrades: (u.subtrades || []).map(st => ({
            type:     st.type,
            mode:     st.mode || 'fixed',
            cost:     Number(st.cost)     || 0,
            quantity: Number(st.quantity) || 0,
            rate:     Number(st.rate)     || 0,
          })),
          lines: (() => {
            // Collect ids of saved lines being excluded (qty=0 or empty product)
            u.lines.forEach(l => {
              if (l.id && (Number(l.quantity) === 0 || !l.product.trim()) &&
                  !deletedLineIds.current.includes(l.id)) {
                deletedLineIds.current.push(l.id);
              }
            });
            return u.lines
              .filter(l => l.product.trim() && Number(l.quantity) > 0)
              .map((l, j) => ({
                id:              l.id || undefined,
                price_list_id:   l.price_list_id || null,
                category:        l.category,
                product:         l.product,
                price:           Number(l.price),
                unit_of_measure: l.unit_of_measure,
                quantity:        Number(l.quantity),
                sort_order:      j,
                price_overridden: l.price_overridden ?? false,
              }));
          })(),
        })),
        deleted_unit_ids: deletedUnitIds.current,
        deleted_line_ids: deletedLineIds.current,
      };

      let res;
      if (isNew) {
        res = await api.post('/qb/quotes', body);
        toast.success('Quote created');
        setIsDirty(false);
        navigate(`/qb/quotes/${res.data.id}`, { replace: true });
      } else {
        res = await api.put(`/qb/quotes/${id}`, body);
        toast.success('Quote saved');
        setIsDirty(false);
        const q = res.data;
        setUnits(q.units.map(u => { const m = mapUnit(u); return { ...m, lines: mergeWithDefaults(m.lines, priceList) }; }));
        deletedUnitIds.current = [];
        deletedLineIds.current = [];
        savedStatusRef.current = header.status;
        if (prevQbStatus !== 'accepted' && header.status === 'accepted' && linkedQuoteId) {
          const preHours = {
            hours_admin:     units.reduce((s, u) => s + (Number(u.admin_hours)        || 0) * (Number(u.quantity) || 1), 0),
            hours_machining: units.reduce((s, u) => s + ((Number(u.cnc_hours) || 0) + (Number(u.edgebander_hours) || 0)) * (Number(u.quantity) || 1), 0),
            hours_assembly:  units.reduce((s, u) => s + (Number(u.assembly_hours)     || 0) * (Number(u.quantity) || 1), 0),
            hours_delivery:  units.reduce((s, u) => s + (Number(u.delivery_hours)     || 0) * (Number(u.quantity) || 1), 0),
            hours_install:   units.reduce((s, u) => s + (Number(u.installation_hours) || 0) * (Number(u.quantity) || 1), 0),
          };
          setJobModal({ id: linkedQuoteId, quote_number: header.quote_number, client_name: jtClientName, project: header.project, preHours });
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [header, units, id, isNew, navigate, labourRates, linkedQuoteId, jtClientName]);

  // ── Derived totals ──────────────────────────────────────────────────────
  const margin    = Number(header.margin);
  const wastePct  = Number(header.waste_pct);
  const subtotal  = units.reduce((s, u) => s + unitCalc(u, margin, wastePct, labourRates).unitTotal, 0);
  const gst       = subtotal * 0.10;
  const totalIncl = subtotal + gst;

  if (loading) return <div className={styles.loadingMsg}>Loading quote…</div>;

  return (
    <div className={styles.builderPage}>

      {/* ── Header ── */}
      <div className={styles.builderHeader}>
        <div className={styles.builderTitle}>
          {isNew ? 'New Quote' : `Editing ${header.quote_number}`}
          {isLocked && <span className={styles.lockedBadge}>🔒 Accepted — Rates Locked</span>}
        </div>
        <div className={styles.builderActions}>
          {linkedQuoteId && (
            <button className="btn btn-outline" onClick={() => safeNavigate('/quotes')}>← Back to Quotes</button>
          )}
          {!isNew && (
            <>
              <button className="btn btn-outline" onClick={() => safeNavigate(`/qb/quotes/${id}/summary`)}>Summary →</button>
              <button className="btn btn-outline" onClick={() => safeNavigate(`/qb/quotes/${id}/budget`)}>Budget Qty →</button>
              <button type="button" className="btn btn-outline" onClick={handleOpenPdf} disabled={pdfLoading}>{pdfLoading ? 'Generating…' : 'PDF →'}</button>
            </>
          )}
          {isDirty && <span className={styles.unsavedBadge}>● Unsaved changes</span>}
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Create Quote' : 'Save Quote'}
          </button>
        </div>
      </div>

      {/* ── Quote details ── */}
      <div className="form-panel">
        <div className="form-panel-title">Quote Details</div>

        {linkedQuoteId ? (
          <>
            <div className={styles.linkedInfo}>
              <div className={styles.linkedField}><span>Quote #</span><strong>{header.quote_number}</strong></div>
              <div className={styles.linkedField}><span>Client</span><strong>{jtClientName || '—'}</strong></div>
              <div className={styles.linkedField}><span>Project</span><strong>{header.project || '—'}</strong></div>
              <div className={styles.linkedField}><span>Date</span><strong>{header.date ? new Date(header.date + 'T00:00:00').toLocaleDateString('en-AU') : '—'}</strong></div>
            </div>
            <div className="form-grid cols-4" style={{ marginTop: 12 }}>
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
                <input type="number" step="1" min="0" max="100" value={header.margin} onChange={e => setH('margin', e.target.value)} />
              </div>
              <div className="field">
                <label>Material Waste (%)</label>
                <input type="number" step="1" min="0" max="100" value={header.waste_pct} onChange={e => setH('waste_pct', e.target.value)} />
              </div>
              <div className="field">
                <label>Prepared By</label>
                <input value={header.prepared_by} onChange={e => setH('prepared_by', e.target.value)} placeholder="e.g. Guy Killeen" />
              </div>
              <div className="field span-4">
                <label>Notes</label>
                <textarea
                  rows={3}
                  style={{ resize:'vertical', boxSizing:'border-box' }}
                  value={header.notes}
                  onChange={e => setH('notes', e.target.value)}
                  onInput={e=>{ e.target.style.height='auto'; e.target.style.height=e.target.scrollHeight+'px'; }}
                  placeholder="Internal notes or client-facing exclusions"
                />
              </div>
            </div>
          </>
        ) : (
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
              <input type="number" step="1" min="0" max="100" value={header.margin} onChange={e => setH('margin', e.target.value)} />
            </div>
            <div className="field">
              <label>Material Waste (%)</label>
              <input type="number" step="1" min="0" max="100" value={header.waste_pct} onChange={e => setH('waste_pct', e.target.value)} />
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
              <textarea
                rows={3}
                style={{ resize:'vertical', boxSizing:'border-box' }}
                value={header.notes}
                onChange={e => setH('notes', e.target.value)}
                onInput={e=>{ e.target.style.height='auto'; e.target.style.height=e.target.scrollHeight+'px'; }}
                placeholder="Internal notes or client-facing exclusions"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Units ── */}
      {units.map((unit, ui) => {
        const { matSub, wasteSub, hwSub, labourSub, subtradeCost, subtradeSell, unitTotal } = unitCalc(unit, margin, wastePct, labourRates);
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
                  <textarea
                    rows={3}
                    style={{ resize:'vertical', boxSizing:'border-box', width:'100%' }}
                    value={unit.description}
                    onChange={e => setUnit(unit._key, 'description', e.target.value)}
                    onInput={e=>{ e.target.style.height='auto'; e.target.style.height=e.target.scrollHeight+'px'; }}
                    placeholder="e.g. Tas Oak veneer on 40mm LDF joinery"
                  />
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
            <div className={styles.linesTableWrap}>
              <table className={styles.linesTable}>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th style={{ width: 80 }}>Qty</th>
                    <th style={{ width: 110 }}>Price</th>
                    <th style={{ width: 60 }}>UOM</th>
                    <th style={{ width: 110, textAlign: 'right' }}>Total</th>
                    <th style={{ width: 32 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {unit.lines.map(line => (
                    <tr key={line._key} className={Number(line.quantity) === 0 ? styles.lineDimmed : ''}>
                      <td>
                        <select
                          className={styles.productSelect}
                          value={line.price_list_id || ''}
                          disabled={isLocked}
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
                            readOnly={isLocked}
                            onChange={e => setLine(unit._key, line._key, 'product', e.target.value)}
                            placeholder="Product description"
                          />
                        )}
                      </td>
                      <td>
                        <select
                          value={line.category}
                          disabled={isLocked}
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
                          readOnly={isLocked}
                          onChange={e => setLine(unit._key, line._key, 'quantity', e.target.value)}
                        />
                      </td>
                      <td>
                        <div className={styles.priceCell}>
                          <input
                            type="number" min="0" step="any"
                            value={line.price}
                            readOnly={isLocked}
                            onChange={e => setLinePrice(unit._key, line._key, e.target.value)}
                          />
                          {line.price_list_id && line.price_overridden && !isLocked && (
                            <span className={styles.overrideDot} title="Price manually overridden from price list">✎</span>
                          )}
                          {isLocked && line.price_list_id && (
                            <span className={styles.lockedDot} title="Rate locked">🔒</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <input
                          value={line.unit_of_measure}
                          readOnly={isLocked}
                          onChange={e => setLine(unit._key, line._key, 'unit_of_measure', e.target.value)}
                          placeholder="m2"
                          style={{ width: 56 }}
                        />
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 500 }}>
                        {fmtMoney(Number(line.price) * Number(line.quantity))}
                      </td>
                      <td>
                        {!isLocked && (
                          <button className={styles.removeLine} onClick={() => removeLine(unit._key, line._key)} title="Remove line">✕</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!isLocked && (
              <div className={styles.addLineBtnWrap}>
                <button className={styles.addLineBtn} onClick={() => addLine(unit._key)}>+ Add Line</button>
              </div>
            )}

            {/* Labour hours */}
            <div className={styles.labourSection}>
              <div className={styles.labourTitle}>Labour Hours</div>
              <div className={styles.labourRow}>
                {LABOUR_FIELDS.map(({ hoursField, rateField, type, label }) => {
                  const rate = Number(unit[rateField] ?? labourRates[type] ?? 100);
                  const overridden = unit[`${type}_rate_overridden`];
                  return (
                    <div key={hoursField} className={styles.labourField}>
                      <label>
                        {label}
                        {!isLocked ? (
                          <span className={styles.rateEditWrap}>
                            $<input
                              type="number" min="0" step="0.01"
                              className={styles.rateInput}
                              value={unit[rateField] ?? labourRates[type] ?? 100}
                              title="Hourly rate — edit to override"
                              onChange={e => handleLabourRateChange(unit._key, rateField, type, e.target.value)}
                            />/hr
                            {overridden && (
                              <span className={styles.overrideDot} title="Rate manually overridden — will not update with price list changes">✎</span>
                            )}
                          </span>
                        ) : (
                          <span className={styles.labourRateTag}>${rate}/hr 🔒</span>
                        )}
                      </label>
                      <input
                        type="number" min="0" step="0.5"
                        value={unit[hoursField] ?? 0}
                        readOnly={isLocked}
                        onChange={e => setUnit(unit._key, hoursField, e.target.value)}
                      />
                      <span className={styles.labourCost}>{fmtMoney(Number(unit[hoursField] ?? 0) * rate)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Subtrades */}
            <div className={styles.subtradesSection}>
              <div className={styles.subtradesTitle}>Subtrades</div>
              <div className={styles.subtradesList}>
                {SUBTRADE_ITEMS.map(({ type, label }) => {
                  const st = unit.subtrades.find(s => s.type === type) || EMPTY_SUBTRADE(type);
                  const lineTotal = st.mode === 'qty_rate'
                    ? (Number(st.quantity) || 0) * (Number(st.rate) || 0)
                    : (Number(st.cost) || 0);
                  return (
                    <div key={type} className={styles.subtradeRow}>
                      <span className={styles.subtradeName}>{label}</span>
                      <div className={styles.subtradeModeToggle}>
                        <button
                          type="button"
                          className={`${styles.subtradeModeBtn}${st.mode === 'fixed' ? ' ' + styles.subtradeModeActive : ''}`}
                          onClick={() => setSubtrade(unit._key, type, 'mode', 'fixed')}
                          disabled={isLocked}
                        >Fixed</button>
                        <button
                          type="button"
                          className={`${styles.subtradeModeBtn}${st.mode === 'qty_rate' ? ' ' + styles.subtradeModeActive : ''}`}
                          onClick={() => setSubtrade(unit._key, type, 'mode', 'qty_rate')}
                          disabled={isLocked}
                        >Qty×Rate</button>
                      </div>
                      <div className={styles.subtradeInputs}>
                        {st.mode === 'fixed' ? (
                          <input
                            type="number" min="0" step="any"
                            value={st.cost}
                            readOnly={isLocked}
                            onChange={e => setSubtrade(unit._key, type, 'cost', e.target.value)}
                            placeholder="0.00"
                          />
                        ) : (
                          <>
                            <input
                              type="number" min="0" step="any"
                              value={st.quantity}
                              readOnly={isLocked}
                              onChange={e => setSubtrade(unit._key, type, 'quantity', e.target.value)}
                              placeholder="Qty"
                              className={styles.subtradeQtyInput}
                            />
                            <span className={styles.subtradeTimes}>×</span>
                            <input
                              type="number" min="0" step="any"
                              value={st.rate}
                              readOnly={isLocked}
                              onChange={e => setSubtrade(unit._key, type, 'rate', e.target.value)}
                              placeholder="Rate"
                            />
                          </>
                        )}
                      </div>
                      <span className={`${styles.subtradeTotal}${lineTotal > 0 ? '' : ' ' + styles.subtradeTotalEmpty}`}>
                        {lineTotal > 0 ? fmtMoney(lineTotal) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className={styles.subtradesFooter}>
                <div className={styles.subtradesMarginField}>
                  <label>Subtrades Margin</label>
                  <input
                    type="number" min="0" max="100" step="1"
                    value={unit.subtrade_margin}
                    readOnly={isLocked}
                    onChange={e => setUnit(unit._key, 'subtrade_margin', e.target.value)}
                  />
                  <span className={styles.subtradePct}>%</span>
                </div>
                <div className={styles.subtradesTotals}>
                  <span>Cost: <strong>{fmtMoney(subtradeCost)}</strong></span>
                  <span>Sell: <strong>{fmtMoney(subtradeSell)}</strong></span>
                </div>
              </div>
            </div>

            <div className={styles.unitFooter}>
              <div className={styles.unitTotals}>
                <span>Materials: <strong>{fmtMoney(matSub)}</strong></span>
                <span>Waste: <strong>{fmtMoney(wasteSub)}</strong></span>
                <span>Hardware: <strong>{fmtMoney(hwSub)}</strong></span>
                <span>Labour: <strong>{fmtMoney(labourSub)}</strong></span>
                {subtradeSell > 0 && <span>Subtrades: <strong>{fmtMoney(subtradeSell)}</strong></span>}
                <span>Unit cost × {unit.quantity}: <strong>{fmtMoney(unitTotal)}</strong></span>
              </div>
              {!isLocked && unit.id && (
                <button
                  className={styles.refreshRatesBtn}
                  onClick={() => handleRefreshRates(unit)}
                  title="Compare current price list and labour rates against this unit's snapshot"
                >
                  ↻ Refresh Rates
                </button>
              )}
            </div>
          </div>
        );
      })}

      {!isLocked && (
        <button className={styles.addUnitBtn} onClick={addUnit}>+ Add Unit</button>
      )}

      {/* ── Quote totals ── */}
      <div className={styles.quoteTotals}>
        <div className={styles.totalsRow}><span>Subtotal (ex GST)</span><strong>{fmtMoney(subtotal)}</strong></div>
        <div className={styles.totalsRow}><span>GST (10%)</span><strong>{fmtMoney(gst)}</strong></div>
        <div className={`${styles.totalsRow} ${styles.totalsGrand}`}><span>Total (incl. GST)</span><strong>{fmtMoney(totalIncl)}</strong></div>
      </div>

      <div className="btn-row" style={{ marginTop: 32, marginBottom: 48 }}>
        {!isNew && (
          <>
            <button className="btn btn-outline" onClick={() => safeNavigate(`/qb/quotes/${id}/summary`)}>View Summary →</button>
            <button className="btn btn-outline" onClick={() => safeNavigate(`/qb/quotes/${id}/budget`)}>Budget Quantities →</button>
          </>
        )}
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isNew ? 'Create Quote' : 'Save Quote'}
        </button>
      </div>

      {/* ── Rate diff dialog ── */}
      {rateDiff && (
        <div className={styles.rateDiffOverlay} onClick={() => setRateDiff(null)}>
          <div className={styles.rateDiffDialog} onClick={e => e.stopPropagation()}>
            <div className={styles.rateDiffTitle}>Refresh Rates — Unit {rateDiff.unitNum}</div>

            {rateDiff.materials.length === 0 && rateDiff.labour.length === 0 ? (
              <p className={styles.rateDiffEmpty}>All rates are already up to date.</p>
            ) : (
              <>
                {rateDiff.materials.length > 0 && (
                  <div className={styles.rateDiffSection}>
                    <div className={styles.rateDiffSectionTitle}>Materials &amp; Hardware</div>
                    <table className={styles.rateDiffTable}>
                      <tbody>
                        {rateDiff.materials.map(d => (
                          <tr key={d.line_id}>
                            <td className={styles.rateDiffProduct}>{d.product}</td>
                            <td className={styles.rateDiffOld}>{fmtMoney(d.stored_price)}</td>
                            <td className={styles.rateDiffArrow}>→</td>
                            <td className={styles.rateDiffNew}>{fmtMoney(d.current_price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {rateDiff.labour.length > 0 && (
                  <div className={styles.rateDiffSection}>
                    <div className={styles.rateDiffSectionTitle}>Labour</div>
                    <table className={styles.rateDiffTable}>
                      <tbody>
                        {rateDiff.labour.map(d => (
                          <tr key={d.type}>
                            <td className={styles.rateDiffProduct} style={{ textTransform: 'capitalize' }}>{d.type}</td>
                            <td className={styles.rateDiffOld}>${d.stored_rate}/hr</td>
                            <td className={styles.rateDiffArrow}>→</td>
                            <td className={styles.rateDiffNew}>${d.current_rate}/hr</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className={styles.rateDiffNote}>
                  Hours, quantities, and unit descriptions are unchanged. Only rates will update.
                </p>
              </>
            )}

            <div className={styles.rateDiffActions}>
              <button className="btn btn-outline" onClick={() => setRateDiff(null)}>Cancel</button>
              {(rateDiff.materials.length > 0 || rateDiff.labour.length > 0) ? (
                <button className="btn btn-primary" onClick={handleConfirmSync} disabled={syncing}>
                  {syncing ? 'Applying…' : 'Apply Updates →'}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={() => setRateDiff(null)}>OK</button>
              )}
            </div>
          </div>
        </div>
      )}

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
