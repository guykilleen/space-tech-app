import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import api from '../../utils/api';
import styles from '../Page.module.css';

const CATEGORIES = ['Materials', 'Hardware'];
const EMPTY = { category: 'Materials', product: '', price: '', unit: '', active: true };

function fmtMoney(v) {
  return v != null ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v) : '—';
}

export default function QBPriceListPage() {
  const [items,    setItems]    = useState([]);
  const [filter,   setFilter]   = useState('');
  const [catFilter,setCatFilter]= useState('');
  const [editId,   setEditId]   = useState(null);
  const [editData, setEditData] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [form,     setForm]     = useState(EMPTY);

  async function load() {
    try {
      const res = await api.get('/qb/price-list');
      setItems(res.data);
    } catch { toast.error('Failed to load price list'); }
  }

  useEffect(() => { load(); }, []);

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
    </div>
  );
}
