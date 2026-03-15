import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import SystemConfig from '../SystemConfig';

vi.mock('../../../api/config', () => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  restartService: vi.fn(),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return { ...actual, message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } };
});

import { getConfig, updateConfig, restartService } from '../../../api/config';

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

// Expected section → keys mapping (must match CONFIG_SECTIONS in component)
const WARNING_SECTION_KEYS = [
  'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
  'MINIO_ENDPOINT', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'MINIO_BUCKET',
];
const INFO_SECTION_KEYS = [
  'SERVER_PORT', 'JWT_SECRET',
  'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL',
];
const SUCCESS_SECTION_KEYS = [
  'QINIU_ACCESS_KEY', 'QINIU_SECRET_KEY', 'QINIU_BUCKET',
  'QINIU_KEY_PREFIX', 'QINIU_DOMAIN', 'QINIU_RETAIN_MYSQL', 'QINIU_RETAIN_MINIO',
  'BACKUP_INTERVAL_MYSQL', 'BACKUP_INTERVAL_MINIO',
];

describe('SystemConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getConfig as ReturnType<typeof vi.fn>).mockResolvedValue(mockConfig);
    (updateConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    (restartService as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    document.querySelectorAll('.ant-modal-root').forEach(el => el.remove());
    document.querySelectorAll('.ant-drawer-root').forEach(el => el.remove());
  });

  // ==================== 数据一致性 ====================

  it('section keys cover all 22 mockConfig keys without gaps or duplicates', () => {
    const allSectionKeys = [...WARNING_SECTION_KEYS, ...INFO_SECTION_KEYS, ...SUCCESS_SECTION_KEYS].sort();
    const mockKeys = Object.keys(mockConfig.data.config).sort();
    expect(allSectionKeys).toEqual(mockKeys);
    expect(new Set(allSectionKeys).size).toBe(allSectionKeys.length);
  });

  it('round-trip: save preserves all 22 config keys and values', async () => {
    const user = userEvent.setup();
    render(<SystemConfig />);
    await waitFor(() => {
      expect((screen.getByLabelText('数据库地址') as HTMLInputElement).value).toBe('localhost');
    });
    await user.click(screen.getByText('保存配置'));
    await waitFor(() => {
      expect(updateConfig).toHaveBeenCalledTimes(1);
    });
    const savedData = (updateConfig as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, string>;
    const expectedKeys = Object.keys(mockConfig.data.config).sort();
    expect(Object.keys(savedData).sort()).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      expect(savedData[key]).toBe(mockConfig.data.config[key as keyof typeof mockConfig.data.config]);
    }
  });

  // ==================== 渲染完整性 ====================

  it('shows loading spinner initially', () => {
    render(<SystemConfig />);
    expect(document.querySelector('.ant-spin')).toBeInTheDocument();
  });

  it('renders 3 section alerts and 7 group titles', async () => {
    render(<SystemConfig />);
    await waitFor(() => {
      // 3 section alerts
      expect(screen.getByText('需先确认外部服务配置')).toBeInTheDocument();
      expect(screen.getByText('仅需重启 API 服务')).toBeInTheDocument();
      expect(screen.getByText('自动生效（无需重启）')).toBeInTheDocument();
      // 7 group titles
      expect(screen.getByText('数据库配置')).toBeInTheDocument();
      expect(screen.getByText('MinIO 文件存储')).toBeInTheDocument();
      expect(screen.getByText('服务器配置')).toBeInTheDocument();
      expect(screen.getByText('JWT 配置')).toBeInTheDocument();
      expect(screen.getByText('DeepSeek AI')).toBeInTheDocument();
      expect(screen.getByText('七牛云备份')).toBeInTheDocument();
      expect(screen.getByText('备份间隔')).toBeInTheDocument();
    });
  });

  it('renders all 22 form field labels (19 unique + 2 shared×2)', async () => {
    render(<SystemConfig />);
    await waitFor(() => {
      expect(screen.getByLabelText('数据库地址')).toBeInTheDocument();
    });
    // 19 unique labels
    const uniqueLabels = [
      '服务端口', '数据库地址', '数据库端口', '数据库用户名', '数据库密码', '数据库名',
      'JWT 密钥', 'MinIO 地址', '存储桶名',
      'API 密钥', 'API 地址', '模型名称',
      '存储空间名', '上传路径前缀', '下载域名',
      'MySQL 备份保留数', 'MinIO 备份保留数',
      'MySQL 备份间隔(秒)', 'MinIO 备份间隔(秒)',
    ];
    for (const label of uniqueLabels) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    // 2 shared labels each appear twice (MinIO + 七牛)
    expect(screen.getAllByLabelText('Access Key')).toHaveLength(2);
    expect(screen.getAllByLabelText('Secret Key')).toHaveLength(2);
  });

  it('loads and displays config values correctly', async () => {
    render(<SystemConfig />);
    await waitFor(() => {
      expect(getConfig).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      // Text inputs
      expect((screen.getByLabelText('数据库地址') as HTMLInputElement).value).toBe('localhost');
      expect((screen.getByLabelText('数据库用户名') as HTMLInputElement).value).toBe('menzhen');
      expect((screen.getByLabelText('数据库名') as HTMLInputElement).value).toBe('menzhen');
      expect((screen.getByLabelText('MinIO 地址') as HTMLInputElement).value).toBe('localhost:9000');
      expect((screen.getByLabelText('存储桶名') as HTMLInputElement).value).toBe('menzhen');
      expect((screen.getByLabelText('上传路径前缀') as HTMLInputElement).value).toBe('menzhen-backup/');
      expect((screen.getByLabelText('下载域名') as HTMLInputElement).value).toBe('public.qnlinking.com');
      // Password inputs (masked values from API)
      expect((screen.getByLabelText('数据库密码') as HTMLInputElement).value).toBe('****n123');
      expect((screen.getByLabelText('JWT 密钥') as HTMLInputElement).value).toBe('****tion');
      // Shared labels: Access Key [0]=MinIO, [1]=七牛
      const accessKeys = screen.getAllByLabelText('Access Key') as HTMLInputElement[];
      expect(accessKeys[0].value).toBe('****dmin');
      expect(accessKeys[1].value).toBe('');
    });
  });

  it('handles load failure gracefully', async () => {
    (getConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
    render(<SystemConfig />);
    await waitFor(() => {
      expect(getConfig).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(document.querySelector('.ant-spin')).not.toBeInTheDocument();
    });
  });

  // ==================== 保存 ====================

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

  // ==================== 风险提示：外部服务字段（warning 区） ====================

  it('shows risk warning when changing DB_PASSWORD', async () => {
    const user = userEvent.setup();
    render(<SystemConfig />);
    await waitFor(() => {
      expect(screen.getByLabelText('数据库密码')).toBeInTheDocument();
    });
    await user.clear(screen.getByLabelText('数据库密码'));
    await user.type(screen.getByLabelText('数据库密码'), 'new-password');
    await user.click(screen.getByText('保存配置'));
    await waitFor(() => {
      expect(screen.getAllByText('风险提示').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/修改数据库密码前/)).toBeInTheDocument();
    });
  });

  it('shows risk warning when changing DB_HOST', async () => {
    const user = userEvent.setup();
    render(<SystemConfig />);
    await waitFor(() => {
      expect(screen.getByLabelText('数据库地址')).toBeInTheDocument();
    });
    await user.clear(screen.getByLabelText('数据库地址'));
    await user.type(screen.getByLabelText('数据库地址'), '10.0.0.1');
    await user.click(screen.getByText('保存配置'));
    await waitFor(() => {
      expect(screen.getAllByText('风险提示').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/修改数据库地址前/)).toBeInTheDocument();
    });
  });

  it('shows risk warning when changing DB_USER', async () => {
    const user = userEvent.setup();
    render(<SystemConfig />);
    await waitFor(() => {
      expect(screen.getByLabelText('数据库用户名')).toBeInTheDocument();
    });
    await user.clear(screen.getByLabelText('数据库用户名'));
    await user.type(screen.getByLabelText('数据库用户名'), 'admin');
    await user.click(screen.getByText('保存配置'));
    await waitFor(() => {
      expect(screen.getAllByText('风险提示').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/修改数据库用户名前/)).toBeInTheDocument();
    });
  });

  it('shows risk warning when changing DB_NAME', async () => {
    const user = userEvent.setup();
    render(<SystemConfig />);
    await waitFor(() => {
      expect(screen.getByLabelText('数据库名')).toBeInTheDocument();
    });
    await user.clear(screen.getByLabelText('数据库名'));
    await user.type(screen.getByLabelText('数据库名'), 'new_db');
    await user.click(screen.getByText('保存配置'));
    await waitFor(() => {
      expect(screen.getAllByText('风险提示').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/修改数据库名前/)).toBeInTheDocument();
    });
  });

  it('shows risk warning when changing MINIO_ENDPOINT', async () => {
    const user = userEvent.setup();
    render(<SystemConfig />);
    await waitFor(() => {
      expect(screen.getByLabelText('MinIO 地址')).toBeInTheDocument();
    });
    await user.clear(screen.getByLabelText('MinIO 地址'));
    await user.type(screen.getByLabelText('MinIO 地址'), '10.0.0.2:9000');
    await user.click(screen.getByText('保存配置'));
    await waitFor(() => {
      expect(screen.getAllByText('风险提示').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/修改 MinIO 地址前/)).toBeInTheDocument();
    });
  });

  it('shows risk warning when changing MINIO keys', async () => {
    const user = userEvent.setup();
    render(<SystemConfig />);
    await waitFor(() => {
      expect(screen.getAllByLabelText('Access Key').length).toBeGreaterThanOrEqual(1);
    });
    const accessKeyInputs = screen.getAllByLabelText('Access Key');
    await user.clear(accessKeyInputs[0]);
    await user.type(accessKeyInputs[0], 'new-key');
    await user.click(screen.getByText('保存配置'));
    await waitFor(() => {
      expect(screen.getAllByText('风险提示').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/修改 MinIO 密钥前/)).toBeInTheDocument();
    });
  });

  it('shows risk warning when changing MINIO_BUCKET', async () => {
    const user = userEvent.setup();
    render(<SystemConfig />);
    await waitFor(() => {
      expect(screen.getByLabelText('存储桶名')).toBeInTheDocument();
    });
    await user.clear(screen.getByLabelText('存储桶名'));
    await user.type(screen.getByLabelText('存储桶名'), 'new-bucket');
    await user.click(screen.getByText('保存配置'));
    await waitFor(() => {
      expect(screen.getAllByText('风险提示').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/修改存储桶名前/)).toBeInTheDocument();
    });
  });

  // ==================== 无风险提示：非外部服务字段 ====================

  it('saves directly without risk warning when changing info-section field', async () => {
    const user = userEvent.setup();
    render(<SystemConfig />);
    await waitFor(() => {
      expect(screen.getByLabelText('模型名称')).toBeInTheDocument();
    });
    await user.clear(screen.getByLabelText('模型名称'));
    await user.type(screen.getByLabelText('模型名称'), 'deepseek-v3');
    await user.click(screen.getByText('保存配置'));
    await waitFor(() => {
      expect(updateConfig).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('风险提示')).not.toBeInTheDocument();
  });

  it('saves directly without risk warning when changing success-section field', async () => {
    const user = userEvent.setup();
    render(<SystemConfig />);
    await waitFor(() => {
      expect(screen.getByLabelText('上传路径前缀')).toBeInTheDocument();
    });
    await user.clear(screen.getByLabelText('上传路径前缀'));
    await user.type(screen.getByLabelText('上传路径前缀'), 'new-prefix/');
    await user.click(screen.getByText('保存配置'));
    await waitFor(() => {
      expect(updateConfig).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('风险提示')).not.toBeInTheDocument();
  });

  // ==================== 重启服务 ====================

  it('renders restart service section', async () => {
    render(<SystemConfig />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /重启服务/ })).toBeInTheDocument();
      expect(screen.getByText(/修改配置后需重启服务才能生效/)).toBeInTheDocument();
    });
  });

  it('shows confirm modal on restart click', async () => {
    const user = userEvent.setup();
    render(<SystemConfig />);
    const restartBtn = await screen.findByRole('button', { name: /重启服务/ });
    await user.click(restartBtn);
    await waitFor(() => {
      expect(screen.getAllByText('确认重启服务').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/重启期间服务将短暂不可用/)).toBeInTheDocument();
    });
  });

  it('calls restartService API after confirming', async () => {
    const user = userEvent.setup();
    render(<SystemConfig />);
    const restartBtn = await screen.findByRole('button', { name: /重启服务/ });
    await user.click(restartBtn);
    await waitFor(() => {
      expect(screen.getAllByText('确认重启').length).toBeGreaterThanOrEqual(1);
    });
    const confirmBtns = screen.getAllByText('确认重启');
    await user.click(confirmBtns[0]);
    await waitFor(() => {
      expect(restartService).toHaveBeenCalledTimes(1);
    });
  });

  it('handles restart failure gracefully', async () => {
    (restartService as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
    const user = userEvent.setup();
    render(<SystemConfig />);
    const restartBtn = await screen.findByRole('button', { name: /重启服务/ });
    await user.click(restartBtn);
    await waitFor(() => {
      expect(screen.getAllByText('确认重启').length).toBeGreaterThanOrEqual(1);
    });
    const confirmBtns = screen.getAllByText('确认重启');
    await user.click(confirmBtns[confirmBtns.length - 1]);
    await waitFor(() => {
      expect(restartService).toHaveBeenCalledTimes(1);
    }, { timeout: 10000 });
  }, 15000);

  // ==================== 配置影响说明 Drawer ====================

  it('renders config impact link', async () => {
    render(<SystemConfig />);
    await waitFor(() => {
      expect(screen.getByText(/查看配置影响说明/)).toBeInTheDocument();
    });
  });

  it('opens config impact drawer with matching section titles', async () => {
    const user = userEvent.setup();
    render(<SystemConfig />);
    const link = await screen.findByText(/查看配置影响说明/);
    await user.click(link);
    await waitFor(() => {
      expect(screen.getByText('配置影响说明')).toBeInTheDocument();
      // Section titles appear in both form and drawer (×2)
      expect(screen.getAllByText('需先确认外部服务配置').length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText('仅需重启 API 服务').length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText('自动生效（无需重启）').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('drawer lists all 22 config keys matching form fields', async () => {
    const user = userEvent.setup();
    render(<SystemConfig />);
    const link = await screen.findByText(/查看配置影响说明/);
    await user.click(link);
    const allKeys = Object.keys(mockConfig.data.config);
    await waitFor(() => {
      for (const key of allKeys) {
        // Each key appears as <code> text in the drawer
        expect(screen.getAllByText(key).length).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
