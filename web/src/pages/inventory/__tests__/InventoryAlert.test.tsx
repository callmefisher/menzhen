import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import InventoryAlert from '../InventoryAlert';

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return {
    ...actual,
    message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  };
});

const mockListInventoryDrugs = vi.fn();

vi.mock('../../../api/inventory', () => ({
  listInventoryDrugs: (...args: unknown[]) => mockListInventoryDrugs(...args),
}));

const lowStockHerb = {
  id: 1, tenant_id: 1, name: '当归', category: 'herb',
  stock: 100, purchase_price: 60, selling_price: 80,
  alert_threshold: null, remark: '', created_at: '2025-01-01', updated_at: '2025-01-01',
};

const lowStockPatent = {
  id: 2, tenant_id: 1, name: '感冒灵', category: 'patent',
  stock: 3, purchase_price: 15, selling_price: 25,
  alert_threshold: null, remark: '', created_at: '2025-01-01', updated_at: '2025-01-01',
};

const sufficientHerb = {
  id: 3, tenant_id: 1, name: '黄芪', category: 'herb',
  stock: 9999, purchase_price: 40, selling_price: 60,
  alert_threshold: null, remark: '', created_at: '2025-01-01', updated_at: '2025-01-01',
};

describe('InventoryAlert', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const renderComponent = () =>
    render(
      <MemoryRouter>
        <InventoryAlert />
      </MemoryRouter>
    );

  it('renders alert rows for low-stock drugs', { timeout: 15000 }, async () => {
    mockListInventoryDrugs.mockResolvedValue({
      data: { list: [lowStockHerb, lowStockPatent, sufficientHerb], total: 3 },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('当归')).toBeInTheDocument();
    });
    expect(screen.getByText('感冒灵')).toBeInTheDocument();
    // sufficient stock herb should NOT appear
    expect(screen.queryByText('黄芪')).not.toBeInTheDocument();
  });

  it('renders empty state when no alerts', { timeout: 15000 }, async () => {
    mockListInventoryDrugs.mockResolvedValue({
      data: { list: [sufficientHerb], total: 1 },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('暂无库存预警，库存充足')).toBeInTheDocument();
    });
  });

  it('manual scan clears muted and dispatches inventory-alert-changed', { timeout: 15000 }, async () => {
    mockListInventoryDrugs.mockResolvedValue({
      data: { list: [lowStockHerb], total: 1 },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('当归')).toBeInTheDocument();
    });

    // Pre-set some muted items
    localStorage.setItem('inventory-alert-muted', JSON.stringify([99]));

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    mockListInventoryDrugs.mockResolvedValue({
      data: { list: [lowStockHerb], total: 1 },
    });

    await user.click(screen.getByText('立即扫描'));

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'inventory-alert-changed' })
      );
    });

    // Verify muted list was cleared
    expect(localStorage.getItem('inventory-alert-muted')).toBeNull();

    dispatchSpy.mockRestore();
  });

  it('clears muted list on mount', { timeout: 15000 }, async () => {
    localStorage.setItem('inventory-alert-muted', JSON.stringify([1, 2]));

    mockListInventoryDrugs.mockResolvedValue({
      data: { list: [lowStockHerb], total: 1 },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('当归')).toBeInTheDocument();
    });

    // Muted list should be cleared on mount
    expect(localStorage.getItem('inventory-alert-muted')).toBeNull();
  });

  it('renders config section with default thresholds', { timeout: 15000 }, async () => {
    mockListInventoryDrugs.mockResolvedValue({
      data: { list: [], total: 0 },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('预警配置')).toBeInTheDocument();
    });
    expect(screen.getByText('预警列表')).toBeInTheDocument();

    // Default herb threshold = 500
    const herbInput = screen.getByDisplayValue('500');
    expect(herbInput).toBeInTheDocument();
    // Default patent threshold = 10
    const patentInput = screen.getByDisplayValue('10');
    expect(patentInput).toBeInTheDocument();
  });
});
