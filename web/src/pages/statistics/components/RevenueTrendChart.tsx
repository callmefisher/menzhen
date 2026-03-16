import ReactECharts from 'echarts-for-react';
import { Card } from 'antd';
import type { DailyTrendItem } from '../../../api/statistics';

interface Props {
  data: DailyTrendItem[];
}

export default function RevenueTrendChart({ data }: Props) {
  const option = {
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
    grid: { left: 60, right: 60, bottom: 30, top: 40 },
  };

  return (
    <Card title="收入趋势 + 诊疗量" size="small">
      <ReactECharts option={option} style={{ height: 300 }} />
    </Card>
  );
}
