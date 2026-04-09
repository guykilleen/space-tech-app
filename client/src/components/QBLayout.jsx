import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { QBDirtyProvider, useQBDirty } from '../context/QBDirtyContext';
import styles from './Layout.module.css';

const QB_NAV = [
  { to: '/qb/quotes',     label: '📄 Quotes'     },
  { to: '/qb/price-list', label: '💰 Price List'  },
  { to: '/qb/contacts',   label: '👤 Contacts'    },
];

const CONFIRM_MSG = 'You have unsaved changes. Are you sure you want to leave? Your changes will be lost.';

function QBLayoutInner() {
  const { user, logout } = useAuth();
  const { isDirty, setIsDirty } = useQBDirty();
  const navigate = useNavigate();
  const location = useLocation();

  function guardedNavigate(to) {
    if (isDirty && !window.confirm(CONFIRM_MSG)) return;
    setIsDirty(false);
    navigate(to);
  }

  function handleLogout() {
    if (isDirty && !window.confirm(CONFIRM_MSG)) return;
    setIsDirty(false);
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
          <div className={styles.logoSub}>Joinery Estimating &amp; Quoting</div>
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

      <div className={styles.appSwitcher}>
        <button className={styles.switchBtn} onClick={() => guardedNavigate('/quotes')}>
          Job Tracker
        </button>
        <span className={`${styles.switchBtn} ${styles.switchBtnActive}`}>Quote Builder</span>
      </div>

      <nav className={styles.nav}>
        {QB_NAV.map(({ to, label }) => (
          <button
            key={to}
            onClick={() => guardedNavigate(to)}
            className={`${styles.tabBtn}${location.pathname.startsWith(to) ? ' ' + styles.active : ''}`}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}

export default function QBLayout() {
  return (
    <QBDirtyProvider>
      <QBLayoutInner />
    </QBDirtyProvider>
  );
}
