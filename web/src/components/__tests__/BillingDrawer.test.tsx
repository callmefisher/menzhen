import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import BillingDrawer from '../BillingDrawer';

const billingApi = vi.hoisted(() => ({
  getPrescriptionBilling: vi.fn(),
  createPrescriptionBilling: vi.fn().mockResolvedValue({ data: {} }),
  deductStockAndBill: vi.fn().mockResolvedValue({ data: {} }),
  listRecordBillings: vi.fn().mockResolvedValue({ data: { data: [] } }),
}));

vi.mock('../../api/billing', () => billingApi);

vi.mock('../../hooks/useIsMobile', () => ({
  default: () => false,
}));

const makeMockDetail = (overrides = {}) => ({
  prescription_id: 1,
  record_id: 1,
  formula_name: '桂枝汤',
  total_doses: 5,
  items: [
    {
      herb_name: '桂枝',
      category: 'herb',
      dosage: '9g',
      dosage_val: 9,
      unit: '克',
      doses: 5,
      unit_price: 0.8,
      item_cost: 36,
      in_stock: true,
    },
  ],
  drug_cost_total: 36,
  consultation_fee: 100,
  total_amount: 136,
  actual_paid: 0,
  stock_deducted: false,
  billing_id: 0,
  created_by: 0,
  ...overrides,
});

describe('BillingDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders drawer with billing detail when open', async () => {
    billingApi.getPrescriptionBilling.mockResolvedValue({
      data: { data: makeMockDetail() },
    });

    render(
      <BillingDrawer
        open={true}
        prescriptionId={1}
        patientName="张三"
        patientAge={30}
        doctorName="李医生"
        onClose={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('桂枝汤')).toBeInTheDocument();
    });

    expect(screen.getByText('5 付')).toBeInTheDocument();
    expect(screen.getByText('中药明细')).toBeInTheDocument();
  });

  it('calls getPrescriptionBilling on open', async () => {
    billingApi.getPrescriptionBilling.mockResolvedValue({
      data: { data: makeMockDetail() },
    });

    render(
      <BillingDrawer
        open={true}
        prescriptionId={42}
        onClose={() => {}}
      />
    );

    await waitFor(() => {
      expect(billingApi.getPrescriptionBilling).toHaveBeenCalledWith(42);
    });
  });

  it('shows deduct stock button when not yet deducted', async () => {
    billingApi.getPrescriptionBilling.mockResolvedValue({
      data: { data: makeMockDetail() },
    });

    render(
      <BillingDrawer
        open={true}
        prescriptionId={1}
        onClose={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('扣除库存并打印')).toBeInTheDocument();
    });

    const deductBtn = screen.getByText('扣除库存并打印').closest('button');
    expect(deductBtn).not.toBeDisabled();
  });

  it('shows stock deducted tag when already deducted', async () => {
    billingApi.getPrescriptionBilling.mockResolvedValue({
      data: { data: makeMockDetail({ stock_deducted: true }) },
    });

    render(
      <BillingDrawer
        open={true}
        prescriptionId={2}
        onClose={() => {}}
      />
    );

    // Wait for detail to load
    await waitFor(() => {
      expect(screen.getByText('桂枝汤')).toBeInTheDocument();
    });

    // The green tag within the detail area should indicate stock was deducted
    const tags = screen.getAllByText('库存已扣除');
    expect(tags.length).toBeGreaterThan(0);
  });

  it('does not fetch when closed', () => {
    render(
      <BillingDrawer
        open={false}
        prescriptionId={1}
        onClose={() => {}}
      />
    );

    expect(billingApi.getPrescriptionBilling).not.toHaveBeenCalled();
  });
});
