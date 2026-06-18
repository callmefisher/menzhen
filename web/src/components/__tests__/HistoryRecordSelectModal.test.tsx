import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HistoryRecordSelectModal, {
  stripDuplicateHeader,
  extractHeader,
  assembleHistoryContent,
} from '../HistoryRecordSelectModal';
import type { RecordListItem } from '../../api/record';

// Mock API
vi.mock('../../api/record', () => ({
  listRecords: vi.fn(),
}));

// Mock useIsMobile
vi.mock('../../hooks/useIsMobile', () => ({ default: () => false }));

import { listRecords } from '../../api/record';

const mockListRecords = listRecords as ReturnType<typeof vi.fn>;

const makeRecord = (overrides: Partial<RecordListItem> = {}): RecordListItem => ({
  id: 1,
  patient_id: 10,
  patient_name: '张三',
  patient_age: 45,
  diagnosis: '脉象：弦细\n舌象：舌淡红\n辨证：肝胃不和',
  treatment: '柴胡疏肝散加减',
  chief_complaint: '胃痛',
  pulse_name: '弦细',
  visit_date: '2024-01-15',
  created_at: '2024-01-15',
  ...overrides,
});

// ---------- Helper function tests ----------

describe('stripDuplicateHeader', () => {
  it('removes 性别/年龄/出生年月/主诉/姓名 lines', () => {
    const input = '性别：男\n年龄：45岁\n出生年月：1980年05月\n主诉：胃痛\n脉象：弦细\n舌象：舌淡红\n辨证：肝胃不和';
    const result = stripDuplicateHeader(input);
    expect(result).toBe('脉象：弦细\n舌象：舌淡红\n辨证：肝胃不和');
  });

  it('preserves 脉象/舌象 and clinical body', () => {
    const input = '性别：男\n脉象：弦细\n舌象：舌淡红\n---\n1. 大便：正常\n辨证：肝胃不和';
    const result = stripDuplicateHeader(input);
    expect(result).toContain('脉象：弦细');
    expect(result).toContain('舌象：舌淡红');
    expect(result).toContain('1. 大便：正常');
    expect(result).not.toContain('性别：男');
  });

  it('handles empty string', () => {
    expect(stripDuplicateHeader('')).toBe('');
  });

  it('handles text without header lines', () => {
    const input = '脉象：弦细\n辨证：肝胃不和';
    expect(stripDuplicateHeader(input)).toBe('脉象：弦细\n辨证：肝胃不和');
  });
});

describe('extractHeader', () => {
  it('extracts content before first --- separator', () => {
    const input = '性别：男\n年龄：45岁\n主诉：胃痛\n---\n1. 大便：正常\n2. 小便：正常';
    const result = extractHeader(input);
    expect(result).toBe('性别：男\n年龄：45岁\n主诉：胃痛');
  });

  it('returns full text when no --- separator', () => {
    const input = '性别：男\n年龄：45岁';
    expect(extractHeader(input)).toBe('性别：男\n年龄：45岁');
  });

  it('handles empty string', () => {
    expect(extractHeader('')).toBe('');
  });
});

