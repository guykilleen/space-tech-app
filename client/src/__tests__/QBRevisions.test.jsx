/**
 * QBRevisions.test.jsx
 *
 * Tests for the QB quote revision system:
 *  1. buildDisplayList — pure grouping logic from QBQuotesListPage
 *  2. QB Builder read-only mode — fieldset disabled, Revise button shown,
 *     Save button hidden when quote is loaded with a non-draft status
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QBDirtyProvider } from '../context/QBDirtyContext';
import QBQuoteBuilderPage from '../pages/qb/QBQuoteBuilderPage';
import api from '../utils/api';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../utils/api', () => ({ get: jest.fn(), post: jest.fn(), put: jest.fn() }));
jest.mock('react-toastify', () => ({
  toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() },
}));
jest.mock('../components/JobCreateModal', () => () => null);

// ── Helpers ──────────────────────────────────────────────────────────────────

// Inline copy of buildDisplayList from QBQuotesListPage — tested as a pure function.
// If the implementation ever moves to a shared module, import it instead.
function buildDisplayList(quotes, expandedGroups) {
  const roots    = quotes.filter(q => !q.parent_quote_id);
  const children = quotes.filter(q =>  q.parent_quote_id);
  const rows = [];
  for (const root of roots) {
    const kids = children
      .filter(c => c.parent_quote_id === root.id)
      .sort((a, b) => a.revision_sequence - b.revision_sequence);
    const hasChildren = kids.length > 0;
    rows.push({ quote: root, isRoot: true, isChild: false, hasChildren, groupId: root.id });
    if (hasChildren && expandedGroups.has(root.id)) {
      for (const kid of kids) {
        rows.push({ quote: kid, isRoot: false, isChild: true, hasChildren: false, groupId: root.id });
      }
    }
  }
  const rootIds = new Set(roots.map(r => r.id));
  for (const child of children) {
    if (!rootIds.has(child.parent_quote_id)) {
      rows.push({ quote: child, isRoot: false, isChild: false, hasChildren: false, groupId: child.id });
    }
  }
  return rows;
}

// Sample quote data
const ROOT  = { id: 'r1', parent_quote_id: null,  quote_number: 'V-0001',   revision_sequence: 0 };
const REV_A = { id: 'a1', parent_quote_id: 'r1',  quote_number: 'V-0001-A', revision_sequence: 1 };
const REV_B = { id: 'b1', parent_quote_id: 'r1',  quote_number: 'V-0001-B', revision_sequence: 2 };
const SOLO  = { id: 's1', parent_quote_id: null,  quote_number: 'V-0002',   revision_sequence: 0 };

const MOCK_PRICE_LIST  = [];
const MOCK_LABOUR_RATES = { admin: 85, cnc: 95, edgebander: 90, assembly: 85, delivery: 80, installation: 85 };

function renderExistingQuote(quoteStatus) {
  const mockQuote = {
    id: 'qid-1',
    quote_number: 'V-0001',
    date: '2026-01-01',
    status: quoteStatus,
    client_id: null,
    project: 'Test Project',
    prepared_by: 'GK',
    margin: 0.15,
    waste_pct: 0.10,
    notes: '',
    quote_id: null,
    group_has_draft: false,
    units: [],
  };

  api.get.mockImplementation((url) => {
    if (url.includes('price-list'))   return Promise.resolve({ data: MOCK_PRICE_LIST });
    if (url.includes('contacts'))     return Promise.resolve({ data: [] });
    if (url.includes('labour-rates')) return Promise.resolve({ data: MOCK_LABOUR_RATES });
    if (url.includes('/qb/quotes/qid-1')) return Promise.resolve({ data: mockQuote });
    return Promise.resolve({ data: {} });
  });

  return render(
    <MemoryRouter initialEntries={['/qb/quotes/qid-1']}>
      <Routes>
        <Route path="/qb/quotes/:id" element={
          <QBDirtyProvider>
            <QBQuoteBuilderPage />
          </QBDirtyProvider>
        } />
      </Routes>
    </MemoryRouter>
  );
}

// ── Suite 1: buildDisplayList ────────────────────────────────────────────────

describe('buildDisplayList — QB quote grouping logic', () => {
  it('root-only quote produces a single row with isRoot=true and hasChildren=false', () => {
    const rows = buildDisplayList([SOLO], new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].isRoot).toBe(true);
    expect(rows[0].hasChildren).toBe(false);
    expect(rows[0].isChild).toBe(false);
  });

  it('root with two revisions shows only the root row when group is collapsed', () => {
    const rows = buildDisplayList([ROOT, REV_A, REV_B], new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].quote.id).toBe('r1');
    expect(rows[0].hasChildren).toBe(true);
  });

  it('root with two revisions shows three rows when group is expanded', () => {
    const rows = buildDisplayList([ROOT, REV_A, REV_B], new Set(['r1']));
    expect(rows).toHaveLength(3);
    expect(rows[0].isRoot).toBe(true);
    expect(rows[1].isChild).toBe(true);
    expect(rows[2].isChild).toBe(true);
  });

  it('child rows are sorted by revision_sequence ascending', () => {
    const rows = buildDisplayList([ROOT, REV_B, REV_A], new Set(['r1'])); // B before A in input
    expect(rows[1].quote.revision_sequence).toBe(1); // Rev_A first
    expect(rows[2].quote.revision_sequence).toBe(2); // Rev_B second
  });

  it('root row carries the correct groupId', () => {
    const rows = buildDisplayList([ROOT, REV_A], new Set(['r1']));
    expect(rows[0].groupId).toBe('r1');
    expect(rows[1].groupId).toBe('r1');
  });

  it('multiple root quotes each produce their own row', () => {
    const rows = buildDisplayList([ROOT, SOLO], new Set());
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.quote.id)).toEqual(expect.arrayContaining(['r1', 's1']));
  });

  it('expanding one group does not expand another', () => {
    const ROOT2  = { id: 'r2', parent_quote_id: null, quote_number: 'V-0003', revision_sequence: 0 };
    const REV_R2 = { id: 'c2', parent_quote_id: 'r2', quote_number: 'V-0003-A', revision_sequence: 1 };
    // Only expand r1's group
    const rows = buildDisplayList([ROOT, REV_A, ROOT2, REV_R2], new Set(['r1']));
    // r1 expanded (2 rows), r2 collapsed (1 row) → total 3
    expect(rows).toHaveLength(3);
    const r2Row = rows.find(r => r.quote.id === 'r2');
    expect(r2Row.hasChildren).toBe(true);
    const r2ChildShown = rows.some(r => r.quote.id === 'c2');
    expect(r2ChildShown).toBe(false);
  });

  it('orphaned child (parent deleted) appears as a flat non-root non-child row', () => {
    const orphan = { id: 'o1', parent_quote_id: 'missing-id', quote_number: 'V-0099-A', revision_sequence: 1 };
    const rows = buildDisplayList([orphan], new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].isRoot).toBe(false);
    expect(rows[0].isChild).toBe(false);
  });
});

// ── Suite 2: QB Builder read-only mode ───────────────────────────────────────

describe('QB Builder — read-only mode for non-draft statuses', () => {
  beforeEach(() => jest.clearAllMocks());

  it('draft quote: Save Quote button is visible and fieldset is enabled', async () => {
    renderExistingQuote('draft');
    // "Save Quote" appears in both desktop action bar and mobile save bar
    await waitFor(() => {
      expect(screen.getAllByText('Save Quote').length).toBeGreaterThan(0);
    });
    // No read-only banner
    expect(screen.queryByText(/cannot be edited/i)).not.toBeInTheDocument();
    // fieldset should not be disabled
    const fieldsets = document.querySelectorAll('fieldset[disabled]');
    expect(fieldsets.length).toBe(0);
  });

  it('sent quote: Revise button is visible and Save Quote is hidden', async () => {
    renderExistingQuote('sent');
    // "Revise" appears in both desktop action bar and mobile save bar
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /revise/i }).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('Save Quote')).not.toBeInTheDocument();
  });

  it('accepted quote: Revise button is visible and Save Quote is hidden', async () => {
    renderExistingQuote('accepted');
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /revise/i }).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('Save Quote')).not.toBeInTheDocument();
  });

  it('locked quote: Revise button is visible and Save Quote is hidden', async () => {
    renderExistingQuote('locked');
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /revise/i }).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('Save Quote')).not.toBeInTheDocument();
  });

  it('sent quote: read-only banner is displayed', async () => {
    renderExistingQuote('sent');
    await waitFor(() => {
      expect(screen.getByText(/cannot be edited/i)).toBeInTheDocument();
    });
  });

  it('sent quote: form fieldset is disabled', async () => {
    renderExistingQuote('sent');
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /revise/i }).length).toBeGreaterThan(0);
    });
    const disabledFieldsets = document.querySelectorAll('fieldset[disabled]');
    expect(disabledFieldsets.length).toBeGreaterThan(0);
  });

  it('locked quote with existing draft: Revise button is disabled', async () => {
    // Override mock to set group_has_draft = true
    api.get.mockImplementation((url) => {
      if (url.includes('price-list'))   return Promise.resolve({ data: [] });
      if (url.includes('contacts'))     return Promise.resolve({ data: [] });
      if (url.includes('labour-rates')) return Promise.resolve({ data: MOCK_LABOUR_RATES });
      if (url.includes('/qb/quotes/qid-1')) return Promise.resolve({ data: {
        id: 'qid-1', quote_number: 'V-0001', date: '2026-01-01',
        status: 'locked', client_id: null, project: 'Test', prepared_by: 'GK',
        margin: 0.15, waste_pct: 0.10, notes: '', quote_id: null,
        group_has_draft: true, units: [],
      }});
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter initialEntries={['/qb/quotes/qid-1']}>
        <Routes>
          <Route path="/qb/quotes/:id" element={
            <QBDirtyProvider><QBQuoteBuilderPage /></QBDirtyProvider>
          } />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      // Both desktop and mobile Revise buttons should be disabled
      const reviseBtns = screen.getAllByRole('button', { name: /revise/i });
      expect(reviseBtns.length).toBeGreaterThan(0);
      expect(reviseBtns.every(btn => btn.disabled)).toBe(true);
    });
  });
});
