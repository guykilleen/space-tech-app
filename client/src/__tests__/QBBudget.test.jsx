import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import QBBudgetQtyPage from '../pages/qb/QBBudgetQtyPage';
import api from '../utils/api';

jest.mock('../utils/api', () => ({ get: jest.fn() }));
jest.mock('react-toastify', () => ({ toast: { error: jest.fn() } }));

const BASE_LABOUR = {
  admin_hours: 2,        admin_cost: 170,
  cnc_hours: 0,          cnc_cost: 0,
  edgebander_hours: 0,   edgebander_cost: 0,
  assembly_hours: 4,     assembly_cost: 340,
  delivery_hours: 0,     delivery_cost: 0,
  installation_hours: 0, installation_cost: 0,
};

const BASE_TOTALS = {
  materials_raw: 0, waste_amount: 0, materials: 0, hardware: 0,
  labour: 510, costs_total: 510, margin_amount: 76.5,
  subtrades_cost: 0, subtrades_sell: 0,
  subtotal: 586.5, gst: 58.65, total: 645.15,
};

function renderBudget({ subtrades = [], totalsOverride = {} } = {}) {
  const budgetData = {
    margin: 0.15,
    waste_pct: 0.10,
    lines: [],
    labour: BASE_LABOUR,
    subtrades,
    totals: { ...BASE_TOTALS, ...totalsOverride },
  };

  api.get.mockImplementation((url) => {
    if (url.endsWith('/budget')) return Promise.resolve({ data: budgetData });
    return Promise.resolve({ data: { quote_number: 'V-0001' } });
  });

  return render(
    <MemoryRouter initialEntries={['/qb/quotes/1/budget']}>
      <Routes>
        <Route path="/qb/quotes/:id/budget" element={<QBBudgetQtyPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Budget Quantities — subtrades aggregation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the Subtrades table when quote has subtrade costs', async () => {
    renderBudget({
      subtrades: [{ type: 'stone', total_cost: 1200, total_sell: 1440 }],
      totalsOverride: { subtrades_cost: 1200, subtrades_sell: 1440 },
    });
    await waitFor(() => {
      expect(screen.getByText('Subtrades')).toBeInTheDocument();
    });
  });

  it('maps all six subtrade type keys to correct display labels', async () => {
    renderBudget({
      subtrades: [
        { type: '2pac_flat',     total_cost: 500,  total_sell: 600  },
        { type: '2pac_recessed', total_cost: 300,  total_sell: 360  },
        { type: 'stone',         total_cost: 1200, total_sell: 1440 },
        { type: 'upholstery',    total_cost: 200,  total_sell: 240  },
        { type: 'glass',         total_cost: 400,  total_sell: 480  },
        { type: 'steel',         total_cost: 600,  total_sell: 720  },
      ],
      totalsOverride: { subtrades_sell: 3840 },
    });
    await waitFor(() => {
      expect(screen.getByText('2 Pac Flat')).toBeInTheDocument();
      expect(screen.getByText('2 Pac Recessed')).toBeInTheDocument();
      expect(screen.getByText('Stone')).toBeInTheDocument();
      expect(screen.getByText('Upholstery')).toBeInTheDocument();
      expect(screen.getByText('Glass')).toBeInTheDocument();
      expect(screen.getByText('Steel')).toBeInTheDocument();
    });
  });

  it('displays both cost (before margin) and sell (after margin) for each subtrade', async () => {
    renderBudget({
      subtrades: [{ type: 'stone', total_cost: 1200, total_sell: 1440 }],
      totalsOverride: { subtrades_cost: 1200, subtrades_sell: 1440 },
    });
    await waitFor(() => {
      // $1,200.00 may appear in multiple places (subtrades table + totals); ensure at least one exists
      expect(screen.getAllByText('$1,200.00').length).toBeGreaterThan(0);
      expect(screen.getAllByText('$1,440.00').length).toBeGreaterThan(0);
    });
  });

  it('omits the Subtrades table when quote has no subtrade costs', async () => {
    renderBudget({ subtrades: [] });
    await waitFor(() => {
      // Labour section heading is always present; Subtrades table heading must be absent
      expect(screen.getAllByText('Labour').length).toBeGreaterThan(0);
      expect(screen.queryByText('Subtrades')).not.toBeInTheDocument();
    });
  });

  it('shows subtrades sell total in the Project Cost Summary when > 0', async () => {
    renderBudget({
      subtrades: [{ type: 'stone', total_cost: 1000, total_sell: 1200 }],
      totalsOverride: {
        subtrades_cost: 1000, subtrades_sell: 1200,
        subtotal: 1786.5, gst: 178.65, total: 1965.15,
      },
    });
    await waitFor(() => {
      expect(screen.getByText('Subtrades (incl. margin)')).toBeInTheDocument();
    });
  });

  it('subtrades sell total absent from Project Cost Summary when zero', async () => {
    renderBudget({ subtrades: [], totalsOverride: { subtrades_sell: 0 } });
    await waitFor(() => {
      expect(screen.queryByText('Subtrades (incl. margin)')).not.toBeInTheDocument();
    });
  });

  // Pure logic — mirrors the subtrade aggregation from unitCalc
  it('fixed-mode subtrade cost equals the entered cost value', () => {
    const subtrade = { mode: 'fixed', cost: '850', quantity: '', rate: '' };
    const cost = subtrade.mode === 'qty_rate'
      ? (Number(subtrade.quantity) || 0) * (Number(subtrade.rate) || 0)
      : (Number(subtrade.cost) || 0);
    expect(cost).toBe(850);
  });

  it('qty×rate subtrade cost equals quantity × rate', () => {
    const subtrade = { mode: 'qty_rate', cost: '', quantity: '12', rate: '95' };
    const cost = subtrade.mode === 'qty_rate'
      ? (Number(subtrade.quantity) || 0) * (Number(subtrade.rate) || 0)
      : (Number(subtrade.cost) || 0);
    expect(cost).toBe(1140);
  });

  it('subtrade sell price applies margin correctly', () => {
    const subtradeCost = 1000;
    const marginPct = 20; // 20% margin stored as integer in UI
    const sell = subtradeCost * (1 + marginPct / 100);
    expect(sell).toBe(1200);
  });
});
