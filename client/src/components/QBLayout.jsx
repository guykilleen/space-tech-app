import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import styles from './Layout.module.css';

const QB_NAV = [
  { to: '/qb/quotes',     label: '📄 Quotes'     },
  { to: '/qb/price-list', label: '💰 Price List'  },
  { to: '/qb/contacts',   label: '👤 Contacts'    },
];

export default function QBLayout() {
  const { user, logout } = useAuth();
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
        <button className={styles.switchBtn} onClick={() => navigate('/quotes')}>
          Job Tracker
        </button>
        <span className={`${styles.switchBtn} ${styles.switchBtnActive}`}>Quote Builder</span>
      </div>

      <nav className={styles.nav}>
        {QB_NAV.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `${styles.tabBtn}${isActive ? ' ' + styles.active : ''}`}
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
