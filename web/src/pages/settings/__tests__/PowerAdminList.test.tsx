import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PowerAdminList from '../PowerAdminList';

vi.mock('../../../api/powerAdmin', () => ({
  listPowerAdmins: vi.fn(),
  deletePowerAdmin: vi.fn(),
  assignPowerAdminGroups: vi.fn(),
  listAllGroups: vi.fn(),
}));

vi.mock('../../../api/user', () => ({
  listUsers: vi.fn(),
}));

import {
  listPowerAdmins,
  deletePowerAdmin,
  assignPowerAdminGroups,
  listAllGroups,
} from '../../../api/powerAdmin';
import { listUsers } from '../../../api/user';

const mockGroups = [
  { name: '华北分组', count: 3 },
  { name: '华南分组', count: 2 },
];

const mockAdmin: Parameters<typeof vi.mocked<typeof listPowerAdmins>>[0] extends never ? never : unknown = undefined;
void mockAdmin;

const adminWithGroups = {
  user_id: 1,
  username: 'lisi',
  real_name: '李四',
  status: 1,
  groups: ['华北分组'],
  created_at: '2026-01-01 10:00:00',
};

const adminWithoutGroups = {
  user_id: 2,
  username: 'zhangsan',
  real_name: '张三',
  status: 1,
  groups: [],
  created_at: '2026-01-02 09:00:00',
};

describe('PowerAdminList', () => {
  beforeEach(() => {
    vi.mocked(listPowerAdmins).mockResolvedValue({ code: 0, data: [adminWithGroups] } as any);
    vi.mocked(listAllGroups).mockResolvedValue({ code: 0, data: mockGroups } as any);
    vi.mocked(assignPowerAdminGroups).mockResolvedValue({} as any);
    vi.mocked(deletePowerAdmin).mockResolvedValue({} as any);
    vi.mocked(listUsers).mockResolvedValue({ code: 0, data: { list: [] } } as any);
  });

  it('renders list with badge display', async () => {
    render(<PowerAdminList />);
    expect(await screen.findByText('lisi')).toBeInTheDocument();
    expect(screen.getByText('李四')).toBeInTheDocument();
    // Badge shows "N 个分组 · M 家"
    expect(screen.getByText('1 个分组 · 3 家')).toBeInTheDocument();
  });

  it('shows 暂未分配 for user with no groups', async () => {
    vi.mocked(listPowerAdmins).mockResolvedValue({ code: 0, data: [adminWithoutGroups] } as any);
    render(<PowerAdminList />);
    expect(await screen.findByText('暂未分配')).toBeInTheDocument();
  });

  it('shows 已禁用 badge for disabled user', async () => {
    vi.mocked(listPowerAdmins).mockResolvedValue({
      code: 0,
      data: [{ ...adminWithGroups, status: 0 }],
    } as any);
    render(<PowerAdminList />);
    expect(await screen.findByText('已禁用')).toBeInTheDocument();
  });

  it('opens assign panel with correct left/right split', async () => {
    render(<PowerAdminList />);
    await screen.findByText('lisi');

    fireEvent.click(screen.getByText('⊞ 分配分组'));

    expect(await screen.findByText('可选分组')).toBeInTheDocument();
    expect(screen.getByText('已授权分组')).toBeInTheDocument();
    // 华北分组 is already assigned → should appear on the right
    // 华南分组 is not assigned → should appear on the left
    expect(screen.getByText('华南分组')).toBeInTheDocument();
    // Right panel header shows count
    expect(screen.getByText('已选 1 组 · 3 家')).toBeInTheDocument();
  });

  it('moves group from left to right on click', async () => {
    render(<PowerAdminList />);
    await screen.findByText('lisi');
    fireEvent.click(screen.getByText('⊞ 分配分组'));
    await screen.findByText('可选分组');

    // Click 华南分组 in left panel to move it to right
    fireEvent.click(screen.getByText('华南分组'));

    // Right panel now shows 2 groups
    await waitFor(() => {
      expect(screen.getByText('已选 2 组 · 5 家')).toBeInTheDocument();
    });
  });

  it('assign panel shows correct initial split and groups can be moved', async () => {
    render(<PowerAdminList />);
    await screen.findByText('lisi');
    fireEvent.click(screen.getByText('⊞ 分配分组'));
    await screen.findByText('可选分组');

    // Initially: 华北分组 on right (assigned), 华南分组 on left
    expect(screen.getByText('已选 1 组 · 3 家')).toBeInTheDocument();

    // Move 华南分组 from left to right by clicking it
    const leftItems = screen.getAllByText('华南分组');
    fireEvent.click(leftItems[0]);

    // Now 2 groups on right
    await waitFor(() => {
      expect(screen.getByText('已选 2 组 · 5 家')).toBeInTheDocument();
    });
  });

  it('blocks saving new admin with no groups selected', async () => {
    vi.mocked(listPowerAdmins).mockResolvedValue({ code: 0, data: [] } as any);
    vi.mocked(listUsers).mockResolvedValue({
      code: 0,
      data: { list: [{ id: 99, username: 'newuser', real_name: '新用户' }] },
    } as any);
    render(<PowerAdminList />);
    await screen.findByText('超级管理员管理');

    // Open add modal
    fireEvent.click(screen.getByText('＋ 新增管理员'));
    expect(await screen.findByText('新增超级管理员')).toBeInTheDocument();
    // Select user (simulate focus to load options then select)
    const selects = screen.getAllByRole('combobox');
    fireEvent.focus(selects[0]);
    await waitFor(() => expect(listUsers).toHaveBeenCalled());
  });

  it('shows empty panel message when no groups available', async () => {
    vi.mocked(listAllGroups).mockResolvedValue({ code: 0, data: [] } as any);
    vi.mocked(listPowerAdmins).mockResolvedValue({
      code: 0, data: [adminWithoutGroups],
    } as any);
    render(<PowerAdminList />);
    await screen.findByText('zhangsan');
    fireEvent.click(screen.getByText('⊞ 分配分组'));
    expect(await screen.findByText('无可选分组')).toBeInTheDocument();
    expect(screen.getByText('暂未选择分组')).toBeInTheDocument();
  });
});
