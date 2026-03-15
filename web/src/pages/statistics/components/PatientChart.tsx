import ReactECharts from 'echarts-for-react';
import { Card } from 'antd';
import type { DailyTrendItem } from '../../../api/statistics';

interface Props {
  data: DailyTrendItem[];
}

export default function PatientChart({ data }: Props) {
  const option = {
    tooltip: { trigger: 'axis' as const },
    legend: { data: ['新增患者', '复诊患者'], top: 0 },
    xAxis: {
      type: 'category' as const,
      data: data.map((d) => d.date.slice(5)),
    },
    yAxis: { type: 'value' as const, name: '人次' },
    series: [
      {
        name: '新增患者',
        type: 'bar',
        data: data.map((d) => d.new_patient_count),
        itemStyle: { color: '#722ed1' },
        barMaxWidth: 30,
      },
      {
        name: '复诊患者',
        type: 'bar',
        data: data.map((d) => d.returning_patient_count),
        itemStyle: { color: '#eb2f96' },
        barMaxWidth: 30,
      },
    ],
    grid: { left: 50, right: 20, bottom: 30, top: 40 },
  };

  return (
    <Card title="新增 vs 复诊患者" size="small">
      <ReactECharts option={option} style={{ height: 250 }} />
    </Card>
  );
}
