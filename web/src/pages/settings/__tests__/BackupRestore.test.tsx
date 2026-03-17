import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import BackupRestore from '../BackupRestore';

vi.mock('../../../api/backup', () => ({
  triggerBackup: vi.fn().mockResolvedValue({ code: 0, data: { task_id: 'test-123' } }),
  getBackupStatus: vi
    .fn()
    .mockResolvedValue({ code: 0, data: { status: 'success', output: 'ok' } }),
  listLocalFiles: vi.fn().mockResolvedValue({ code: 0, data: { mysql: [], minio: [] } }),
  listCloudFiles: vi.fn().mockResolvedValue({
    code: 0,
    data: {
      mysql: [{ filename: 'test_20260316.sql', size: 2300000, modified: 1773897000 }],
      minio: [{ filename: 'test_minio_20260316.tar.gz', size: 156000000, modified: 1773897000 }],
    },
  }),
  triggerRestore: vi.fn().mockResolvedValue({ code: 0, data: { task_id: 'restore-123' } }),
  getRestoreStatus: vi
    .fn()
    .mockResolvedValue({ code: 0, data: { status: 'success', output: 'ok' } }),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

describe('BackupRestore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders backup and restore sections', () => {
    render(<BackupRestore />);
    expect(screen.getByText('备份与恢复')).toBeInTheDocument();
    expect(screen.getByText('数据备份')).toBeInTheDocument();
    expect(screen.getByText('数据恢复')).toBeInTheDocument();
  });

  it('renders three backup buttons', () => {
    render(<BackupRestore />);
    expect(screen.getByText('备份 MySQL')).toBeInTheDocument();
    expect(screen.getByText('备份 MinIO')).toBeInTheDocument();
    expect(screen.getByText('全量备份')).toBeInTheDocument();
  });

  it('renders restore options', () => {
    render(<BackupRestore />);
    expect(screen.getByText('从本地恢复')).toBeInTheDocument();
    expect(screen.getByText('从云端恢复')).toBeInTheDocument();
  });

  it('opens cloud restore modal on click', async () => {
    const user = userEvent.setup();
    render(<BackupRestore />);
    await user.click(screen.getByText('从云端恢复'));
    expect(await screen.findByText('☁️ 从云端恢复')).toBeInTheDocument();
  });

  it('shows confirm modal when clicking backup button', async () => {
    const user = userEvent.setup();
    render(<BackupRestore />);
    await user.click(screen.getByText('备份 MySQL'));
    // Modal.confirm 弹出，内容包含备份类型描述
    expect(await screen.findByText(/MySQL 数据库.*备份/)).toBeInTheDocument();
  });

  it('opens local restore modal on click', async () => {
    const user = userEvent.setup();
    render(<BackupRestore />);
    await user.click(screen.getByText('从本地恢复'));
    expect(await screen.findByText('💻 从本地恢复')).toBeInTheDocument();
  });
});
