import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import styles from './Layout.module.css';

const NAV = [
  { to: '/quotes', label: '📋 Quotes' },
  { to: '/jobs',   label: '🔨 Project Tracking' },
  { to: '/wip',    label: '📋 WIP' },
  { to: '/gantt',  label: '📅 Gantt' },
];

export default function Layout() {
  const { user, logout, isAdminOrMgr } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <div className={styles.logoMark}>
            <span className={styles.logoSpace}>SPACE</span><span className={styles.logoTech}>TECH</span> <span className={styles.logoDesign}>DESIGN</span>
          </div>
          <div className={styles.logoSub}>Quote &amp; Project Management System</div>
        </div>
        <div className={styles.headerMeta}>
          <div>{new Date().toLocaleDateString('en-AU', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</div>
          <div>
            {user?.name} &nbsp;·&nbsp;
            <span style={{ opacity: .6 }}>{user?.role}</span>
            &nbsp;·&nbsp;
            <button className={styles.logoutBtn} onClick={handleLogout}>Sign out</button>
          </div>
        </div>
      </header>

      <nav className={styles.nav}>
        {NAV.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `${styles.tabBtn}${isActive ? ' ' + styles.active : ''}`}
          >
            {label}
          </NavLink>
        ))}
        {isAdminOrMgr && (
          <NavLink
            to="/users"
            className={({ isActive }) => `${styles.tabBtn}${isActive ? ' ' + styles.active : ''}`}
          >
            👥 Users
          </NavLink>
        )}
      </nav>

      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
