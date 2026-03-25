import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PrintCenterDrawer from '../PrintCenterDrawer';
import type { PrescriptionData } from '../../api/prescription';

const billingApi = vi.hoisted(() => ({
  getPrescriptionBilling: vi.fn(),
}));

vi.mock('../../api/billing', () => billingApi);

vi.mock('../../hooks/useIsMobile', () => ({
  default: () => true,
}));

const mockPrescription: PrescriptionData = {
  id: 1,
  record_id: 10,
  tenant_id: 1,
  formula_name: '桂枝汤',
  total_doses: 5,
  notes: '饭后温服',
  created_by: 1,
  creator: { id: 1, real_name: '李医生', username: 'dr_li' },
  items: [
    { id: 1, prescription_id: 1, herb_name: '桂枝', dosage: '9', category: 'herb', notes: '', sort_order: 0, created_at: '', updated_at: '' },
    { id: 2, prescription_id: 1, herb_name: '白芍', dosage: '9', category: 'herb', notes: '', sort_order: 1, created_at: '', updated_at: '' },
    { id: 3, prescription_id: 1, herb_name: '六味地黄丸', dosage: '2', category: 'patent', notes: '', sort_order: 2, created_at: '', updated_at: '' },
  ],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const makeMockBillingDetail = (overrides = {}) => ({
  prescription_id: 1,
  record_id: 10,
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
    {
      herb_name: '白芍',
      category: 'herb',
      dosage: '9g',
      dosage_val: 9,
      unit: '克',
      doses: 5,
      unit_price: 0.12,
      item_cost: 5.4,
      in_stock: true,
    },
    {
      herb_name: '六味地黄丸',
      category: 'patent',
      dosage: '2盒',
      dosage_val: 2,
      unit: '盒',
      doses: 1,
      unit_price: 25,
      item_cost: 50,
      in_stock: true,
    },
  ],
  drug_cost_total: 62.6,
  consultation_fee: 100,
  total_amount: 162.6,
  actual_paid: 0,
  stock_deducted: false,
  billing_id: 0,
  created_by: 0,
  ...overrides,
});

const defaultProps = {
  open: true,
  prescription: mockPrescription,
  prescriptionId: 1,
  recordId: 10,
  patientName: '张三',
  patientAge: 45,
  chiefComplaint: '头痛三天',
  treatment: '解表散寒',
  doctorName: '李医生',
  onClose: vi.fn(),
};

describe('PrintCenterDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    billingApi.getPrescriptionBilling.mockResolvedValue({
      code: 0,
      data: makeMockBillingDetail(),
    });
  });

  it('renders drawer with title when open', async () => {
    render(<PrintCenterDrawer {...defaultProps} />);

    expect(screen.getByText('打印中心')).toBeInTheDocument();
  });

  it('loads billing detail on open', async () => {
    render(<PrintCenterDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(billingApi.getPrescriptionBilling).toHaveBeenCalledWith(1);
    });
  });

  it('does not load billing when closed', () => {
    render(<PrintCenterDrawer {...defaultProps} open={false} />);

    expect(billingApi.getPrescriptionBilling).not.toHaveBeenCalled();
  });

  it('shows mode selector with 3 options', async () => {
    render(<PrintCenterDrawer {...defaultProps} />);

    expect(screen.getAllByText('仅打印处方').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('仅打印收费').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('合并打印').length).toBeGreaterThanOrEqual(1);
  });

  it('defaults to combined mode with both sections', async () => {
    render(<PrintCenterDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getAllByText('处方预览').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getAllByText('收费预览').length).toBeGreaterThanOrEqual(1);
  });

  it('shows prescription herbs and patents in preview', async () => {
    render(<PrintCenterDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getAllByText('处方预览').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getAllByText(/桂枝/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/白芍/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows prescription notes', async () => {
    render(<PrintCenterDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/饭后温服/)).toBeInTheDocument();
    });
  });

  it('shows billing drug items after loading', async () => {
    render(<PrintCenterDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('收费预览')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('中药明细')).toBeInTheDocument();
    });
  });

  it('shows billing summary with amounts', async () => {
    render(<PrintCenterDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('药费合计')).toBeInTheDocument();
    });

    expect(screen.getByText('应收')).toBeInTheDocument();
    expect(screen.getByText('实收')).toBeInTheDocument();
  });

  it('shows print button in footer (no billing actions)', async () => {
    render(<PrintCenterDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('预览打印')).toBeInTheDocument();
    });

    // Billing action buttons should not exist in footer
    expect(screen.queryByText('收费出库')).not.toBeInTheDocument();
  });

  it('switches to prescription-only mode and hides billing section', async () => {
    render(<PrintCenterDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getAllByText('收费预览').length).toBeGreaterThanOrEqual(1);
    });

    // Click the "仅打印处方" option in Segmented
    fireEvent.click(screen.getAllByText('仅打印处方')[0]);

    expect(screen.getAllByText('处方预览').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('收费预览')).not.toBeInTheDocument();
  });

  it('switches to billing-only mode and hides prescription section', async () => {
    render(<PrintCenterDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getAllByText('处方预览').length).toBeGreaterThanOrEqual(1);
    });

    // Click "仅打印收费" in the Segmented (first occurrence)
    fireEvent.click(screen.getAllByText('仅打印收费')[0]);

    await waitFor(() => {
      expect(screen.queryByText('处方预览')).not.toBeInTheDocument();
    });
    expect(screen.getAllByText('收费预览').length).toBeGreaterThanOrEqual(1);
  });

  it('shows stock deducted tag in billing preview', async () => {
    billingApi.getPrescriptionBilling.mockResolvedValue({
      code: 0,
      data: makeMockBillingDetail({ stock_deducted: true }),
    });

    render(<PrintCenterDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getAllByText('已出库').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('opens print window on print button click', async () => {
    // Override isMobile to false for desktop print path (window.open)
    const useIsMobileMod = await import('../../hooks/useIsMobile');
    vi.spyOn(useIsMobileMod, 'default').mockReturnValue(false);

    const mockOpen = vi.fn().mockReturnValue({
      document: { write: vi.fn(), close: vi.fn() },
      print: vi.fn(),
      close: vi.fn(),
    });
    vi.spyOn(window, 'open').mockImplementation(mockOpen);

    render(<PrintCenterDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('预览打印')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('预览打印'));

    expect(mockOpen).toHaveBeenCalledWith('', '_blank');

    vi.restoreAllMocks();
  });

  it('handles empty prescription (no items)', async () => {
    const emptyPrescription: PrescriptionData = {
      ...mockPrescription,
      items: [],
    };

    billingApi.getPrescriptionBilling.mockResolvedValue({
      code: 0,
      data: makeMockBillingDetail({ items: [], drug_cost_total: 0 }),
    });

    render(<PrintCenterDrawer {...defaultProps} prescription={emptyPrescription} />);

    await waitFor(() => {
      expect(screen.getByText('仅收取诊疗费（无药品）')).toBeInTheDocument();
    });
  });
});
