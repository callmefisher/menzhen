import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import PrescriptionModal from '../PrescriptionModal';

// Mock API modules
vi.mock('../../api/formula', () => ({
  listFormulas: vi.fn().mockResolvedValue({ data: { list: [], total: 0 } }),
}));

vi.mock('../../api/prescription', () => ({
  createPrescription: vi.fn(),
  updatePrescription: vi.fn(),
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

describe('PrescriptionModal', () => {
  const defaultProps = {
    open: true,
    recordId: 1,
    editData: null,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders modal with title', () => {
    render(<PrescriptionModal {...defaultProps} />);
    expect(screen.getByText('开方')).toBeInTheDocument();
  });

  it('renders two tabs', () => {
    render(<PrescriptionModal {...defaultProps} />);
    expect(screen.getByText('按方开药')).toBeInTheDocument();
    expect(screen.getByText('自由开方')).toBeInTheDocument();
  });

  it('renders herb list table', () => {
    render(<PrescriptionModal {...defaultProps} />);
    expect(screen.getByText('药名')).toBeInTheDocument();
    expect(screen.getByText('用量')).toBeInTheDocument();
  });

  it('renders add herb button', () => {
    render(<PrescriptionModal {...defaultProps} />);
    expect(screen.getByText('添加药物')).toBeInTheDocument();
  });

  it('renders total doses input', () => {
    render(<PrescriptionModal {...defaultProps} />);
    expect(screen.getByText('总付数')).toBeInTheDocument();
  });

  it('shows edit title when editData is provided', () => {
    const editData = {
      id: 1,
      record_id: 1,
      tenant_id: 1,
      formula_name: '测试方剂',
      total_doses: 7,
      notes: '',
      created_by: 1,
      items: [
        {
          id: 1,
          prescription_id: 1,
          herb_name: '黄芪',
          dosage: '15g',
          sort_order: 0,
          notes: '',
          created_at: '2024-01-01',
        },
      ],
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };

    render(<PrescriptionModal {...defaultProps} editData={editData} />);
    expect(screen.getByText('编辑处方')).toBeInTheDocument();
  });
});
