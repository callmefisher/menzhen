import { Row, Col } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import type { DashboardSummary } from '../../../api/statistics';
import useIsMobile from '../../../hooks/useIsMobile';

interface SummaryCardsProps {
  summary: DashboardSummary;
}

interface CardConfig {
  title: string;
  value: string;
  change: number | null;
  gradient: string;
}

function ChangeTag({ value }: { value: number | null }) {
  if (value === null) return <span style={{ fontSize: 12, opacity: 0.7 }}>--</span>;
  const isUp = value >= 0;
  return (
    <span style={{ fontSize: 12, opacity: 0.8 }}>
      {isUp ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
      {' '}{Math.abs(value).toFixed(1)}%
    </span>
  );
}

export default function SummaryCards({ summary }: SummaryCardsProps) {
  const isMobile = useIsMobile();

  const cards: CardConfig[] = [
    {
      title: '总收入',
      value: `¥${summary.total_revenue.toLocaleString()}`,
      change: summary.revenue_change_percent,
      gradient: 'linear-gradient(135deg, #1890ff, #36cfc9)',
    },
    {
      title: '诊疗记录',
      value: String(summary.total_records),
      change: summary.records_change_percent,
      gradient: 'linear-gradient(135deg, #52c41a, #95de64)',
    },
    {
      title: '患者人次',
      value: String(summary.total_patients),
      change: summary.patients_change_percent,
      gradient: 'linear-gradient(135deg, #722ed1, #b37feb)',
    },
  ];

  if (isMobile) {
    return (
      <div>
        <div
          style={{
            background: cards[0].gradient,
            borderRadius: 8,
            padding: '16px 20px',
            color: '#fff',
            marginBottom: 8,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 13, opacity: 0.85 }}>{cards[0].title}</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{cards[0].value}</div>
          </div>
          <ChangeTag value={cards[0].change} />
        </div>
        <Row gutter={8}>
          {cards.slice(1).map((card) => (
            <Col span={12} key={card.title}>
              <div
                style={{
                  background: card.gradient,
                  borderRadius: 8,
                  padding: '12px 14px',
                  color: '#fff',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.85 }}>{card.title}</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{card.value}</div>
                <ChangeTag value={card.change} />
              </div>
            </Col>
          ))}
        </Row>
      </div>
    );
  }

  return (
    <Row gutter={16}>
      {cards.map((card) => (
        <Col span={8} key={card.title}>
          <div
            style={{
              background: card.gradient,
              borderRadius: 8,
              padding: '20px 24px',
              color: '#fff',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: 14, opacity: 0.85 }}>{card.title}</div>
              <div style={{ fontSize: 30, fontWeight: 700 }}>{card.value}</div>
            </div>
            <ChangeTag value={card.change} />
          </div>
        </Col>
      ))}
    </Row>
  );
}
