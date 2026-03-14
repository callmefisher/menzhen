import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HexagramDrawer from '../HexagramDrawer';

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return {
    ...actual,
    message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  };
});

vi.mock('../../../api/yijing', () => ({
  updateHexagram: vi.fn(),
  deleteHexagram: vi.fn(),
  listHexagrams: vi.fn(),
  listTrigrams: vi.fn(),
  createHexagram: vi.fn(),
  getHexagram: vi.fn(),
}));

// Mutable permission flag so tests can control admin vs non-admin
let mockIsAdmin = true;

vi.mock('../../../store/auth', () => ({
  useAuth: () => ({
    hasPermission: (perm: string) => mockIsAdmin && perm === 'role:manage',
  }),
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

const defaultProps = {
  hexagram: mockHexagram,
  open: true,
  onClose: vi.fn(),
  onUpdate: vi.fn(),
  onNavigate: vi.fn(),
};

describe('HexagramDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAdmin = true;
  });

  it('renders hexagram detail when open (admin)', { timeout: 15000 }, async () => {
    mockIsAdmin = true;

    render(
      <MemoryRouter>
        <HexagramDrawer {...defaultProps} />
      </MemoryRouter>
    );

    await waitFor(() => {
      // Multiple elements with '乾' expected: name div + upper/lower trigram tags
      const elements = screen.getAllByText('乾');
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText('第 1 卦')).toBeInTheDocument();
    expect(screen.getByText('☰☰')).toBeInTheDocument();
  });

  it('shows all tabs (概述/爻辞/传文/中医应用/关联卦)', { timeout: 15000 }, async () => {
    mockIsAdmin = true;

    render(
      <MemoryRouter>
        <HexagramDrawer {...defaultProps} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '概述' })).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: '爻辞' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '传文' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '中医应用' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '关联卦' })).toBeInTheDocument();
  });

  it('shows edit and delete buttons for admin', { timeout: 15000 }, async () => {
    mockIsAdmin = true;

    render(
      <MemoryRouter>
        <HexagramDrawer {...defaultProps} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('编辑')).toBeInTheDocument();
    });
    expect(screen.getByText('删除')).toBeInTheDocument();
  });

  it('does not show edit/delete buttons for non-admin', { timeout: 15000 }, async () => {
    mockIsAdmin = false;

    render(
      <MemoryRouter>
        <HexagramDrawer {...defaultProps} />
      </MemoryRouter>
    );

    await waitFor(() => {
      // Drawer should render with hexagram name (multiple elements with '乾' expected)
      const elements = screen.getAllByText('乾');
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText('编辑')).not.toBeInTheDocument();
    expect(screen.queryByText('删除')).not.toBeInTheDocument();
  });

  it('shows loading spinner when hexagram is null', { timeout: 15000 }, async () => {
    mockIsAdmin = false;

    render(
      <MemoryRouter>
        <HexagramDrawer
          hexagram={null}
          open={true}
          onClose={vi.fn()}
          onUpdate={vi.fn()}
          onNavigate={vi.fn()}
        />
      </MemoryRouter>
    );

    // Drawer is open but no hexagram — loading state
    await waitFor(() => {
      const spinners = document.querySelectorAll('.ant-spin');
      expect(spinners.length).toBeGreaterThan(0);
    });
  });

  it('does not render drawer content when closed', { timeout: 15000 }, async () => {
    mockIsAdmin = true;

    render(
      <MemoryRouter>
        <HexagramDrawer {...defaultProps} open={false} />
      </MemoryRouter>
    );

    // When drawer is closed the content is not visible
    await waitFor(() => {
      const drawer = document.querySelector('.ant-drawer-open');
      expect(drawer).not.toBeInTheDocument();
    });
  });
});
