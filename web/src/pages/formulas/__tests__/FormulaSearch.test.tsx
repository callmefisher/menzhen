import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FormulaSearch from '../FormulaSearch';

// Mock the API module
vi.mock('../../../api/formula', () => ({
  listFormulas: vi.fn(),
  updateFormulaComposition: vi.fn(),
  updateFormulaName: vi.fn(),
  deleteFormula: vi.fn(),
}));

// Mock useAuth
vi.mock('../../../store/auth', () => ({
  useAuth: () => ({
    hasPermission: () => false,
  }),
}));

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

import { listFormulas } from '../../../api/formula';

describe('FormulaSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders search input', () => {
    render(<FormulaSearch />);
    const input = screen.getByPlaceholderText('输入方剂名称搜索（支持AI查询）');
    expect(input).toBeInTheDocument();
  });

  it('renders search button', () => {
    render(<FormulaSearch />);
    const button = screen.getByRole('button', { name: /搜索/ });
    expect(button).toBeInTheDocument();
  });

  it('calls listFormulas on search', async () => {
    const mockData = {
      data: {
        list: [
          {
            id: 1,
            name: '小青龙汤',
            effects: '解表散寒',
            indications: '外寒里饮',
            composition: [
              { herb_name: '麻黄', default_dosage: '9g' },
              { herb_name: '桂枝', default_dosage: '9g' },
            ],
            source: 'manual',
            created_at: '2024-01-01',
          },
        ],
        total: 1,
      },
    };
    vi.mocked(listFormulas).mockResolvedValue(mockData as never);

    render(<FormulaSearch />);

    const input = screen.getByPlaceholderText('输入方剂名称搜索（支持AI查询）');
    fireEvent.change(input, { target: { value: '小青龙汤' } });

    const button = screen.getByRole('button', { name: /搜索/ });
    fireEvent.click(button);

    await waitFor(() => {
      expect(listFormulas).toHaveBeenCalledWith({ name: '小青龙汤', page: 1, size: 20 });
    });
  });

  it('displays formula results in table', async () => {
    const mockData = {
      data: {
        list: [
          {
            id: 1,
            name: '小青龙汤',
            effects: '解表散寒',
            indications: '外寒里饮',
            composition: [
              { herb_name: '麻黄', default_dosage: '9g' },
            ],
            source: 'manual',
            created_at: '2024-01-01',
          },
        ],
        total: 1,
      },
    };
    vi.mocked(listFormulas).mockResolvedValue(mockData as never);

    render(<FormulaSearch />);

    const button = screen.getByRole('button', { name: /搜索/ });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('小青龙汤')).toBeInTheDocument();
    });
  });
});
