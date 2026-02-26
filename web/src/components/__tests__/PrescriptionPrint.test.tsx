import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PrescriptionPrint from '../PrescriptionPrint';
import type { PrescriptionData } from '../../api/prescription';

describe('PrescriptionPrint', () => {
  const mockPrescription: PrescriptionData = {
    id: 1,
    record_id: 1,
    tenant_id: 1,
    formula_name: '小青龙汤',
    total_doses: 7,
    notes: '饭后服用',
    created_by: 1,
    creator: { id: 1, real_name: '张医生', username: 'zhangdoctor' },
    items: [
      {
        id: 1,
        prescription_id: 1,
        herb_name: '麻黄',
        dosage: '9g',
        sort_order: 0,
        notes: '',
        created_at: '2024-01-01',
      },
      {
        id: 2,
        prescription_id: 1,
        herb_name: '桂枝',
        dosage: '9g',
        sort_order: 1,
        notes: '后下',
        created_at: '2024-01-01',
      },
    ],
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  };

  it('renders print button', () => {
    render(
      <PrescriptionPrint
        prescription={mockPrescription}
        patientName="测试患者"
        patientAge={30}
      />
    );

    const button = screen.getByRole('button', { name: /打印/ });
    expect(button).toBeInTheDocument();
  });

  it('renders print content in hidden div', () => {
    const { container } = render(
      <PrescriptionPrint
        prescription={mockPrescription}
        patientName="测试患者"
        patientAge={30}
      />
    );

    // The hidden div should contain prescription info
    const hiddenDiv = container.querySelector('div[style*="display: none"]');
    expect(hiddenDiv).not.toBeNull();
    expect(hiddenDiv?.textContent).toContain('处 方 笺');
    expect(hiddenDiv?.textContent).toContain('测试患者');
    expect(hiddenDiv?.textContent).toContain('30岁');
    expect(hiddenDiv?.textContent).toContain('小青龙汤');
    expect(hiddenDiv?.textContent).toContain('麻黄');
    expect(hiddenDiv?.textContent).toContain('桂枝');
    expect(hiddenDiv?.textContent).toContain('7 付');
    expect(hiddenDiv?.textContent).toContain('饭后服用');
    expect(hiddenDiv?.textContent).toContain('张医生');
  });

  it('handles window.open for print and sets Beijing time', () => {
    const mockWrite = vi.fn();
    const mockOpen = vi.fn().mockReturnValue({
      document: {
        write: mockWrite,
        close: vi.fn(),
      },
      print: vi.fn(),
      close: vi.fn(),
    });
    vi.stubGlobal('open', mockOpen);

    render(
      <PrescriptionPrint
        prescription={mockPrescription}
        patientName="测试患者"
        patientAge={30}
      />
    );

    const button = screen.getByRole('button', { name: /打印/ });
    button.click();

    expect(mockOpen).toHaveBeenCalledWith('', '_blank');
    // Verify the printed content contains a date string (Beijing time format)
    const printedHtml = mockWrite.mock.calls[0][0];
    expect(printedHtml).toContain('日期');
    expect(printedHtml).toContain('年');

    vi.unstubAllGlobals();
  });
});
