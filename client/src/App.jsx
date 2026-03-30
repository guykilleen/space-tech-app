import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import { useAuth } from './context/AuthContext';

import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import QuotesPage from './pages/QuotesPage';
import JobsPage from './pages/JobsPage';
import WipPage from './pages/WipPage';
import GanttPage from './pages/GanttPage';
import UsersPage from './pages/UsersPage';

function PrivateRoute({ children, roles }) {
  const { user, loading } = useAuth();
  const hasToken = !!localStorage.getItem('token');
  if (loading || (hasToken && !user)) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/quotes" replace />;
  return children;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<Navigate to="/quotes" replace />} />
          <Route path="quotes"  element={<QuotesPage />} />
          <Route path="jobs"    element={<JobsPage />} />
          <Route path="wip"     element={<WipPage />} />
          <Route path="gantt"   element={<GanttPage />} />
          <Route path="users"   element={<PrivateRoute roles={['admin','manager']}><UsersPage /></PrivateRoute>} />
        </Route>
        <Route path="*" element={<Navigate to="/quotes" replace />} />
      </Routes>
      <ToastContainer
        position="bottom-right"
        autoClose={4000}
        style={{ fontFamily: "'DM Mono', monospace", fontSize: '.78rem' }}
      />
    </>
  );
}
