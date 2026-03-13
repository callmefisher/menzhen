import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ClinicalExperienceList from '../ClinicalExperienceList';

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

const mockListClinicalExperiences = vi.fn();
const mockListClinicalExperienceCategories = vi.fn();

vi.mock('../../../api/clinicalExperience', () => ({
  listClinicalExperiences: (...args: unknown[]) => mockListClinicalExperiences(...args),
  deleteClinicalExperience: vi.fn(),
  listClinicalExperienceCategories: (...args: unknown[]) => mockListClinicalExperienceCategories(...args),
  createClinicalExperience: vi.fn(),
  updateClinicalExperience: vi.fn(),
}));

describe('ClinicalExperienceList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListClinicalExperienceCategories.mockResolvedValue({ data: ['内科', '外科'] });
  });

  const renderComponent = () =>
    render(
      <MemoryRouter>
        <ClinicalExperienceList />
      </MemoryRouter>
    );

  it('renders list with data', { timeout: 15000 }, async () => {
    mockListClinicalExperiences.mockResolvedValue({
      data: {
        list: [
          { id: 1, source: '伤寒论', category: '内科', herbs: '桂枝', formula: '桂枝汤', experience: '治疗太阳病', created_at: '2025-01-01', updated_at: '2025-01-01' },
          { id: 2, source: '金匮要略', category: '外科', herbs: '黄芪', formula: '补中益气汤', experience: '治疗气虚', created_at: '2025-01-02', updated_at: '2025-01-02' },
        ],
        total: 2,
      },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('伤寒论')).toBeInTheDocument();
    });
    expect(screen.getByText('金匮要略')).toBeInTheDocument();
  });

  it('renders empty state', { timeout: 15000 }, async () => {
    mockListClinicalExperiences.mockResolvedValue({
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