describe('assembleHistoryContent', () => {
  const currentDiagnosis = '性别：男\n年龄：45岁\n出生年月：1980年05月\n主诉：胃痛\n脉象：弦细\n舌象：舌淡红\n---\n1. 大便：正常';

  it('assembles header + selected records sorted by date descending', () => {
    const records = [
      makeRecord({ id: 1, visit_date: '2024-01-15', diagnosis: '性别：男\n脉象：弦细\n辨证：肝胃不和', treatment: '柴胡疏肝散' }),
      makeRecord({ id: 2, visit_date: '2024-03-20', diagnosis: '性别：男\n脉象：滑\n辨证：脾虚', treatment: '四君子汤' }),
    ];
    const result = assembleHistoryContent(currentDiagnosis, records);

    // Header preserved
    expect(result).toContain('性别：男');
    expect(result).toContain('主诉：胃痛');
    expect(result).toContain('脉象：弦细');

    // Newer record (2024-03-20) comes first
    const date1Idx = result.indexOf('【日期】2024-03-20');
    const date2Idx = result.indexOf('【日期】2024-01-15');
    expect(date1Idx).toBeGreaterThan(-1);
    expect(date2Idx).toBeGreaterThan(-1);
    expect(date1Idx).toBeLessThan(date2Idx);

    // Each record has date, diagnosis (stripped), treatment
    expect(result).toContain('【日期】2024-03-20');
    expect(result).toContain('辨证：脾虚');
    expect(result).toContain('【治疗】四君子汤');

    // Duplicate header stripped from records
    const afterFirstDate = result.slice(result.indexOf('【日期】2024-03-20'));
    // The record's diagnosis should not contain 性别：男 (stripped)
    const recordBlock = afterFirstDate.slice(0, afterFirstDate.indexOf('--------------------------------------------------'));
    expect(recordBlock).not.toContain('性别：男');

    // Separated by long dash line
    expect(result.split('--------------------------------------------------').length).toBeGreaterThanOrEqual(3);
  });

  it('groups records with the same visit date together', () => {
    const records = [
      makeRecord({ id: 1, visit_date: '2024-01-15', diagnosis: '脉象：弦细\n辨证：肝胃不和', treatment: '柴胡疏肝散' }),
      makeRecord({ id: 2, visit_date: '2024-01-15', diagnosis: '脉象：滑\n辨证：脾虚', treatment: '四君子汤' }),
      makeRecord({ id: 3, visit_date: '2024-02-20', diagnosis: '脉象：细\n辨证：气虚', treatment: '补中益气汤' }),
    ];
    const result = assembleHistoryContent(currentDiagnosis, records);

    // Should have only 2 date sections (2024-01-15 and 2024-02-20)
    const dateSections = result.split('【日期】').filter(s => s.trim());
    expect(dateSections.length).toBe(3); // header counts as one, then two date sections

    // Check 2024-01-15 section contains both records
    const janSection = result.slice(
      result.indexOf('【日期】2024-01-15'),
      result.indexOf('【日期】2024-02-20')
    );
    expect(janSection).toContain('辨证：肝胃不和');
    expect(janSection).toContain('【治疗】柴胡疏肝散');
    expect(janSection).toContain('辨证：脾虚');
    expect(janSection).toContain('【治疗】四君子汤');

    // Check 2024-01-15 section has two diagnoses and two treatments
    const janDiagnoses = (janSection.match(/【诊断】/g) || []).length;
    const janTreatments = (janSection.match(/【治疗】/g) || []).length;
    expect(janDiagnoses).toBe(2);
    expect(janTreatments).toBe(2);

    // Only one date tag for same date
    const janDateTags = (janSection.match(/【日期】2024-01-15/g) || []).length;
    expect(janDateTags).toBe(1);
  });

  it('returns just header when no records selected', () => {
    const result = assembleHistoryContent(currentDiagnosis, []);
    expect(result).toBe(extractHeader(currentDiagnosis));
  });

  it('ends with long dash separator', () => {
    const records = [makeRecord({ id: 1, visit_date: '2024-01-15' })];
    const result = assembleHistoryContent(currentDiagnosis, records);
    expect(result.endsWith('--------------------------------------------------\n')).toBe(true);
  });

  it('handles records with empty diagnosis/treatment', () => {
    const records = [makeRecord({ id: 1, visit_date: '2024-01-15', diagnosis: '', treatment: '' })];
    const result = assembleHistoryContent(currentDiagnosis, records);
    expect(result).toContain('【日期】2024-01-15');
    expect(result).toContain('【诊断】');
    expect(result).toContain('【治疗】');
  });
});

// ---------- Component tests ----------

