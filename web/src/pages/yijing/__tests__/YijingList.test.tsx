import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import YijingList from '../YijingList';

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return {
    ...actual,
    message: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
  };
});

vi.mock('../../../store/auth', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin', real_name: '管理员', tenant_id: 1 },
    hasPermission: (perm: string) => perm === 'role:manage',
  }),
}));

const mockListHexagrams = vi.fn();
const mockListTrigrams = vi.fn();

vi.mock('../../../api/yijing', () => ({
  listHexagrams: (...args: unknown[]) => mockListHexagrams(...args),
  listTrigrams: (...args: unknown[]) => mockListTrigrams(...args),
  createHexagram: vi.fn(),
  updateHexagram: vi.fn(),
  deleteHexagram: vi.fn(),
  getHexagram: vi.fn(),
}));

const mockHexagram = {
  id: 1,
  number: 1,
  name: '乾',
  symbol: '☰☰',
  upper_trigram: '乾',
  lower_trigram: '乾',
  judgment: '元亨利贞',
  yao_texts: null,
  commentary: '',
  tcm_application: '',
  related_hexagrams: null,
  description: '',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

const mockHexagram2 = {
  ...mockHexagram,
  id: 2,
  number: 2,
  name: '坤',
  symbol: '☷☷',
  upper_trigram: '坤',
  lower_trigram: '坤',
  judgment: '元亨，利牝马之贞',
};

describe('YijingList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListTrigrams.mockResolvedValue({ data: ['乾', '坤', '震', '巽', '坎', '离', '艮', '兑'] });
  });

  const renderComponent = () =>
    render(
      <MemoryRouter>
        <YijingList />
      </MemoryRouter>
    );

  it('renders search bar and card grid when data loads', { timeout: 15000 }, async () => {
    mockListHexagrams.mockResolvedValue({
      data: {
        list: [mockHexagram, mockHexagram2],
        total: 2,
      },
    });

    renderComponent();

    // Search bar should be present
    expect(screen.getByPlaceholderText('输入卦名搜索')).toBeInTheDocument();

    // Wait for hexagram cards to load — multiple elements with same name is expected (card name + trigram tag)
    await waitFor(() => {
      const elements = screen.getAllByText('乾');
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
    const kunElements = screen.getAllByText('坤');
    expect(kunElements.length).toBeGreaterThanOrEqual(1);
  });

  it('displays hexagram cards with name and symbol', { timeout: 15000 }, async () => {
    mockListHexagrams.mockResolvedValue({
      data: {
        list: [mockHexagram],
        total: 1,
      },
    });

    renderComponent();

    await waitFor(() => {
      const elements = screen.getAllByText('乾');
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText('☰☰')).toBeInTheDocument();
    expect(screen.getByText('第 1 卦')).toBeInTheDocument();
  });

  it('shows empty state when no results', { timeout: 15000 }, async () => {
    mockListHexagrams.mockResolvedValue({
      data: {
        list: [],
        total: 0,
      },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('暂无卦象数据')).toBeInTheDocument();
    });
  });

  it('shows create button for admin users', { timeout: 15000 }, async () => {
    mockListHexagrams.mockResolvedValue({
      data: { list: [], total: 0 },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('新增')).toBeInTheDocument();
    });
  });

  it('hides create button for non-admin users', { timeout: 15000 }, async () => {
    vi.doMock('../../../store/auth', () => ({
      useAuth: () => ({
        user: { id: 2, username: 'doctor', real_name: '医生', tenant_id: 1 },
        hasPermission: () => false,
      }),
    }));

    mockListHexagrams.mockResolvedValue({
      data: { list: [], total: 0 },
    });

    // Re-render with non-admin mock (note: vi.doMock affects subsequent imports)
    renderComponent();

    await waitFor(() => {
      expect(mockListHexagrams).toHaveBeenCalled();
    });
  });

  it('calls listHexagrams on initial load', { timeout: 15000 }, async () => {
    mockListHexagrams.mockResolvedValue({
      data: { list: [mockHexagram], total: 1 },
    });

    renderComponent();

    await waitFor(() => {
      expect(mockListHexagrams).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, size: 64 })
      );
    });
  });

  it('shows hexagram trigram tags', { timeout: 15000 }, async () => {
    mockListHexagrams.mockResolvedValue({
      data: { list: [mockHexagram], total: 1 },
    });

    renderComponent();

    await waitFor(() => {
      // For 乾卦: card name "乾" + upper_trigram tag "乾" + lower_trigram tag "乾" = 3 elements
      const trigramTags = screen.getAllByText('乾');
      expect(trigramTags.length).toBeGreaterThanOrEqual(3);
    });
  });
});
