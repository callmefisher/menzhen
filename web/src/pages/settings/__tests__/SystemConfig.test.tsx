import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SystemConfig from '../SystemConfig';

vi.mock('../../../api/config', () => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return { ...actual, message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } };
});

import { getConfig, updateConfig } from '../../../api/config';

const mockConfig = {
  data: {
    config: {
      SERVER_PORT: '8080',
      DB_HOST: 'localhost',
      DB_PORT: '3306',
      DB_USER: 'menzhen',
      DB_PASSWORD: '****n123',
      DB_NAME: 'menzhen',
      JWT_SECRET: '****tion',
      MINIO_ENDPOINT: 'localhost:9000',
      MINIO_ACCESS_KEY: '****dmin',
      MINIO_SECRET_KEY: '****dmin',
      MINIO_BUCKET: 'menzhen',
      DEEPSEEK_API_KEY: '',
      DEEPSEEK_BASE_URL: '',
      DEEPSEEK_MODEL: '',
      QINIU_ACCESS_KEY: '',
      QINIU_SECRET_KEY: '',
      QINIU_BUCKET: '',
      QINIU_KEY_PREFIX: 'menzhen-backup/',
      QINIU_DOMAIN: 'public.qnlinking.com',
      QINIU_RETAIN_MYSQL: '5',
      QINIU_RETAIN_MINIO: '5',
      BACKUP_INTERVAL_MYSQL: '7200',
      BACKUP_INTERVAL_MINIO: '43200',
    },
    sensitive_set: ['DB_PASSWORD', 'JWT_SECRET', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY'],
  },
};

describe('SystemConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getConfig as ReturnType<typeof vi.fn>).mockResolvedValue(mockConfig);
    (updateConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
  });

  it('renders all config groups', async () => {
    render(<SystemConfig />);
    await waitFor(() => {
      expect(screen.getByText('服务器配置')).toBeInTheDocument();
      expect(screen.getByText('数据库配置')).toBeInTheDocument();
      expect(screen.getByText('JWT 配置')).toBeInTheDocument();
      expect(screen.getByText('MinIO 文件存储')).toBeInTheDocument();
      expect(screen.getByText('DeepSeek AI')).toBeInTheDocument();
      expect(screen.getByText('七牛云备份')).toBeInTheDocument();
      expect(screen.getByText('备份间隔')).toBeInTheDocument();
    });
  });

  it('loads and displays config values', async () => {
    render(<SystemConfig />);
    await waitFor(() => {
      expect(getConfig).toHaveBeenCalledTimes(1);
    });
    // Wait for form to be populated after load
    await waitFor(() => {
      const dbHostInput = screen.getByLabelText('数据库地址') as HTMLInputElement;
      expect(dbHostInput.value).toBe('localhost');
    });
  });

  it('saves config on button click', async () => {
    const user = userEvent.setup();
    render(<SystemConfig />);
    await waitFor(() => {
      expect(screen.getByText('保存配置')).toBeInTheDocument();
    });
    await user.click(screen.getByText('保存配置'));
    await waitFor(() => {
      expect(updateConfig).toHaveBeenCalledTimes(1);
    });
  });

  it('handles load failure gracefully', async () => {
    (getConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
    render(<SystemConfig />);
    await waitFor(() => {
      expect(getConfig).toHaveBeenCalledTimes(1);
    });
    // Component should not crash - loading spinner should be gone
    await waitFor(() => {
      expect(document.querySelector('.ant-spin')).not.toBeInTheDocument();
    });
  });

  it('shows loading spinner initially', () => {
    render(<SystemConfig />);
    expect(document.querySelector('.ant-spin')).toBeInTheDocument();
  });
});
