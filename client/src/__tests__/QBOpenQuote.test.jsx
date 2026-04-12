/**
 * QBOpenQuote.test.jsx
 *
 * Tests for the Quote Register's "Open Quote" behaviour after the revision system
 * was added:
 *  - When a JT quote has no QB link yet → POST /qb/quotes/from-quote/:id (create new)
 *  - When a JT quote has one QB quote   → navigate directly to it
 *  - When a JT quote has multiple QB revisions → navigate to the one with the
 *    highest revision_sequence (the latest), NOT the first in the array
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import QuotesPage from '../pages/QuotesPage';
import api from '../utils/api';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../context/AuthContext');
jest.mock('../utils/api', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../components/JobCreateModal', () => () => null);
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const JT_QUOTE_BASE = {
  id: 'jt-001',
  quote_number: 'Q-0001',
  client_name: 'Acme Corp',
  project: 'Kitchen Fit-out',
  date: '2026-01-15',
  value: 12500,
  status: 'accepted',
  initials: 'GK',
  accept_details: '',
  accept_date: null,
};

function renderWithQuotes(quotes) {
  useAuth.mockReturnValue({ isAdminOrMgr: true, canEdit: true });
  api.get.mockResolvedValue({ data: quotes });

  return render(
    <MemoryRouter>
      <QuotesPage />
    </MemoryRouter>
  );
}

// Q-0001 appears in both desktop table and mobile card — use getAllByText
async function waitForTable() {
  await waitFor(() => {
    expect(screen.getAllByText('Q-0001').length).toBeGreaterThan(0);
  });
}

// Click the first "Open Quote" button — desktop table renders before mobile cards in the DOM
function clickOpenQuote() {
  const buttons = screen.getAllByRole('button', { name: /open quote/i });
  fireEvent.click(buttons[0]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Quote Register — Open Quote button', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls POST from-quote when the JT quote has no QB revisions', async () => {
    api.post.mockResolvedValue({ data: { id: 'new-qb-id' } });
    renderWithQuotes([{ ...JT_QUOTE_BASE, qb_revisions: [] }]);
    await waitForTable();

    clickOpenQuote();

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/qb/quotes/from-quote/jt-001');
      expect(mockNavigate).toHaveBeenCalledWith('/qb/quotes/new-qb-id');
    });
  });

  it('navigates directly to the single QB quote when only one revision exists', async () => {
    renderWithQuotes([{
      ...JT_QUOTE_BASE,
      qb_revisions: [
        { qb_id: 'qb-r0', qb_number: 'V-0001', qb_status: 'draft', revision_sequence: 0, revision_suffix: null, parent_quote_id: null },
      ],
    }]);
    await waitForTable();

    clickOpenQuote();

    // Should navigate directly — no POST should be made
    expect(api.post).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/qb/quotes/qb-r0');
  });

  it('navigates to the LATEST revision (highest revision_sequence) when multiple exist', async () => {
    renderWithQuotes([{
      ...JT_QUOTE_BASE,
      qb_revisions: [
        { qb_id: 'qb-r0', qb_number: 'V-0001',   qb_status: 'locked',   revision_sequence: 0, revision_suffix: null, parent_quote_id: null },
        { qb_id: 'qb-rA', qb_number: 'V-0001-A',  qb_status: 'locked',   revision_sequence: 1, revision_suffix: 'A',  parent_quote_id: 'qb-r0' },
        { qb_id: 'qb-rB', qb_number: 'V-0001-B',  qb_status: 'draft',    revision_sequence: 2, revision_suffix: 'B',  parent_quote_id: 'qb-r0' },
      ],
    }]);
    await waitForTable();

    clickOpenQuote();

    expect(api.post).not.toHaveBeenCalled();
    // Must go to Rev_B (sequence=2), not the original (sequence=0)
    expect(mockNavigate).toHaveBeenCalledWith('/qb/quotes/qb-rB');
  });

  it('navigates to the latest revision even when the array is in reverse order', async () => {
    // Array intentionally ordered highest sequence first to ensure reduce() is used
    renderWithQuotes([{
      ...JT_QUOTE_BASE,
      qb_revisions: [
        { qb_id: 'qb-rC', qb_number: 'V-0001-C', qb_status: 'draft',  revision_sequence: 3, revision_suffix: 'C', parent_quote_id: 'qb-r0' },
        { qb_id: 'qb-r0', qb_number: 'V-0001',   qb_status: 'locked', revision_sequence: 0, revision_suffix: null, parent_quote_id: null },
        { qb_id: 'qb-rA', qb_number: 'V-0001-A', qb_status: 'locked', revision_sequence: 1, revision_suffix: 'A', parent_quote_id: 'qb-r0' },
      ],
    }]);
    await waitForTable();

    clickOpenQuote();

    expect(mockNavigate).toHaveBeenCalledWith('/qb/quotes/qb-rC');
  });

  it('does not call POST from-quote when revisions exist', async () => {
    renderWithQuotes([{
      ...JT_QUOTE_BASE,
      qb_revisions: [
        { qb_id: 'qb-r0', qb_number: 'V-0001', qb_status: 'sent', revision_sequence: 0, revision_suffix: null, parent_quote_id: null },
        { qb_id: 'qb-rA', qb_number: 'V-0001-A', qb_status: 'draft', revision_sequence: 1, revision_suffix: 'A', parent_quote_id: 'qb-r0' },
      ],
    }]);
    await waitForTable();

    clickOpenQuote();

    expect(api.post).not.toHaveBeenCalled();
  });
});
