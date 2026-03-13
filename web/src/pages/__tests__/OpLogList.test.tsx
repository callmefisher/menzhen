import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
});
