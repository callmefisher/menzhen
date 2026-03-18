import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DrugList from '../DrugList';

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
  createInventoryDrug: vi.fn(),
  updateInventoryDrug: vi.fn(),
  deleteInventoryDrug: vi.fn(),
  stockInDrug: vi.fn(),
  batchStockIn: vi.fn(),
  findDrugPage: vi.fn().mockResolvedValue(1),
}));

describe('DrugList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = () =>
    render(
      <MemoryRouter>
        <DrugList />
      </MemoryRouter>
    );

  it('renders drug list with data', { timeout: 15000 }, async () => {
    mockListInventoryDrugs.mockResolvedValue({
      data: {
        list: [
          { id: 1, tenant_id: 1, name: '当归', category: 'herb', stock: 1000, purchase_price: 60, selling_price: 80, alert_threshold: null, remark: '', created_at: '2025-01-01', updated_at: '2025-01-01' },
          { id: 2, tenant_id: 1, name: '黄芪', category: 'herb', stock: 500, purchase_price: 40, selling_price: 60, alert_threshold: null, remark: '', created_at: '2025-01-02', updated_at: '2025-01-02' },
        ],
        total: 2,
      },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('当归')).toBeInTheDocument();
    });
    expect(screen.getByText('黄芪')).toBeInTheDocument();
  });

  it('renders empty state', { timeout: 15000 }, async () => {
    mockListInventoryDrugs.mockResolvedValue({
      data: {
        list: [],
        total: 0,
      },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('暂无药物记录')).toBeInTheDocument();
    });
  });
});
