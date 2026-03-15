import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UserList from '../UserList';

const mockListUsers = vi.fn();

vi.mock('../../../api/user', () => ({
  listUsers: (...args: unknown[]) => mockListUsers(...args),
  updateUser: vi.fn(),
  assignRoles: vi.fn(),
}));

vi.mock('../../../api/role', () => ({
  listRoles: vi.fn().mockResolvedValue({ data: [] }),
}));

vi.mock('../../../api/tenant', () => ({
  listTenants: vi.fn().mockResolvedValue({ data: { list: [] } }),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

vi.mock('../../../store/auth', () => ({
  useAuth: () => ({
    hasPermission: (code: string) => code === 'user:manage',
  }),
}));

vi.mock('../../../api/tenant-admin', () => ({
  listTenantUsers: vi.fn(),
  updateTenantUser: vi.fn(),
  assignTenantUserRoles: vi.fn(),
  listTenantRoles: vi.fn(),
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return { ...actual, message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } };
});

function renderUserList() {
  return render(
    <MemoryRouter>
      <UserList />
    </MemoryRouter>,
  );
}

describe('UserList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders user list with data', async () => {
    mockListUsers.mockResolvedValue({
      data: {
        list: [
          {
            id: 1,
            username: 'admin',
            real_name: '管理员',
            phone: '13800138000',
            notes: '',
            status: 1,
            tenant_id: 1,
            tenant: { id: 1, name: '默认诊所' },
            roles: [{ id: 1, name: '超级管理员' }],
            created_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 2,
            username: 'doctor1',
            real_name: '张医生',
            phone: '13900139000',
            notes: '内科',
            status: 1,
            tenant_id: 1,
            tenant: { id: 1, name: '默认诊所' },
            roles: [{ id: 2, name: '医生' }],
            created_at: '2026-01-02T00:00:00Z',
          },
        ],
        total: 2,
      },
    });

    renderUserList();

    await waitFor(() => {
      expect(screen.getByText('admin')).toBeInTheDocument();
    });

    expect(screen.getByText('doctor1')).toBeInTheDocument();
    expect(screen.getByText('管理员')).toBeInTheDocument();
    expect(screen.getByText('张医生')).toBeInTheDocument();
    expect(screen.getByText('超级管理员')).toBeInTheDocument();
    expect(screen.getByText('医生')).toBeInTheDocument();
  });

  it('renders empty state when no data', async () => {
    mockListUsers.mockResolvedValue({
      data: {
        list: [],
        total: 0,
      },
    });

    renderUserList();

    await waitFor(() => {
      expect(screen.getByText('暂无用户记录')).toBeInTheDocument();
    });
  });
});
