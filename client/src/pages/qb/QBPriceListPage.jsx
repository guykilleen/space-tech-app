import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import api from '../../utils/api';
import styles from '../Page.module.css';

const CATEGORIES = ['Materials', 'Hardware'];
const EMPTY = { category: 'Materials', product: '', price: '', unit: '', active: true };
const LABOUR_TYPES = [
  { type: 'admin',        label: 'Admin' },
  { type: 'cnc',          label: 'CNC' },
  { type: 'edgebander',   label: 'Edgebander' },
  { type: 'assembly',     label: 'Assembly' },
  { type: 'delivery',     label: 'Delivery' },
  { type: 'installation', label: 'Installation' },
];

function fmtMoney(v) {
  return v != null ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v) : '—';
}

export default function QBPriceListPage() {
  const [items,       setItems]       = useState([]);
  const [filter,      setFilter]      = useState('');
  const [catFilter,   setCatFilter]   = useState('');
  const [editId,      setEditId]      = useState(null);
  const [editData,    setEditData]    = useState({});
  const [showForm,    setShowForm]    = useState(false);
  const [form,        setForm]        = useState(EMPTY);
  const [labourRates, setLabourRates] = useState({});
  const [labourEdit,  setLabourEdit]  = useState({});

  async function load() {
    try {
      const res = await api.get('/qb/price-list');
      setItems(res.data);
    } catch { toast.error('Failed to load price list'); }
  }

  async function loadLabourRates() {
    try {
      const res = await api.get('/qb/labour-rates');
      setLabourRates(res.data);
      setLabourEdit(Object.fromEntries(Object.entries(res.data).map(([k, v]) => [k, String(v)])));
    } catch { toast.error('Failed to load labour rates'); }
  }

  useEffect(() => { load(); loadLabourRates(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    try {
      await api.post('/qb/price-list', { ...form, price: Number(form.price) });
      toast.success('Item added');
      setForm(EMPTY);
      setShowForm(false);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
  }

  async function handleSaveEdit(item) {
    try {
      await api.put(`/qb/price-list/${item.id}`, { ...editData, price: Number(editData.price) });
      toast.success('Updated');
      setEditId(null);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
  }

  async function handleToggle(id) {
    try {
      await api.patch(`/qb/price-list/${id}/toggle-active`);
      load();
    } catch { toast.error('Toggle failed'); }
  }

  async function saveLabourRate(type) {
    const rate = parseFloat(labourEdit[type]);
    if (isNaN(rate) || rate < 0) { toast.error('Invalid rate'); return; }
    try {
      await api.patch(`/qb/labour-rates/${type}`, { hourly_rate: rate });
      toast.success('Rate updated');
      setLabourRates(r => ({ ...r, [type]: rate }));
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this item?')) return;
    try {
      await api.delete(`/qb/price-list/${id}`);
      toast.success('Deleted');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Delete failed'); }
  }

  const filtered = items.filter(item => {
    if (catFilter && item.category !== catFilter) return false;
    if (!filter) return true;
    return item.product.toLowerCase().includes(filter.toLowerCase());
  });

  return (
    <div className={styles.page}>
      <div className="section-header">
        <h1 className="section-title">Price List</h1>
        <span className="section-tag">{items.length} items</span>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setShowForm(s => !s)}>
          {showForm ? 'Cancel' : '+ Add Item'}
        </button>
      </div>

      {showForm && (
        <form className="form-panel" onSubmit={handleCreate}>
          <div className="form-panel-title">New Price List Item</div>
          <div className="form-grid cols-4">
            <div className="field">
              <label>Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="field span-2">
              <label>Product Name</label>
              <input required value={form.product} onChange={e => setForm(f => ({ ...f, product: e.target.value }))} placeholder="e.g. 18mm STD MDF" />
            </div>
            <div className="field">
              <label>Price ($)</label>
              <input type="number" step="any" min="0" required value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
            </div>
            <div className="field">
              <label>Unit</label>
              <input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="sheet / m2 / each / l/m" />
            </div>
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Add Item →</button>
          </div>
        </form>
      )}

      <div className="table-wrap">
        <div className="table-toolbar">
          <span className="ttitle">All Items</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              className="search-box"
              style={{ width: 140 }}
              value={catFilter}
              onChange={e => setCatFilter(e.target.value)}
            >
              <option value="">All Categories</option>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
            <input
              className="search-box"
              type="text"
              placeholder="Search products…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
          </div>
        </div>
        <table className="std-table">
          <thead>
            <tr>
              <th>Category</th><th>Product</th><th>Price</th><th>Unit</th><th>Active</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => (
              <React.Fragment key={item.id}>
                <tr style={{ opacity: item.active ? 1 : 0.45 }}>
                  <td><span className="badge b-review">{item.category}</span></td>
                  <td>{item.product}</td>
                  <td className="currency">{fmtMoney(item.price)}</td>
                  <td>{item.unit || '—'}</td>
                  <td>
                    <span className={`badge ${item.active ? 'b-accepted' : 'b-declined'}`}>
                      {item.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="act-btn edit" onClick={() => { setEditId(item.id); setEditData({ category: item.category, product: item.product, price: item.price, unit: item.unit || '', active: item.active }); }}>Edit</button>
                      <button className="act-btn" onClick={() => handleToggle(item.id)}>{item.active ? 'Deactivate' : 'Activate'}</button>
                      <button className="act-btn del" onClick={() => handleDelete(item.id)}>Del</button>
                    </div>
                  </td>
                </tr>
                {editId === item.id && (
                  <tr className="edit-row">
                    <td colSpan={6}>
                      <div className="edit-row-inner">
                        <div className="edit-field">
                          <label>Category</label>
                          <select value={editData.category} onChange={e => setEditData(d => ({ ...d, category: e.target.value }))}>
                            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                          </select>
                        </div>
                        <div className="edit-field" style={{ flex: 2, minWidth: 200 }}>
                          <label>Product</label>
                          <input value={editData.product} onChange={e => setEditData(d => ({ ...d, product: e.target.value }))} />
                        </div>
                        <div className="edit-field">
                          <label>Price ($)</label>
                          <input type="number" step="any" min="0" value={editData.price} onChange={e => setEditData(d => ({ ...d, price: e.target.value }))} />
                        </div>
                        <div className="edit-field">
                          <label>Unit</label>
                          <input value={editData.unit} onChange={e => setEditData(d => ({ ...d, unit: e.target.value }))} />
                        </div>
                      </div>
                      <div className="edit-actions" style={{ marginTop: 12 }}>
                        <button className="smbtn smbtn-save" onClick={() => handleSaveEdit(item)}>Save</button>
                        <button className="smbtn smbtn-cancel" onClick={() => setEditId(null)}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {!filtered.length && (
              <tr><td colSpan={6}><div className="empty-state"><div className="empty-icon">💰</div><div className="empty-text">No items found</div></div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Labour Rates */}
      <div className="table-wrap" style={{ marginTop: 32 }}>
        <div className="table-toolbar">
          <span className="ttitle">Labour Rates</span>
          <span style={{ marginLeft: 'auto', fontSize: '.68rem', color: 'var(--muted)' }}>
            Changes apply to all future quotes — existing quotes retain their snapshotted rates
          </span>
        </div>
        <table className="std-table">
          <thead>
            <tr>
              <th>Type</th>
              <th style={{ textAlign: 'right' }}>Hourly Rate ($/hr)</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {LABOUR_TYPES.map(({ type, label }) => (
              <tr key={type}>
                <td>{label}</td>
                <td style={{ textAlign: 'right' }}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={labourEdit[type] ?? ''}
                    onChange={e => setLabourEdit(r => ({ ...r, [type]: e.target.value }))}
                    style={{ width: 120, textAlign: 'right' }}
                  />
                </td>
                <td>
                  <button
                    className="smbtn smbtn-save"
                    onClick={() => saveLabourRate(type)}
                    disabled={parseFloat(labourEdit[type]) === labourRates[type]}
                  >
                    Save
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