describe('HistoryRecordSelectModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    open: true,
    patientId: 10,
    patientName: '张三',
    currentDiagnosis: '性别：男\n主诉：胃痛\n---\n1. 大便：正常',
    onClose: vi.fn(),
    onConfirm: vi.fn(),
  };

  it('renders modal with patient name and record count', async () => {
    const records = [makeRecord({ id: 1 }), makeRecord({ id: 2, visit_date: '2024-02-20' })];
    mockListRecords.mockResolvedValue({ data: { list: records, total: 2 } });

    render(<HistoryRecordSelectModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/张三/)).toBeInTheDocument();
      expect(screen.getByText(/共 2 条/)).toBeInTheDocument();
    });
  });

  it('fetches records with patient_id and page size 10', async () => {
    mockListRecords.mockResolvedValue({ data: { list: [], total: 0 } });

    render(<HistoryRecordSelectModal {...defaultProps} />);

    await waitFor(() => {
      expect(mockListRecords).toHaveBeenCalledWith(
        expect.objectContaining({ patient_id: 10, page: 1, size: 10 }),
      );
    });
  });

  it('shows empty state when no records', async () => {
    mockListRecords.mockResolvedValue({ data: { list: [], total: 0 } });

    render(<HistoryRecordSelectModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('该患者暂无历史诊疗记录')).toBeInTheDocument();
    });
  });

  it('displays record dates and treatment previews', async () => {
    const records = [
      makeRecord({ id: 1, visit_date: '2024-01-15', treatment: '柴胡疏肝散加减' }),
    ];
    mockListRecords.mockResolvedValue({ data: { list: records, total: 1 } });

    render(<HistoryRecordSelectModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('2024-01-15')).toBeInTheDocument();
      expect(screen.getByText(/柴胡疏肝散加减/)).toBeInTheDocument();
    });
  });

  it('selects a record on click and enables confirm button', async () => {
    const user = userEvent.setup();
    const records = [makeRecord({ id: 1, visit_date: '2024-01-15' })];
    mockListRecords.mockResolvedValue({ data: { list: records, total: 1 } });

    render(<HistoryRecordSelectModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('2024-01-15')).toBeInTheDocument();
    });

    // Confirm button disabled initially
    const confirmBtn = screen.getByText(/确认插入/).closest('button');
    expect(confirmBtn).toBeDisabled();

    // Click the record row to select
    await user.click(screen.getByText('2024-01-15'));

    // Confirm button now enabled
    expect(confirmBtn).not.toBeDisabled();
    expect(screen.getByText(/确认插入（1 条）/)).toBeInTheDocument();
  });

  it('calls onConfirm with assembled content on confirm', async () => {
    const user = userEvent.setup();
    const records = [
      makeRecord({
        id: 1,
        visit_date: '2024-01-15',
        diagnosis: '性别：男\n脉象：弦细\n辨证：肝胃不和',
        treatment: '柴胡疏肝散',
      }),
    ];
    mockListRecords.mockResolvedValue({ data: { list: records, total: 1 } });

    render(<HistoryRecordSelectModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('2024-01-15')).toBeInTheDocument();
    });

    // Select the record
    await user.click(screen.getByText('2024-01-15'));

    // Click confirm
    await user.click(screen.getByText(/确认插入/));

    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
    const assembled = defaultProps.onConfirm.mock.calls[0][0] as string;

    // Header preserved
    expect(assembled).toContain('性别：男');
    expect(assembled).toContain('主诉：胃痛');
    // Record content included
    expect(assembled).toContain('【日期】2024-01-15');
    expect(assembled).toContain('【诊断】');
    expect(assembled).toContain('脉象：弦细');
    expect(assembled).toContain('辨证：肝胃不和');
    expect(assembled).toContain('【治疗】柴胡疏肝散');
    // Duplicate header stripped from record
    const afterDate = assembled.slice(assembled.indexOf('【日期】2024-01-15'));
    const recordBlock = afterDate.slice(0, afterDate.indexOf('--------------------------------------------------'));
    expect(recordBlock).not.toContain('性别：男');
    // Long dash separator used
    expect(assembled).toContain('--------------------------------------------------');
  });

  it('select all fetches all records and selects them', async () => {
    const user = userEvent.setup();
    const pageRecords = Array.from({ length: 10 }, (_, i) =>
      makeRecord({ id: i + 1, visit_date: `2024-01-${String(i + 1).padStart(2, '0')}` }),
    );
    const allRecords = Array.from({ length: 12 }, (_, i) =>
      makeRecord({ id: i + 1, visit_date: `2024-01-${String(i + 1).padStart(2, '0')}` }),
    );

    mockListRecords.mockImplementation((params: { page?: number; size?: number }) => {
      const page = params.page || 1;
      const size = params.size || 10;
      if (size >= 9999) {
        return Promise.resolve({ data: { list: allRecords, total: 12 } });
      }
      const start = (page - 1) * size;
      return Promise.resolve({ data: { list: allRecords.slice(start, start + size), total: 12 } });
    });

    render(<HistoryRecordSelectModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/共 12 条/)).toBeInTheDocument();
    });

    // Click "全选（全部页）"
    const selectAllLabel = screen.getByText('全选（全部页）');
    await user.click(selectAllLabel);

    await waitFor(() => {
      expect(screen.getByText(/确认插入（12 条）/)).toBeInTheDocument();
    });
  });

  it('clear selection resets selected count', async () => {
    const user = userEvent.setup();
    const records = [makeRecord({ id: 1, visit_date: '2024-01-15' })];
    mockListRecords.mockResolvedValue({ data: { list: records, total: 1 } });

    render(<HistoryRecordSelectModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('2024-01-15')).toBeInTheDocument();
    });

    // Select
    await user.click(screen.getByText('2024-01-15'));
    expect(screen.getByText(/确认插入（1 条）/)).toBeInTheDocument();

    // Clear
    await user.click(screen.getByText('清空选择'));
    expect(screen.getByText(/确认插入（0 条）/)).toBeInTheDocument();
  });

  it('pagination shows when total > page size', async () => {
    const records = Array.from({ length: 10 }, (_, i) =>
      makeRecord({ id: i + 1, visit_date: `2024-01-${String(i + 1).padStart(2, '0')}` }),
    );
    mockListRecords.mockResolvedValue({ data: { list: records, total: 25 } });

    render(<HistoryRecordSelectModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/第 1 \/ 3 页/)).toBeInTheDocument();
    });
  });

  it('does not fetch when patientId is undefined', async () => {
    render(<HistoryRecordSelectModal {...defaultProps} patientId={undefined} />);

    await waitFor(() => {
      expect(mockListRecords).not.toHaveBeenCalled();
    });
  });

  it('calls onClose when cancel button clicked', async () => {
    const user = userEvent.setup();
    mockListRecords.mockResolvedValue({ data: { list: [], total: 0 } });

    render(<HistoryRecordSelectModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('取消')).toBeInTheDocument();
    });

    await user.click(screen.getByText('取消'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
