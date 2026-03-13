import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TenantList from '../TenantList';

const mockListTenants = vi.fn();

vi.mock('../../../api/tenant', () => ({
  listTenants: (...args: unknown[]) => mockListTenants(...args),
  createTenant: vi.fn(),
  updateTenant: vi.fn(),
  deleteTenant: vi.fn(),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return { ...actual, message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } };
});

function renderTenantList() {
  return render(
    <MemoryRouter>
      <TenantList />
    </MemoryRouter>,
  );
}

describe('TenantList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders tenant list with data', async () => {
    mockListTenants.mockResolvedValue({
      data: {
        list: [
          {
            id: 1,
            name: '默认诊所',
            code: 'default',
            status: 1,
            created_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 2,
            name: '仁心堂',
            code: 'renxintang',
            status: 0,
            created_at: '2026-02-01T00:00:00Z',
          },
        ],
        total: 2,
      },
    });

    renderTenantList();

    await waitFor(() => {
      expect(screen.getByText('默认诊所')).toBeInTheDocument();
    });

    expect(screen.getByText('仁心堂')).toBeInTheDocument();
    expect(screen.getByText('default')).toBeInTheDocument();
    expect(screen.getByText('renxintang')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新增诊所/ })).toBeInTheDocument();
  });

  it('renders empty state when no tenants', async () => {
    mockListTenants.mockResolvedValue({
      data: {
        list: [],
        total: 0,
      },
    });

    renderTenantList();

    await waitFor(() => {
      expect(screen.getByText('暂无诊所记录')).toBeInTheDocument();
    });
  });
});
