import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RecordList from '../RecordList';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ state: null, pathname: '/records', search: '', hash: '', key: 'default' }),
  };
});

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return {
    ...actual,
    message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  };
});

const mockListRecords = vi.fn();
const mockDeleteRecord = vi.fn();
const mockFindRecordPage = vi.fn();

vi.mock('../../../api/record', () => ({
  listRecords: (...args: unknown[]) => mockListRecords(...args),
  deleteRecord: (...args: unknown[]) => mockDeleteRecord(...args),
  findRecordPage: (...args: unknown[]) => mockFindRecordPage(...args),
}));

describe('RecordList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderRecordList = () =>
    render(
      <MemoryRouter>
        <RecordList />
      </MemoryRouter>
    );

  it('renders record list and shows data', async () => {
    mockListRecords.mockResolvedValue({
      data: {
        list: [
          { id: 1, patient_id: 1, patient_name: '张三', patient_age: 30, diagnosis: '感冒', chief_complaint: '头痛', pulse_name: '', visit_date: '2025-01-01', created_at: '2025-01-01' },
          { id: 2, patient_id: 2, patient_name: '李四', patient_age: 25, diagnosis: '咳嗽', chief_complaint: '咳嗽三天', pulse_name: '', visit_date: '2025-01-02', created_at: '2025-01-02' },
        ],
        total: 2,
      },
    });

    renderRecordList();

    await waitFor(() => {
      expect(screen.getByText('张三')).toBeInTheDocument();
    });
    expect(screen.getByText('李四')).toBeInTheDocument();
    expect(screen.getByText('感冒')).toBeInTheDocument();
    expect(screen.getByText('咳嗽')).toBeInTheDocument();
    expect(screen.getByText('共 2 条记录')).toBeInTheDocument();
  });

  it('renders empty state when no records', async () => {
    mockListRecords.mockResolvedValue({
      data: {
        list: [],
        total: 0,
      },
    });

    renderRecordList();

    await waitFor(() => {
      expect(screen.getByText('暂无诊疗记录')).toBeInTheDocument();
    });
  });
});
