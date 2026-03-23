import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HerbSearch from '../HerbSearch';

// Mock the API module
vi.mock('../../../api/herb', () => ({
  listHerbs: vi.fn(),
  listHerbCategories: vi.fn().mockResolvedValue({ data: [] }),
  deleteHerb: vi.fn(),
  createHerb: vi.fn(),
  findHerbPage: vi.fn().mockResolvedValue(1),
}));

// Track hasPermission mock so tests can override it
let mockHasPermission = vi.fn(() => false);
vi.mock('../../../store/auth', () => ({
  useAuth: () => ({
    hasPermission: (...args: unknown[]) => mockHasPermission(...args),
  }),
}));

// Mock antd message
vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return {
    ...actual,
    message: {
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    },
  };
});

import { listHerbs, createHerb } from '../../../api/herb';

describe('HerbSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission = vi.fn(() => false);
  });

  it('renders search input', () => {
    render(<HerbSearch />);
    const input = screen.getByPlaceholderText('输入中药名称搜索（支持AI查询）');
    expect(input).toBeInTheDocument();
  });

  it('renders search button', () => {
    render(<HerbSearch />);
    const button = screen.getByRole('button', { name: /搜索/ });
    expect(button).toBeInTheDocument();
  });

  it('calls listHerbs on search', async () => {
    const mockData = {
      data: {
        list: [
          {
            id: 1,
            name: '黄芪',
            alias: '绵芪',
            category: '补气',
            properties: '甘，微温',
            effects: '补气升阳',
            indications: '气虚',
            source: 'manual',
            created_at: '2024-01-01',
          },
        ],
        total: 1,
      },
    };
    vi.mocked(listHerbs).mockResolvedValue(mockData as never);

    render(<HerbSearch />);

    const input = screen.getByPlaceholderText('输入中药名称搜索（支持AI查询）');
    fireEvent.change(input, { target: { value: '黄芪' } });

    const button = screen.getByRole('button', { name: /搜索/ });
    fireEvent.click(button);

    await waitFor(() => {
      expect(listHerbs).toHaveBeenCalledWith({ name: '黄芪', page: 1, size: 20 });
    });
  });

  it('displays herb results in table', async () => {
    const mockData = {
      data: {
        list: [
          {
            id: 1,
            name: '黄芪',
            alias: '绵芪',
            category: '补气',
            properties: '甘，微温',
            effects: '补气升阳',
            indications: '气虚',
            source: 'manual',
            created_at: '2024-01-01',
          },
        ],
        total: 1,
      },
    };
    vi.mocked(listHerbs).mockResolvedValue(mockData as never);

    render(<HerbSearch />);

    const button = screen.getByRole('button', { name: /搜索/ });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('黄芪')).toBeInTheDocument();
    });
  });

  it('renders deepseek source herb correctly', async () => {
    const mockData = {
      data: {
        list: [
          {
            id: 1,
            name: '独活',
            alias: '',
            category: '祛风湿',
            properties: '辛苦微温',
            effects: '祛风除湿',
            indications: '风寒湿痹',
            source: 'deepseek',
            created_at: '2024-01-01',
          },
        ],
        total: 1,
      },
    };
    vi.mocked(listHerbs).mockResolvedValue(mockData as never);

    render(<HerbSearch />);

    const button = screen.getByRole('button', { name: /搜索/ });
    fireEvent.click(button);

    await waitFor(() => {
      // 来源列已删除，但药名应该显示
      expect(screen.getByText('独活')).toBeInTheDocument();
    });
  });

  // --- 新增功能测试 ---

  it('shows "新增中药" button only with role:manage permission', async () => {
    const mockData = { data: { list: [], total: 0 } };
    vi.mocked(listHerbs).mockResolvedValue(mockData as never);

    // Without permission
    mockHasPermission = vi.fn(() => false);
    const { unmount } = render(<HerbSearch />);
    expect(screen.queryByText('新增中药')).not.toBeInTheDocument();
    unmount();

    // With permission
    mockHasPermission = vi.fn(() => true);
    render(<HerbSearch />);
    expect(screen.getByText('新增中药')).toBeInTheDocument();
  });

  it('opens create modal when clicking add button', async () => {
    mockHasPermission = vi.fn(() => true);
    const mockData = { data: { list: [], total: 0 } };
    vi.mocked(listHerbs).mockResolvedValue(mockData as never);

    render(<HerbSearch />);

    fireEvent.click(screen.getByText('新增中药'));

    await waitFor(() => {
      expect(document.querySelector('.ant-modal')).toBeTruthy();
    });
  });

  it('calls createHerb API and clears search after create', async () => {
    mockHasPermission = vi.fn(() => true);
    const mockData = { data: { list: [], total: 0 } };
    vi.mocked(listHerbs).mockResolvedValue(mockData as never);
    vi.mocked(createHerb).mockResolvedValue({ code: 0, message: 'success', data: { id: 100, name: '测试药' } } as never);

    render(<HerbSearch />);

    // Do a search first
    const searchInput = screen.getByPlaceholderText('输入中药名称搜索（支持AI查询）');
    fireEvent.change(searchInput, { target: { value: '黄芪' } });
    fireEvent.click(screen.getByRole('button', { name: /搜索/ }));
    await waitFor(() => {
      expect(listHerbs).toHaveBeenCalledWith(expect.objectContaining({ name: '黄芪' }));
    });

    vi.clearAllMocks();
    vi.mocked(listHerbs).mockResolvedValue(mockData as never);

    // Open modal
    fireEvent.click(screen.getByText('新增中药'));
    await waitFor(() => {
      expect(document.querySelector('.ant-modal')).toBeTruthy();
    });

    // Fill name input inside modal and submit
    const modalInputs = document.querySelectorAll('.ant-modal input');
    if (modalInputs[0]) {
      fireEvent.change(modalInputs[0], { target: { value: '测试药' } });
    }
    const okBtn = document.querySelector('.ant-modal .ant-btn-primary');
    if (okBtn) fireEvent.click(okBtn);

    await waitFor(() => {
      expect(createHerb).toHaveBeenCalled();
    }, { timeout: 3000 });

    // After create, listHerbs should be called with empty name (search cleared)
    await waitFor(() => {
      expect(listHerbs).toHaveBeenCalledWith(expect.objectContaining({ name: '' }));
    }, { timeout: 3000 });
  });
});
