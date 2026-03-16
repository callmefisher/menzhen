import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import BillingDrawer from '../BillingDrawer';

const billingApi = vi.hoisted(() => ({
  getPrescriptionBilling: vi.fn(),
  createPrescriptionBilling: vi.fn().mockResolvedValue({ code: 0, data: {} }),
  deductStockAndBill: vi.fn().mockResolvedValue({ code: 0, data: {} }),
  listRecordBillings: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  getRecordBillingDetail: vi.fn(),
  createRecordBilling: vi.fn().mockResolvedValue({ code: 0, data: {} }),
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
      unit_price: 0.16,
      item_cost: 7.2,
      in_stock: true,
    },
  ],
  drug_cost_total: 7.2,
  consultation_fee: 100,
  total_amount: 107.2,
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
      code: 0,
      data: makeMockDetail(),
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
      expect(screen.getAllByText(/桂枝汤/).length).toBeGreaterThan(0);
    });

    expect(screen.getByText('5 付')).toBeInTheDocument();
    expect(screen.getByText('中药明细')).toBeInTheDocument();
  });

  it('calls getPrescriptionBilling on open', async () => {
    billingApi.getPrescriptionBilling.mockResolvedValue({
      code: 0,
      data: makeMockDetail(),
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
      code: 0,
      data: makeMockDetail(),
    });

    render(
      <BillingDrawer
        open={true}
        prescriptionId={1}
        onClose={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('收费并出库')).toBeInTheDocument();
    });

    const deductBtn = screen.getByText('收费并出库').closest('button');
    expect(deductBtn).not.toBeDisabled();
  });

  it('shows stock deducted tag when already deducted', async () => {
    billingApi.getPrescriptionBilling.mockResolvedValue({
      code: 0,
      data: makeMockDetail({ stock_deducted: true }),
    });

    render(
      <BillingDrawer
        open={true}
        prescriptionId={2}
        onClose={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText(/桂枝汤/).length).toBeGreaterThan(0);
    });

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

  it('uses record-level billing when no prescriptionId', async () => {
    billingApi.getRecordBillingDetail.mockResolvedValue({
      code: 0,
      data: {
        prescription_id: 0,
        record_id: 10,
        formula_name: '',
        total_doses: 0,
        items: [],
        drug_cost_total: 0,
        consultation_fee: 100,
        total_amount: 100,
        actual_paid: 0,
        stock_deducted: false,
        billing_id: 0,
        created_by: 0,
      },
    });

    render(
      <BillingDrawer
        open={true}
        recordId={10}
        onClose={() => {}}
      />
    );

    await waitFor(() => {
      expect(billingApi.getRecordBillingDetail).toHaveBeenCalledWith(10);
    });

    expect(screen.getByText('仅收取诊疗费（无药品）')).toBeInTheDocument();
  });
});
