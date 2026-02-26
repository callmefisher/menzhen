import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HerbSearch from '../HerbSearch';

// Mock the API module
vi.mock('../../../api/herb', () => ({
  listHerbs: vi.fn(),
  listHerbCategories: vi.fn().mockResolvedValue({ data: [] }),
  deleteHerb: vi.fn(),
}));

// Mock useAuth
vi.mock('../../../store/auth', () => ({
  useAuth: () => ({
    hasPermission: () => false,
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

import { listHerbs } from '../../../api/herb';

describe('HerbSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('shows AI tag for deepseek source', async () => {
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
      expect(screen.getByText('AI')).toBeInTheDocument();
    });
  });
});
