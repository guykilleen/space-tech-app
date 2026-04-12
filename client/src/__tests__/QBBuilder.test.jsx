import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import QBQuoteBuilderPage from '../pages/qb/QBQuoteBuilderPage';
import { QBDirtyProvider } from '../context/QBDirtyContext';
import api from '../utils/api';

jest.mock('../utils/api', () => ({ get: jest.fn(), post: jest.fn(), put: jest.fn() }));
jest.mock('react-toastify', () => ({
  toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() },
}));
jest.mock('../components/JobCreateModal', () => () => null);

const MOCK_LABOUR_RATES = {
  admin: 85, cnc: 95, edgebander: 90,
  assembly: 85, delivery: 80, installation: 85,
};

// Price list contains several of the known default material/hardware names
const MOCK_PRICE_LIST = [
  { id: 1,  product: '16mm HMR White',       category: 'Materials', price: 45,  unit: 'm2'   },
  { id: 2,  product: '16mm HMR Black',        category: 'Materials', price: 48,  unit: 'm2'   },
  { id: 3,  product: '25mm HMR White',        category: 'Materials', price: 52,  unit: 'm2'   },
  { id: 4,  product: '18mm STD MDF',          category: 'Materials', price: 38,  unit: 'm2'   },
  { id: 5,  product: '16mm STD MDF',          category: 'Materials', price: 36,  unit: 'm2'   },
  { id: 6,  product: '22x1 ABS',              category: 'Materials', price: 8,   unit: 'lm'   },
  { id: 7,  product: 'Handle',                category: 'Hardware',  price: 12,  unit: 'each' },
  { id: 8,  product: 'Std Finista',           category: 'Hardware',  price: 25,  unit: 'each' },
  { id: 9,  product: 'KD & Rafix',            category: 'Hardware',  price: 3.5, unit: 'set'  },
  { id: 10, product: 'Freight Charge',        category: 'Hardware',  price: 150, unit: 'job'  },
];

function renderNewQuote() {
  api.get.mockImplementation((url) => {
    if (url.includes('price-list'))   return Promise.resolve({ data: MOCK_PRICE_LIST });
    if (url.includes('contacts'))     return Promise.resolve({ data: [] });
    if (url.includes('labour-rates')) return Promise.resolve({ data: MOCK_LABOUR_RATES });
    if (url.includes('next-number'))  return Promise.resolve({ data: { next_number: 'V-0001' } });
    return Promise.resolve({ data: {} });
  });

  return render(
    <MemoryRouter initialEntries={['/qb/quotes/new']}>
      <Routes>
        <Route path="/qb/quotes/new" element={
          <QBDirtyProvider>
            <QBQuoteBuilderPage />
          </QBDirtyProvider>
        } />
      </Routes>
    </MemoryRouter>
  );
}

// ── Labour section — rates read-only ─────────────────────────────────────
describe('Labour section — rates read-only on unit sheet', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders exactly 6 hours inputs (one per labour type)', async () => {
    const { container } = renderNewQuote();
    await waitFor(() => {
      // CRA test env uses identity-obj-proxy: styles.labourHoursInput → class "labourHoursInput"
      expect(container.querySelectorAll('.labourHoursInput')).toHaveLength(6);
    });
  });

  it('labour rates are displayed as non-interactive span elements', async () => {
    const { container } = renderNewQuote();
    await waitFor(() => {
      const rateDisplays = container.querySelectorAll('.labourRateDisplay');
      expect(rateDisplays).toHaveLength(6);
      rateDisplays.forEach(el => expect(el.tagName).toBe('SPAN'));
    });
  });

  it('rate display text matches $/hr format', async () => {
    const { container } = renderNewQuote();
    await waitFor(() => {
      const rateDisplays = [...container.querySelectorAll('.labourRateDisplay')];
      expect(rateDisplays.length).toBeGreaterThan(0);
      rateDisplays.forEach(el => expect(el.textContent).toMatch(/\$\d+\/hr/));
    });
  });

  it('no rateInput elements exist (old per-unit rate editing is removed)', async () => {
    const { container } = renderNewQuote();
    await waitFor(() => {
      expect(container.querySelectorAll('.rateInput')).toHaveLength(0);
    });
  });

  it('hours inputs use step=0.5 for half-hour increments', async () => {
    const { container } = renderNewQuote();
    await waitFor(() => {
      const hoursInputs = [...container.querySelectorAll('.labourHoursInput')];
      expect(hoursInputs.length).toBeGreaterThan(0);
      hoursInputs.forEach(input => expect(input.step).toBe('0.5'));
    });
  });
});

