import { useRef, useMemo, useCallback, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from 'antd';
import type { DailyTrendItem } from '../../../api/statistics';

interface Props {
  data: DailyTrendItem[];
  /** 原始 daily_trend 的 YYYY-MM-DD 日期数组，用于 dataZoom 索引映射 */
  rawDates?: string[];
  /** 拖选完成后回调，传入选区起止日期 */
  onBrushSelect?: (startDate: string, endDate: string) => void;
  /** 双击重置回调 */
  onReset?: () => void;
  isMobile?: boolean;
  /** quarter/year 聚合模式下应为 false，禁用 dataZoom */
  enableDataZoom?: boolean;
}

export default function RevenueTrendChart({
  data,
  rawDates,
  onBrushSelect,
  onReset,
  isMobile,
  enableDataZoom = true,
}: Props) {
  const echartsRef = useRef<ReactECharts | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showDataZoom = !isMobile && enableDataZoom && (rawDates?.length ?? 0) >= 2;

  // 组件卸载时清理防抖 timer
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const option = useMemo(
    () => ({
      tooltip: { trigger: 'axis' as const },
      legend: { data: ['每日收入', '诊疗量'], top: 0 },
      xAxis: {
        type: 'category' as const,
        data: data.map((d) => d.date),
      },
      yAxis: [
        { type: 'value' as const, name: '收入(¥)', position: 'left' as const },
        { type: 'value' as const, name: '诊疗量', position: 'right' as const },
      ],
      series: [
        {
          name: '诊疗量',
          type: 'bar',
          yAxisIndex: 1,
          data: data.map((d) => d.record_count),
          itemStyle: { color: 'rgba(24,144,255,0.3)' },
          barMaxWidth: 30,
        },
        {
          name: '每日收入',
          type: 'line',
          yAxisIndex: 0,
          data: data.map((d) => d.revenue),
          itemStyle: { color: '#ff4d4f' },
          smooth: true,
        },
      ],
      dataZoom: showDataZoom
        ? [
            {
              type: 'slider' as const,
              xAxisIndex: 0,
              start: 0,
              end: 100,
              height: 24,
              bottom: 0,
              borderColor: 'transparent',
              backgroundColor: 'rgba(24,144,255,0.05)',
              fillerColor: 'rgba(24,144,255,0.15)',
              handleStyle: { color: '#1890ff' },
              textStyle: { color: '#999' },
            },
            {
              type: 'inside' as const,
              xAxisIndex: 0,
              zoomOnMouseWheel: 'shift' as const,
            },
          ]
        : [],
      grid: { left: 60, right: 60, bottom: showDataZoom ? 56 : 30, top: 40 },
    }),
    [data, showDataZoom],
  );

  const handleDataZoom = useCallback(() => {
    const instance = echartsRef.current?.getEchartsInstance();
    if (!instance || !onBrushSelect || !rawDates?.length) return;
    const opt = instance.getOption() as any;
    const dz = opt.dataZoom?.[0];
    if (!dz || dz.startValue == null || dz.endValue == null) return;
    const startIdx = Math.round(dz.startValue);
    const endIdx = Math.round(dz.endValue);
    if (startIdx === endIdx) return;
    const startDate = rawDates[startIdx];
    const endDate = rawDates[endIdx];
    if (!startDate || !endDate) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onBrushSelect(startDate, endDate), 300);
  }, [onBrushSelect, rawDates]);

  const handleDblClick = useCallback(() => {
    const instance = echartsRef.current?.getEchartsInstance();
    if (!instance) return;
    instance.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
    onReset?.();
  }, [onReset]);

  const onEvents = useMemo(() => {
    if (!showDataZoom) return {};
    const events: Record<string, (...args: any[]) => void> = {};
    if (onBrushSelect && rawDates?.length) {
      events.datazoom = handleDataZoom;
    }
    events.dblclick = handleDblClick;
    return events;
  }, [showDataZoom, onBrushSelect, rawDates, handleDataZoom, handleDblClick]);

  return (
    <Card title="收入趋势 + 诊疗量" size="small">
      <ReactECharts
        ref={echartsRef}
        option={option}
        onEvents={onEvents}
        style={{ height: 300 }}
      />
    </Card>
  );
}
