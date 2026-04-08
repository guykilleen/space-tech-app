import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import api from '../../utils/api';
import styles from '../Page.module.css';

const EMPTY = { name: '', email: '', company: '', phone: '', address: '' };

export default function QBContactsPage() {
  const [contacts, setContacts] = useState([]);
  const [search,   setSearch]   = useState('');
  const [editId,   setEditId]   = useState(null);
  const [editData, setEditData] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [form,     setForm]     = useState(EMPTY);

  async function load() {
    try {
      const res = await api.get('/qb/contacts');
      setContacts(res.data);
    } catch { toast.error('Failed to load contacts'); }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    try {
      await api.post('/qb/contacts', form);
      toast.success('Contact added');
      setForm(EMPTY);
      setShowForm(false);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
  }

  async function handleSaveEdit(id) {
    try {
      await api.put(`/qb/contacts/${id}`, editData);
      toast.success('Updated');
      setEditId(null);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this contact?')) return;
    try {
      await api.delete(`/qb/contacts/${id}`);
      toast.success('Deleted');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Delete failed'); }
  }

  const filtered = contacts.filter(c => {
    if (!search) return true;
    const l = search.toLowerCase();
    return [c.name, c.email, c.company, c.phone].some(v => (v || '').toLowerCase().includes(l));
  });

  return (
    <div className={styles.page}>
      <div className="section-header">
        <h1 className="section-title">Contacts</h1>
        <span className="section-tag">{contacts.length} contacts</span>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setShowForm(s => !s)}>
          {showForm ? 'Cancel' : '+ Add Contact'}
        </button>
      </div>

      {showForm && (
        <form className="form-panel" onSubmit={handleCreate}>
          <div className="form-panel-title">New Contact</div>
          <div className="form-grid cols-4">
            <div className="field span-2">
              <label>Name</label>
              <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" />
            </div>
            <div className="field span-2">
              <label>Company</label>
              <input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="Company name" />
            </div>
            <div className="field span-2">
              <label>Email</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" />
            </div>
            <div className="field">
              <label>Phone</label>
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="0400 000 000" />
            </div>
            <div className="field span-4">
              <label>Address</label>
              <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Street address, suburb, state, postcode" />
            </div>
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Add Contact →</button>
          </div>
        </form>
      )}

      <div className="table-wrap">
        <div className="table-toolbar">
          <span className="ttitle">All Contacts</span>
          <input
            className="search-box"
            type="text"
            placeholder="Search contacts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <table className="std-table">
          <thead>
            <tr><th>Name</th><th>Company</th><th>Address</th><th>Email</th><th>Phone</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <React.Fragment key={c.id}>
                <tr>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.company || '—'}</td>
                  <td>{c.address || '—'}</td>
                  <td>{c.email || '—'}</td>
                  <td>{c.phone || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="act-btn edit" onClick={() => { setEditId(c.id); setEditData({ name: c.name, email: c.email || '', company: c.company || '', phone: c.phone || '', address: c.address || '' }); }}>Edit</button>
                      <button className="act-btn del" onClick={() => handleDelete(c.id)}>Del</button>
                    </div>
                  </td>
                </tr>
                {editId === c.id && (
                  <tr className="edit-row">
                    <td colSpan={6}>
                      <div className="edit-row-inner">
                        <div className="edit-field" style={{ flex: 2, minWidth: 160 }}>
                          <label>Name</label>
                          <input value={editData.name} onChange={e => setEditData(d => ({ ...d, name: e.target.value }))} />
                        </div>
                        <div className="edit-field" style={{ flex: 2, minWidth: 160 }}>
                          <label>Company</label>
                          <input value={editData.company} onChange={e => setEditData(d => ({ ...d, company: e.target.value }))} />
                        </div>
                        <div className="edit-field" style={{ flex: 3, minWidth: 220 }}>
                          <label>Address</label>
                          <input value={editData.address} onChange={e => setEditData(d => ({ ...d, address: e.target.value }))} placeholder="Street, suburb, state, postcode" />
                        </div>
                        <div className="edit-field" style={{ flex: 2, minWidth: 180 }}>
                          <label>Email</label>
                          <input type="email" value={editData.email} onChange={e => setEditData(d => ({ ...d, email: e.target.value }))} />
                        </div>
                        <div className="edit-field">
                          <label>Phone</label>
                          <input value={editData.phone} onChange={e => setEditData(d => ({ ...d, phone: e.target.value }))} />
                        </div>
                      </div>
                      <div className="edit-actions" style={{ marginTop: 12 }}>
                        <button className="smbtn smbtn-save" onClick={() => handleSaveEdit(c.id)}>Save</button>
                        <button className="smbtn smbtn-cancel" onClick={() => setEditId(null)}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {!filtered.length && (
              <tr><td colSpan={6}><div className="empty-state"><div className="empty-icon">👤</div><div className="empty-text">No contacts found</div></div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
