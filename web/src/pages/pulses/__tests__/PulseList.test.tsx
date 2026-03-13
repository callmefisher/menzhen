import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PulseList from '../PulseList';

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return {
    ...actual,
    message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  };
});

vi.mock('../../../store/auth', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin', real_name: '管理员', tenant_id: 1 },
    hasPermission: () => true,
  }),
}));

const mockListPulses = vi.fn();
const mockListPulseCategories = vi.fn();

vi.mock('../../../api/pulse', () => ({
  listPulses: (...args: unknown[]) => mockListPulses(...args),
  deletePulse: vi.fn(),
  listPulseCategories: (...args: unknown[]) => mockListPulseCategories(...args),
  updatePulse: vi.fn(),
  createPulse: vi.fn(),
}));

describe('PulseList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPulseCategories.mockResolvedValue({ data: ['浮脉类', '沉脉类'] });
  });

  const renderComponent = () =>
    render(
      <MemoryRouter>
        <PulseList />
      </MemoryRouter>
    );

  it('renders pulse list with data', { timeout: 15000 }, async () => {
    mockListPulses.mockResolvedValue({
      data: {
        list: [
          { id: 1, name: '浮脉', category: '浮脉类', description: '轻取即得', clinical_meaning: '表证', common_conditions: '感冒', created_at: '2025-01-01' },
          { id: 2, name: '沉脉', category: '沉脉类', description: '重按始得', clinical_meaning: '里证', common_conditions: '内伤', created_at: '2025-01-02' },
        ],
        total: 2,
      },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('浮脉')).toBeInTheDocument();
    });
    expect(screen.getByText('沉脉')).toBeInTheDocument();
  });

  it('renders empty state', { timeout: 15000 }, async () => {
    mockListPulses.mockResolvedValue({
      data: {
        list: [],
        total: 0,
      },
    });

    renderComponent();

    await waitFor(() => {
      const elements = screen.getAllByText('No data');
      expect(elements.length).toBeGreaterThan(0);
    });
  });
});
