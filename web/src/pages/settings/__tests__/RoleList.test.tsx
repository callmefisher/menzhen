import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RoleList from '../RoleList';

const mockListRoles = vi.fn();
const mockListPermissions = vi.fn();

vi.mock('../../../api/role', () => ({
  listRoles: (...args: unknown[]) => mockListRoles(...args),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  listPermissions: (...args: unknown[]) => mockListPermissions(...args),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

vi.mock('../../../store/auth', () => ({
  useAuth: () => ({
    hasPermission: (code: string) => code === 'role:manage',
  }),
}));

vi.mock('../../../api/tenant-admin', () => ({
  listTenantRoles: vi.fn(),
  createTenantRole: vi.fn(),
  updateTenantRole: vi.fn(),
  listTenantPermissions: vi.fn(),
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return { ...actual, message: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } };
});

function renderRoleList() {
  return render(
    <MemoryRouter>
      <RoleList />
    </MemoryRouter>,
  );
}

describe('RoleList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPermissions.mockResolvedValue({ data: [] });
  });

  it('renders role list with data', async () => {
    mockListRoles.mockResolvedValue({
      data: [
        {
          id: 1,
          name: '超级管理员',
          description: '拥有所有权限',
          permissions: [
            { id: 1, code: 'patient:read', name: '查看患者' },
            { id: 2, code: 'record:read', name: '查看记录' },
          ],
        },
        {
          id: 2,
          name: '医生',
          description: '基本诊疗权限',
          permissions: [
            { id: 1, code: 'patient:read', name: '查看患者' },
          ],
        },
      ],
    });

    renderRoleList();

    await waitFor(() => {
      expect(screen.getByText('超级管理员')).toBeInTheDocument();
    });

    expect(screen.getByText('医生')).toBeInTheDocument();
    expect(screen.getByText('拥有所有权限')).toBeInTheDocument();
    expect(screen.getByText('基本诊疗权限')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新增角色/ })).toBeInTheDocument();
  });

  it('renders empty state when no roles', async () => {
    mockListRoles.mockResolvedValue({ data: [] });

    renderRoleList();

    await waitFor(() => {
      expect(screen.getByText('暂无角色记录')).toBeInTheDocument();
    });
  });
});
