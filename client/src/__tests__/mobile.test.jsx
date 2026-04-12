import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import QuotesPage from '../pages/QuotesPage';
import QBQuotesListPage from '../pages/qb/QBQuotesListPage';
import api from '../utils/api';

jest.mock('../context/AuthContext');
jest.mock('../utils/api', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../components/JobCreateModal', () => () => null);
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

function wrap(Component) {
  return render(<MemoryRouter><Component /></MemoryRouter>);
}

describe('Mobile responsive layout — smoke tests at 390px', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.mockReturnValue({ isAdminOrMgr: true, canEdit: true });
    api.get.mockResolvedValue({ data: [] });
    Object.defineProperty(window, 'innerWidth', {
      writable: true, configurable: true, value: 390,
    });
  });

  it('Quote Register page renders without crashing', async () => {
    wrap(QuotesPage);
    await waitFor(() => {
      expect(screen.getByText('Quote Register')).toBeInTheDocument();
    });
  });

  it('QB Quotes List page renders without crashing', async () => {
    wrap(QBQuotesListPage);
    await waitFor(() => {
      expect(screen.getByText('QB Quotes')).toBeInTheDocument();
    });
  });

  it('Quote Register: mobile-only card container is present in the DOM', async () => {
    const { container } = wrap(QuotesPage);
    // Both table (desktop-only) and cards (mobile-only) live in the DOM;
    // CSS media queries control visibility — jsdom does not apply them.
    await waitFor(() => {
      expect(container.querySelector('.mobile-only')).toBeInTheDocument();
    });
  });

  it('Quote Register: fixed mobile FAB (New Quote) present in DOM for admin users', async () => {
    const { container } = wrap(QuotesPage);
    await waitFor(() => {
      expect(container.querySelector('.mobile-fab-wrap')).toBeInTheDocument();
      expect(container.querySelector('.mobile-fab')).toBeInTheDocument();
    });
  });

  it('QB Quotes: desktop-only table AND mobile card list both present in DOM', async () => {
    const { container } = wrap(QBQuotesListPage);
    await waitFor(() => {
      expect(container.querySelector('.desktop-only')).toBeInTheDocument();
      expect(container.querySelector('.mobile-only')).toBeInTheDocument();
      expect(container.querySelector('.mobile-fab-wrap')).toBeInTheDocument();
    });
  });
});
