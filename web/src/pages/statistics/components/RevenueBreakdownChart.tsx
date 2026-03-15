import ReactECharts from 'echarts-for-react';
import { Card } from 'antd';
import type { DailyTrendItem } from '../../../api/statistics';

interface Props {
  data: DailyTrendItem[];
}

export default function RevenueBreakdownChart({ data }: Props) {
  const option = {
    tooltip: { trigger: 'axis' as const },
    legend: { data: ['诊金', '药费'], top: 0 },
    xAxis: {
      type: 'category' as const,
      data: data.map((d) => d.date.slice(5)),
    },
    yAxis: { type: 'value' as const, name: '金额(¥)' },
    series: [
      {
        name: '诊金',
        type: 'bar',
        stack: 'revenue',
        data: data.map((d) => d.consultation_fee),
        itemStyle: { color: '#1890ff' },
        barMaxWidth: 30,
      },
      {
        name: '药费',
        type: 'bar',
        stack: 'revenue',
        data: data.map((d) => d.drug_fee),
        itemStyle: { color: '#52c41a' },
        barMaxWidth: 30,
      },
    ],
    grid: { left: 60, right: 20, bottom: 30, top: 40 },
  };

  return (
    <Card title="诊金 vs 药费" size="small">
      <ReactECharts option={option} style={{ height: 250 }} />
    </Card>
  );
}
