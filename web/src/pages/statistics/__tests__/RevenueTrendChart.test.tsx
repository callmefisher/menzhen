import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import RevenueTrendChart from '../components/RevenueTrendChart';
import type { DailyTrendItem } from '../../../api/statistics';

// Capture the props passed to ReactECharts mock
let lastEChartsProps: any = {};

vi.mock('echarts-for-react', () => ({
  default: vi.fn((props: any) => {
    lastEChartsProps = props;
    return <div data-testid="echarts-mock" />;
  }),
}));

const mockData: DailyTrendItem[] = [
  { date: '03-01', revenue: 1000, consultation_fee: 300, drug_fee: 700, record_count: 5, new_patient_count: 2, returning_patient_count: 3 },
  { date: '03-02', revenue: 1200, consultation_fee: 400, drug_fee: 800, record_count: 6, new_patient_count: 1, returning_patient_count: 5 },
  { date: '03-03', revenue: 800, consultation_fee: 200, drug_fee: 600, record_count: 4, new_patient_count: 3, returning_patient_count: 1 },
];

const mockRawDates = ['2026-03-01', '2026-03-02', '2026-03-03'];

describe('RevenueTrendChart', () => {
  beforeEach(() => {
    lastEChartsProps = {};
  });

  it('renders without crash with minimal props', () => {
    const { getByTestId } = render(<RevenueTrendChart data={mockData} />);
    expect(getByTestId('echarts-mock')).toBeInTheDocument();
  });

  it('includes dataZoom when enableDataZoom=true and not mobile', () => {
    render(
      <RevenueTrendChart
        data={mockData}
        rawDates={mockRawDates}
        enableDataZoom={true}
        isMobile={false}
        onBrushSelect={vi.fn()}
      />,
    );
    const dz = lastEChartsProps.option.dataZoom;
    expect(dz).toHaveLength(2);
    expect(dz[0].type).toBe('slider');
    expect(dz[0].height).toBe(40);
    expect(dz[1].type).toBe('inside');
    expect(dz[1].zoomOnMouseWheel).toBe('shift');
  });

  it('excludes dataZoom when enableDataZoom=false', () => {
    render(
      <RevenueTrendChart
        data={mockData}
        rawDates={mockRawDates}
        enableDataZoom={false}
        onBrushSelect={vi.fn()}
      />,
    );
    expect(lastEChartsProps.option.dataZoom).toEqual([]);
  });

  it('excludes dataZoom when isMobile=true', () => {
    render(
      <RevenueTrendChart
        data={mockData}
        rawDates={mockRawDates}
        enableDataZoom={true}
        isMobile={true}
        onBrushSelect={vi.fn()}
      />,
    );
    expect(lastEChartsProps.option.dataZoom).toEqual([]);
  });

  it('excludes dataZoom when rawDates has less than 2 items', () => {
    render(
      <RevenueTrendChart
        data={mockData.slice(0, 1)}
        rawDates={['2026-03-01']}
        enableDataZoom={true}
        isMobile={false}
        onBrushSelect={vi.fn()}
      />,
    );
    expect(lastEChartsProps.option.dataZoom).toEqual([]);
  });

  it('adjusts grid.bottom based on dataZoom presence', () => {
    // With dataZoom
    render(
      <RevenueTrendChart
        data={mockData}
        rawDates={mockRawDates}
        enableDataZoom={true}
        isMobile={false}
        onBrushSelect={vi.fn()}
      />,
    );
    expect(lastEChartsProps.option.grid.bottom).toBe(64);

    // Without dataZoom
    render(
      <RevenueTrendChart data={mockData} enableDataZoom={false} />,
    );
    expect(lastEChartsProps.option.grid.bottom).toBe(30);
  });

  it('registers datazoom and dblclick events when dataZoom is active', () => {
    const onBrushSelect = vi.fn();
    const onReset = vi.fn();
    render(
      <RevenueTrendChart
        data={mockData}
        rawDates={mockRawDates}
        enableDataZoom={true}
        isMobile={false}
        onBrushSelect={onBrushSelect}
        onReset={onReset}
      />,
    );
    expect(lastEChartsProps.onEvents).toHaveProperty('datazoom');
    expect(lastEChartsProps.onEvents).toHaveProperty('dblclick');
  });

  it('does not register events when dataZoom is disabled', () => {
    render(
      <RevenueTrendChart
        data={mockData}
        rawDates={mockRawDates}
        enableDataZoom={false}
        onBrushSelect={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(lastEChartsProps.onEvents).toEqual({});
  });

  it('does not register datazoom event without onBrushSelect', () => {
    render(
      <RevenueTrendChart
        data={mockData}
        rawDates={mockRawDates}
        enableDataZoom={true}
        isMobile={false}
      />,
    );
    expect(lastEChartsProps.onEvents).not.toHaveProperty('datazoom');
  });

  it('registers dblclick even without onReset when dataZoom is active', () => {
    render(
      <RevenueTrendChart
        data={mockData}
        rawDates={mockRawDates}
        enableDataZoom={true}
        isMobile={false}
        onBrushSelect={vi.fn()}
      />,
    );
    expect(lastEChartsProps.onEvents).toHaveProperty('dblclick');
  });
});
