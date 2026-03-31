import { useState, useEffect, useCallback } from 'react';
import { Row, Col, Spin, Empty, message } from 'antd';
import { getStaffRevenue } from '../../../api/statistics';
import type { StaffRevenueData, StaffRevenueItem } from '../../../api/statistics';
import useIsMobile from '../../../hooks/useIsMobile';

interface Props {
  startDate: string;
  endDate: string;
}

const RANK_COLORS = ['#f59e0b', '#94a3b8', '#c97c34'];

function RankBadge({ rank }: { rank: number }) {
  const bg = rank <= 3 ? RANK_COLORS[rank - 1] : '#374151';
  const color = rank <= 3 ? '#000' : '#9ca3af';
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        background: bg,
        color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        fontWeight: 800,
        flexShrink: 0,
      }}
    >
      {rank}
    </div>
  );
}

function StaffCard({
  item,
  rank,
  maxRevenue,
  isMobile,
}: {
  item: StaffRevenueItem;
  rank: number;
  maxRevenue: number;
  isMobile: boolean;
}) {
  const barWidth = maxRevenue > 0 ? (item.revenue / maxRevenue) * 100 : 0;
  const consultPct = item.revenue > 0 ? (item.consultation_fee / item.revenue) * 100 : 0;
  const drugPct = item.revenue > 0 ? (item.drug_fee / item.revenue) * 100 : 0;

  return (
    <div
      style={{
        background: '#0f1117',
        borderRadius: 12,
        padding: isMobile ? '12px 14px' : '14px 16px',
        marginBottom: 8,
      }}
    >
      {/* Top row: rank + name + revenue */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <RankBadge rank={rank} />
        <span style={{ fontSize: isMobile ? 14 : 15, fontWeight: 700, color: '#fff', flex: 1 }}>
          {item.real_name || `用户${item.user_id}`}
        </span>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: isMobile ? 17 : 19, fontWeight: 800, color: '#4ade80' }}>
            ¥{item.revenue.toLocaleString()}
          </span>
          <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 6 }}>
            {item.revenue_percent.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Progress bar: relative width based on max + dual color split */}
      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            background: '#1e2433',
            borderRadius: 6,
            height: 8,
            overflow: 'hidden',
            display: 'flex',
            width: `${barWidth}%`,
            minWidth: barWidth > 0 ? 8 : 0,
          }}
        >
          <div
            style={{
              height: 8,
              background: 'linear-gradient(90deg,#4f8ef7,#36cfc9)',
              width: `${consultPct}%`,
            }}
          />
          <div
            style={{
              height: 8,
              background: 'linear-gradient(90deg,#f59e0b,#fbbf24)',
              width: `${drugPct}%`,
            }}
          />
        </div>
      </div>

      {/* Stats grid */}
      {isMobile ? (
        <div style={{ display: 'flex' }}>
          {[
            { label: '诊次', value: String(item.record_count) },
            { label: '诊金', value: `¥${item.consultation_fee.toLocaleString()}`, color: '#4f8ef7' },
            { label: '药费', value: `¥${item.drug_fee.toLocaleString()}`, color: '#f59e0b' },
            { label: '占比', value: `${item.revenue_percent.toFixed(1)}%` },
          ].map((s, i, arr) => (
            <div
              key={s.label}
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '4px 0',
                borderRight: i < arr.length - 1 ? '1px solid #2d3748' : undefined,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: s.color ?? '#cbd5e1' }}>{s.value}</div>
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          {[
            { label: '诊次', value: String(item.record_count) },
            { label: '诊金', value: `¥${item.consultation_fee.toLocaleString()}`, color: '#4f8ef7' },
            { label: '药费', value: `¥${item.drug_fee.toLocaleString()}`, color: '#f59e0b' },
            { label: '人均费用', value: `¥${item.avg_per_record.toLocaleString()}` },
            { label: '收入占比', value: `${item.revenue_percent.toFixed(1)}%` },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                background: '#1a2236',
                borderRadius: 6,
                padding: '6px 4px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: s.color ?? '#e2e8f0' }}>{s.value}</div>
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StaffRevenuePanel({ startDate, endDate }: Props) {
  const isMobile = useIsMobile();
  const [data, setData] = useState<StaffRevenueData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getStaffRevenue(startDate, endDate);
      const body = res as unknown as { code: number; data: StaffRevenueData };
      setData(body.data);
    } catch {
      void message.error('获取人员收费数据失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const maxRevenue = data?.staff[0]?.revenue ?? 0;

  const summaryItems = data
    ? [
        { label: '团队总收入', value: `¥${data.summary.total_revenue.toLocaleString()}`, color: '#4ade80' },
        { label: '总诊次', value: String(data.summary.total_records), color: '#4f8ef7' },
        { label: '参与医生', value: `${data.summary.staff_count}人`, color: '#f59e0b' },
        { label: '人均诊次费用', value: `¥${data.summary.avg_per_record.toLocaleString()}`, color: '#a78bfa' },
      ]
    : [];

  return (
    <Spin spinning={loading}>
      {data && data.staff.length > 0 ? (
        <div>
          {/* Summary strip */}
          <Row gutter={[8, 8]} style={{ marginBottom: 16 }}>
            {summaryItems.map((s) => (
              <Col span={isMobile ? 12 : 6} key={s.label}>
                <div
                  style={{
                    background: '#141820',
                    borderRadius: 10,
                    padding: isMobile ? '10px 12px' : '12px 16px',
                  }}
                >
                  <div style={{ fontSize: isMobile ? 18 : 20, fontWeight: 800, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>{s.label}</div>
                </div>
              </Col>
            ))}
          </Row>

          {/* Bar legend */}
          <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#6b7280' }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: '#4f8ef7' }} />
              诊金
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#6b7280' }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: '#f59e0b' }} />
              药费
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 11, color: '#374151' }}>
              进度条宽度 = 与第1名收入的比例
            </div>
          </div>

          {/* Rank cards — all staff, no limit */}
          {data.staff.map((item, idx) => (
            <StaffCard
              key={item.user_id}
              item={item}
              rank={idx + 1}
              maxRevenue={maxRevenue}
              isMobile={isMobile}
            />
          ))}
        </div>
      ) : (
        !loading && <Empty description="暂无人员收费数据" />
      )}
    </Spin>
  );
}
