import { useRef, useMemo, useCallback, useEffect, useState } from 'react';
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
  const [showHint, setShowHint] = useState(true);

  const showDataZoom = !isMobile && enableDataZoom && (rawDates?.length ?? 0) >= 2;

  // 组件卸载时清理防抖 timer
  useEffect(() => () => clearTimeout(timerRef.current), []);

  // 操作提示 3 秒后自动消失
  useEffect(() => {
    if (!showDataZoom) return;
    setShowHint(true);
    const t = setTimeout(() => setShowHint(false), 3000);
    return () => clearTimeout(t);
  }, [showDataZoom]);

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
          areaStyle: {
            color: {
              type: 'linear' as const,
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(255,77,79,0.15)' },
                { offset: 1, color: 'rgba(255,77,79,0)' },
              ],
            },
          },
        },
      ],
      dataZoom: showDataZoom
        ? [
            {
              type: 'slider' as const,
              xAxisIndex: 0,
              start: 0,
              end: 100,
              height: 40,
              bottom: 0,
              borderColor: '#1890ff44',
              borderRadius: 6,
              backgroundColor: 'rgba(20,20,40,0.8)',
              fillerColor: 'rgba(24,144,255,0.12)',
              selectedDataBackground: {
                lineStyle: { color: 'rgba(255,77,79,0.6)', width: 1 },
                areaStyle: { color: 'rgba(255,77,79,0.15)' },
              },
              dataBackground: {
                lineStyle: { color: 'rgba(255,77,79,0.3)', width: 1 },
                areaStyle: { color: 'rgba(255,77,79,0.05)' },
              },
              handleIcon: 'path://M-1,0L-1,-20L1,-20L1,0L-1,0M-0.6,-6L0.6,-6M-0.6,-10L0.6,-10M-0.6,-14L0.6,-14',
              handleSize: '120%',
              handleStyle: {
                color: '#1890ff',
                borderColor: '#1890ff',
                shadowBlur: 8,
                shadowColor: 'rgba(24,144,255,0.5)',
                borderWidth: 0,
              },
              moveHandleSize: 4,
              moveHandleStyle: {
                color: '#1890ff66',
              },
              emphasis: {
                handleStyle: {
                  color: '#40a9ff',
                  shadowBlur: 12,
                  shadowColor: 'rgba(24,144,255,0.7)',
                },
                moveHandleStyle: {
                  color: '#1890ff',
                },
              },
              textStyle: { color: '#1890ff' },
              brushSelect: false,
              showDataShadow: true,
              showDetail: true,
            },
            {
              type: 'inside' as const,
              xAxisIndex: 0,
              zoomOnMouseWheel: 'shift' as const,
            },
          ]
        : [],
      grid: { left: 60, right: 60, bottom: showDataZoom ? 64 : 30, top: 40 },
    }),
    [data, showDataZoom],
  );

  const handleDataZoom = useCallback(() => {
    const instance = echartsRef.current?.getEchartsInstance();
    if (!instance || !onBrushSelect || !rawDates?.length) return;
    const opt = instance.getOption() as any;
    const dz = opt.dataZoom?.[0];
    if (!dz) return;
    // 使用百分比 start/end 计算索引（startValue/endValue 在百分比模式下可能不存在）
    const len = rawDates.length;
    const startIdx = Math.round((dz.start / 100) * (len - 1));
    const endIdx = Math.round((dz.end / 100) * (len - 1));
    if (startIdx === endIdx) return;
    const startDate = rawDates[Math.max(0, Math.min(startIdx, len - 1))];
    const endDate = rawDates[Math.max(0, Math.min(endIdx, len - 1))];
    if (!startDate || !endDate) return;
    // 隐藏提示
    setShowHint(false);
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
      <div style={{ position: 'relative' }}>
        <ReactECharts
          ref={echartsRef}
          option={option}
          onEvents={onEvents}
          style={{ height: showDataZoom ? 340 : 300 }}
        />
        {showDataZoom && showHint && (
          <div
            style={{
              position: 'absolute',
              bottom: 44,
              left: 0,
              right: 0,
              textAlign: 'center',
              fontSize: 12,
              color: '#1890ff',
              pointerEvents: 'none',
              opacity: 0.8,
              animation: 'fadeInOut 3s ease-in-out forwards',
            }}
          >
            ↔ 拖动下方滑块选择时间范围 · 双击图表重置
          </div>
        )}
      </div>
      {showDataZoom && (
        <style>{`
          @keyframes fadeInOut {
            0% { opacity: 0; }
            15% { opacity: 0.8; }
            75% { opacity: 0.8; }
            100% { opacity: 0; }
          }
        `}</style>
      )}
    </Card>
  );
}