// ── Default materials list ────────────────────────────────────────────────
describe('Default materials list', () => {
  beforeEach(() => jest.clearAllMocks());

  it('new unit is pre-populated with default lines shown at quantity 0', async () => {
    const { container } = renderNewQuote();
    await waitFor(() => {
      // Lines with qty=0 receive className "lineDimmed" (identity-obj-proxy resolves module class name)
      const dimmedRows = container.querySelectorAll('.lineDimmed');
      expect(dimmedRows.length).toBeGreaterThan(0);
    });
  });

  it('known default material names appear in the lines table', async () => {
    const { container } = renderNewQuote();
    await waitFor(() => {
      // The product select options should include default names from the price list
      const selects = container.querySelectorAll('select');
      const allOptions = [...selects].flatMap(s => [...s.options].map(o => o.text));
      expect(allOptions.some(t => t.includes('16mm HMR White'))).toBe(true);
      expect(allOptions.some(t => t.includes('Handle'))).toBe(true);
    });
  });

  // Pure logic tests — mirror the filtering logic in QBQuoteBuilderPage handleSave
  it('zero-quantity lines are excluded from the save payload', () => {
    const lines = [
      { product: '16mm HMR White', quantity: 0,   price_list_id: 1 },
      { product: '22x1 ABS',       quantity: 2.5, price_list_id: 6 },
      { product: 'Handle',         quantity: 3,   price_list_id: 7 },
    ];
    const saved = lines.filter(l => l.product.trim() && Number(l.quantity) > 0);
    expect(saved).toHaveLength(2);
    expect(saved.map(l => l.product)).toEqual(['22x1 ABS', 'Handle']);
  });

  it('lines with empty product name are excluded from the save payload', () => {
    const lines = [
      { product: '',       quantity: 5,  price_list_id: null },
      { product: '  ',     quantity: 2,  price_list_id: null },
      { product: 'Handle', quantity: 1,  price_list_id: 7 },
    ];
    const saved = lines.filter(l => l.product.trim() && Number(l.quantity) > 0);
    expect(saved).toHaveLength(1);
    expect(saved[0].product).toBe('Handle');
  });

  it('mergeWithDefaults does not duplicate lines already present', () => {
    // Mirrors the mergeWithDefaults logic in QBQuoteBuilderPage
    const existingLines = [
      { price_list_id: 1, product: '16mm HMR White', quantity: 3 },
    ];
    const defaults = [
      { price_list_id: 1, product: '16mm HMR White', quantity: 0 }, // same id — skip
      { price_list_id: 2, product: '16mm HMR Black', quantity: 0 }, // new — add
    ];
    const result = [...existingLines];
    for (const def of defaults) {
      if (!existingLines.some(l => l.price_list_id === def.price_list_id)) {
        result.push(def);
      }
    }
    expect(result).toHaveLength(2);
    // Existing line keeps its saved quantity, not overwritten by default
    expect(result.find(l => l.price_list_id === 1).quantity).toBe(3);
    // Missing default is added at qty=0
    expect(result.find(l => l.price_list_id === 2).quantity).toBe(0);
  });
});

// ── unitCalc — global labour rates ────────────────────────────────────────
describe('Labour cost calculation uses global price list rates', () => {
  // Mirrors unitCalc from QBQuoteBuilderPage
  const LABOUR_FIELDS = [
    { hoursField: 'admin_hours',        type: 'admin' },
    { hoursField: 'cnc_hours',          type: 'cnc' },
    { hoursField: 'edgebander_hours',   type: 'edgebander' },
    { hoursField: 'assembly_hours',     type: 'assembly' },
    { hoursField: 'delivery_hours',     type: 'delivery' },
    { hoursField: 'installation_hours', type: 'installation' },
  ];
  function calcLabour(unit, labourRates) {
    return LABOUR_FIELDS.reduce(
      (s, { hoursField, type }) => s + Number(unit[hoursField] ?? 0) * Number(labourRates[type] ?? 100),
      0
    );
  }

  it('labour cost is hours × global rate for each type', () => {
    const unit = {
      admin_hours: 2, cnc_hours: 1, edgebander_hours: 0,
      assembly_hours: 4, delivery_hours: 0, installation_hours: 0,
    };
    const rates = { admin: 85, cnc: 95, edgebander: 90, assembly: 85, delivery: 80, installation: 85 };
    // 2×85 + 1×95 + 4×85 = 170 + 95 + 340 = 605
    expect(calcLabour(unit, rates)).toBe(605);
  });

  it('ignores any per-unit stored rate — only global rate is used', () => {
    const unit = {
      admin_hours: 2, cnc_hours: 0, edgebander_hours: 0,
      assembly_hours: 0, delivery_hours: 0, installation_hours: 0,
      admin_rate: 999, // old stored override — must NOT be used
    };
    const rates = { admin: 85, cnc: 95, edgebander: 90, assembly: 85, delivery: 80, installation: 85 };
    // Only uses rates.admin (85), not unit.admin_rate (999)
    expect(calcLabour(unit, rates)).toBe(2 * 85);
  });

  it('zero hours for all types gives zero labour cost', () => {
    const unit = {
      admin_hours: 0, cnc_hours: 0, edgebander_hours: 0,
      assembly_hours: 0, delivery_hours: 0, installation_hours: 0,
    };
    const rates = { admin: 85, cnc: 95, edgebander: 90, assembly: 85, delivery: 80, installation: 85 };
    expect(calcLabour(unit, rates)).toBe(0);
  });
});
