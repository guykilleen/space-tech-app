import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import styles from './Page.module.css';

const ROLES = ['admin','manager','workshop','readonly'];
const ROLE_COLOR = { admin:'#7c3aed', manager:'#1e40af', workshop:'#0369a1', readonly:'#64748b' };

export default function UsersPage() {
  const { isAdmin } = useAuth();
  const [users, setUsers]   = useState([]);
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({});
  const [showAdd, setShowAdd]   = useState(false);
  const [newUser, setNewUser]   = useState({ name:'', email:'', password:'', role:'workshop' });

  function load() { api.get('/users').then(r => setUsers(r.data)); }
  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    try {
      await api.post('/users', newUser);
      toast.success('User created');
      setNewUser({ name:'', email:'', password:'', role:'workshop' });
      setShowAdd(false);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  async function handleSaveEdit(id) {
    const payload = { ...editData };
    if (!payload.password) delete payload.password;
    try {
      await api.put(`/users/${id}`, payload);
      toast.success('User updated');
      setEditId(null);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  async function handleDeactivate(id) {
    if (!window.confirm('Deactivate this user?')) return;
    try { await api.delete(`/users/${id}`); toast.success('Deactivated'); load(); }
    catch { toast.error('Failed'); }
  }

  return (
    <div className={styles.page}>
      <div className="section-header">
        <h1 className="section-title">Users</h1>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => setShowAdd(s => !s)}>
            {showAdd ? 'Cancel' : '+ New User'}
          </button>
        )}
      </div>

      {showAdd && isAdmin && (
        <form className="form-panel" onSubmit={handleCreate}>
          <div className="form-panel-title">New User</div>
          <div className="form-grid cols-4">
            <div className="field span-2"><label>Name</label><input required value={newUser.name} onChange={e=>setNewUser(u=>({...u,name:e.target.value}))} /></div>
            <div className="field span-2"><label>Email</label><input required type="email" value={newUser.email} onChange={e=>setNewUser(u=>({...u,email:e.target.value}))} /></div>
            <div className="field"><label>Password</label><input required type="password" value={newUser.password} onChange={e=>setNewUser(u=>({...u,password:e.target.value}))} /></div>
            <div className="field">
              <label>Role</label>
              <select value={newUser.role} onChange={e=>setNewUser(u=>({...u,role:e.target.value}))}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn-outline" onClick={() => setShowAdd(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create User →</button>
          </div>
        </form>
      )}

      <div className="table-wrap">
        <div className="table-toolbar"><span className="ttitle">All Users</span></div>
        <div style={{ overflowX:'auto' }}>
          <table className="std-table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <React.Fragment key={u.id}>
                  <tr id={`urow-${u.id}`}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>
                      <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:2, fontSize:'.6rem', letterSpacing:'.12em', textTransform:'uppercase', background: ROLE_COLOR[u.role]+'22', color: ROLE_COLOR[u.role] }}>
                        {u.role}
                      </span>
                    </td>
                    <td>{u.is_active ? '✓' : '✗'}</td>
                    <td>
                      {isAdmin && (
                        <>
                          <button className="act-btn edit" onClick={() => {
                            if (editId === u.id) { setEditId(null); return; }
                            setEditId(u.id);
                            setEditData({ name:u.name, email:u.email, role:u.role, is_active:u.is_active, password:'' });
                          }}>
                            {editId === u.id ? 'Close' : 'Edit'}
                          </button>
                          {u.is_active && (
                            <button className="act-btn del" style={{ marginLeft:4 }} onClick={() => handleDeactivate(u.id)}>Deactivate</button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                  {editId === u.id && (
                    <tr className="edit-row">
                      <td colSpan={5}>
                        <div className="edit-row-inner">
                          <div className="edit-field" style={{ flex:1, minWidth:180 }}><label>Name</label><input value={editData.name} onChange={e=>setEditData(d=>({...d,name:e.target.value}))} /></div>
                          <div className="edit-field" style={{ flex:2, minWidth:220 }}><label>Email</label><input type="email" value={editData.email} onChange={e=>setEditData(d=>({...d,email:e.target.value}))} /></div>
                          <div className="edit-field">
                            <label>Role</label>
                            <select value={editData.role} onChange={e=>setEditData(d=>({...d,role:e.target.value}))}>
                              {ROLES.map(r=><option key={r} value={r}>{r}</option>)}
                            </select>
                          </div>
                          <div className="edit-field"><label>New Password (blank = keep)</label><input type="password" value={editData.password} onChange={e=>setEditData(d=>({...d,password:e.target.value}))} placeholder="(unchanged)" /></div>
                          <div className="edit-field">
                            <label>Active</label>
                            <select value={editData.is_active ? 'true' : 'false'} onChange={e=>setEditData(d=>({...d,is_active:e.target.value==='true'}))}>
                              <option value="true">Active</option>
                              <option value="false">Inactive</option>
                            </select>
                          </div>
                        </div>
                        <div className="edit-actions" style={{ marginTop:14 }}>
                          <button className="smbtn smbtn-save" onClick={() => handleSaveEdit(u.id)}>Save Changes</button>
                          <button className="smbtn smbtn-cancel" onClick={() => setEditId(null)}>Cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {!users.length && <tr><td colSpan={5}><div className="empty-state"><div className="empty-icon">👥</div><div className="empty-text">No users</div></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
