import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import OpLogList from '../OpLogList';

const mockListOpLogs = vi.fn();

vi.mock('../../api/oplog', () => ({
  listOpLogs: (...args: unknown[]) => mockListOpLogs(...args),
  deleteOpLog: vi.fn(),
  batchDeleteOpLogs: vi.fn(),
}));

vi.mock('../../store/auth', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin', real_name: '管理员', tenant_id: 1 },
    hasPermission: () => true,
    permissions: ['oplog:read', 'role:manage'],
  }),
}));

vi.mock('../../hooks/useIsMobile', () => ({
  default: () => false,
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return { ...actual, message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } };
});

function renderOpLogList() {
  return render(
    <MemoryRouter>
      <OpLogList />
    </MemoryRouter>,
  );
}

describe('OpLogList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders oplog list with data', async () => {
    mockListOpLogs.mockResolvedValue({
      data: {
        list: [
          {
            id: 1,
            user_name: '张医生',
            action: 'create',
            resource_type: 'patient',
            resource_id: 10,
            old_data: null,
            new_data: { name: '李四' },
            created_at: '2026-03-10T10:00:00Z',
          },
          {
            id: 2,
            user_name: '王护士',
            action: 'update',
            resource_type: 'record',
            resource_id: 5,
            old_data: { diagnosis: '感冒' },
            new_data: { diagnosis: '流感' },
            created_at: '2026-03-10T11:00:00Z',
          },
        ],
        total: 2,
      },
    });

    renderOpLogList();

    await waitFor(() => {
      expect(screen.getByText('张医生')).toBeInTheDocument();
    });

    expect(screen.getByText('王护士')).toBeInTheDocument();
    expect(screen.getByText('新增')).toBeInTheDocument();
    expect(screen.getByText('修改')).toBeInTheDocument();
  });

  it('renders empty state when no data', async () => {
    mockListOpLogs.mockResolvedValue({
      data: {
        list: [],
        total: 0,
      },
    });

    renderOpLogList();

    await waitFor(() => {
      expect(screen.getByText('暂无操作日志')).toBeInTheDocument();
    });
  });

  it('renders deduct_stock action tag', async () => {
    mockListOpLogs.mockResolvedValue({
      data: {
        list: [
          {
            id: 10,
            user_name: '张医生',
            action: 'deduct_stock',
            resource_type: 'billing',
            resource_id: 3,
            old_data: null,
            new_data: {
              patient: { name: '王五' },
              formula_name: '六味地黄丸',
              total_doses: 7,
              drug_cost_total: 50.5,
              total_amount: 150.5,
              actual_paid: 150,
              stock_deducted: true,
              items: [
                { herb_name: '熟地黄', dosage: '24g', category: 'herb', sort_order: 1 },
                { herb_name: '山药', dosage: '12g', category: 'herb', sort_order: 2 },
                { herb_name: '六味地黄丸(成药)', dosage: '2盒', category: 'patent', sort_order: 3 },
              ],
            },
            created_at: '2026-03-15T10:00:00Z',
          },
        ],
        total: 1,
      },
    });

    renderOpLogList();

    await waitFor(() => {
      expect(screen.getByText('扣减库存')).toBeInTheDocument();
    });
    expect(screen.getByText('张医生')).toBeInTheDocument();
  });

  it('shows drug details when expanding deduct_stock row', async () => {
    const user = userEvent.setup();
    mockListOpLogs.mockResolvedValue({
      data: {
        list: [
          {
            id: 11,
            user_name: '李医生',
            action: 'deduct_stock',
            resource_type: 'billing',
            resource_id: 5,
            old_data: null,
            new_data: {
              patient: { name: '赵六' },
              formula_name: '桂枝汤',
              total_doses: 3,
              drug_cost_total: 30,
              total_amount: 130,
              items: [
                { herb_name: '桂枝', dosage: '9g', category: 'herb', sort_order: 1 },
                { herb_name: '白芍', dosage: '9g', category: 'herb', sort_order: 2 },
              ],
            },
            created_at: '2026-03-15T11:00:00Z',
          },
        ],
        total: 1,
      },
    });

    renderOpLogList();

    await waitFor(() => {
      expect(screen.getByText('李医生')).toBeInTheDocument();
    });

    // Click expand button in the table row
    const expandBtn = document.querySelector('.ant-table-row-expand-icon');
    expect(expandBtn).toBeTruthy();
    await user.click(expandBtn as HTMLElement);

    // Verify drug details are shown
    await waitFor(() => {
      expect(screen.getByText('桂枝')).toBeInTheDocument();
    });
    expect(screen.getByText('白芍')).toBeInTheDocument();
    // Both items have 9g dosage
    expect(screen.getAllByText('9g')).toHaveLength(2);
    // Verify summary info (patient name appears in both table row and expanded detail)
    expect(screen.getAllByText(/赵六/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/桂枝汤/)).toBeInTheDocument();
  });

  it('shows no detail for deduct_stock with empty new_data', async () => {
    mockListOpLogs.mockResolvedValue({
      data: {
        list: [
          {
            id: 12,
            user_name: '王医生',
            action: 'deduct_stock',
            resource_type: 'billing',
            resource_id: 6,
            old_data: null,
            new_data: null,
            created_at: '2026-03-15T12:00:00Z',
          },
        ],
        total: 1,
      },
    });

    renderOpLogList();

    await waitFor(() => {
      expect(screen.getByText('扣减库存')).toBeInTheDocument();
    });

    // Should not have expand icon since new_data is null
    const expandBtn = document.querySelector('.ant-table-row-expand-icon:not(.ant-table-row-expand-icon-spaced)');
    expect(expandBtn).toBeNull();
  });

  it('renders batch_stock_in action tag', async () => {
    mockListOpLogs.mockResolvedValue({
      data: {
        list: [
          {
            id: 20,
            user_name: '李药师',
            action: 'batch_stock_in',
            resource_type: 'inventory_drug',
            resource_id: 0,
            old_data: null,
            new_data: {
              items: [
                { name: '黄芪', quantity: 100, purchase_price: 15.5, selling_price: 25.0, shelf_no: 'A-01' },
                { name: '当归', quantity: 200, purchase_price: 20.0, selling_price: 35.0 },
              ],
              created: 2,
              updated: 0,
              total: 2,
              alert_threshold: 10,
            },
            created_at: '2026-03-15T14:00:00Z',
          },
        ],
        total: 1,
      },
    });

    renderOpLogList();

    await waitFor(() => {
      expect(screen.getByText('批量入库')).toBeInTheDocument();
    });
    expect(screen.getByText('李药师')).toBeInTheDocument();
  });

  it('shows batch_stock_in item details when expanding row', async () => {
    const user = userEvent.setup();
    mockListOpLogs.mockResolvedValue({
      data: {
        list: [
          {
            id: 21,
            user_name: '王药师',
            action: 'batch_stock_in',
            resource_type: 'inventory_drug',
            resource_id: 0,
            old_data: null,
            new_data: {
              items: [
                { name: '黄芪', quantity: 100, purchase_price: 15.5, selling_price: 25.0, shelf_no: 'A-01' },
                { name: '当归', quantity: 200, purchase_price: 20.0, selling_price: 35.0 },
                { name: '白术', quantity: 50, purchase_price: 12.0, selling_price: 18.0, shelf_no: 'B-02' },
              ],
              created: 2,
              updated: 1,
              total: 3,
              alert_threshold: 10,
            },
            created_at: '2026-03-15T15:00:00Z',
          },
        ],
        total: 1,
      },
    });

    renderOpLogList();

    await waitFor(() => {
      expect(screen.getByText('王药师')).toBeInTheDocument();
    });

    // Click expand button
    const expandBtn = document.querySelector('.ant-table-row-expand-icon');
    expect(expandBtn).toBeTruthy();
    await user.click(expandBtn as HTMLElement);

    // Verify summary info is rendered
    await waitFor(() => {
      expect(screen.getByText((_, el) => el?.textContent === '总计：3 项')).toBeInTheDocument();
    });
    expect(screen.getByText((_, el) => el?.textContent === '新增：2')).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.textContent === '追加：1')).toBeInTheDocument();

    // Verify drug item details
    expect(screen.getByText('黄芪')).toBeInTheDocument();
    expect(screen.getByText('当归')).toBeInTheDocument();
    expect(screen.getByText('白术')).toBeInTheDocument();

    // Verify prices displayed
    expect(screen.getByText('¥15.50')).toBeInTheDocument();
    expect(screen.getByText('¥25.00')).toBeInTheDocument();

    // Verify shelf_no displayed
    expect(screen.getByText('A-01')).toBeInTheDocument();
    expect(screen.getByText('B-02')).toBeInTheDocument();
  });

  it('shows tenant column for super admin', async () => {
    mockListOpLogs.mockResolvedValue({
      data: {
        list: [
          {
            id: 30,
            user_name: '张医生',
            action: 'create',
            resource_type: 'patient',
            resource_id: 1,
            old_data: null,
            new_data: null,
            created_at: '2026-03-20T10:00:00Z',
            tenant: { id: 1, name: '诊所A', code: 'clinic-a' },
          },
          {
            id: 31,
            user_name: '李医生',
            action: 'update',
            resource_type: 'patient',
            resource_id: 2,
            old_data: null,
            new_data: null,
            created_at: '2026-03-20T11:00:00Z',
            tenant: { id: 2, name: '诊所B', code: 'clinic-b' },
          },
        ],
        total: 2,
        is_super_admin: true,
      },
    });

    renderOpLogList();

    await waitFor(() => {
      expect(screen.getByText('张医生')).toBeInTheDocument();
    });

    // Super admin column header should be visible
    expect(screen.getByText('所属租户')).toBeInTheDocument();
    // Tenant names should appear in the table
    expect(screen.getByText('诊所A')).toBeInTheDocument();
    expect(screen.getByText('诊所B')).toBeInTheDocument();
  });

  it('hides tenant column for normal user', async () => {
    mockListOpLogs.mockResolvedValue({
      data: {
        list: [
          {
            id: 40,
            user_name: '王护士',
            action: 'create',
            resource_type: 'patient',
            resource_id: 1,
            old_data: null,
            new_data: null,
            created_at: '2026-03-20T10:00:00Z',
          },
        ],
        total: 1,
        is_super_admin: false,
      },
    });

    renderOpLogList();

    await waitFor(() => {
      expect(screen.getByText('王护士')).toBeInTheDocument();
    });

    // No tenant column for normal user
    expect(screen.queryByText('所属租户')).not.toBeInTheDocument();
  });
});
