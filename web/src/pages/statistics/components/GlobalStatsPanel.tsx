import { useState, useEffect, useCallback, useMemo } from 'react';
import { Select, Button, Table, Skeleton, Empty } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getGlobalStats } from '../../../api/statistics';
import type { GlobalStatsData, GlobalTenantItem } from '../../../api/statistics';
import useIsMobile from '../../../hooks/useIsMobile';

type SortKey = 'revenue' | 'records' | 'patients' | 'avg_per_record';

interface Props {
  startDate: string;
  endDate: string;
  onViewDetail: (tenantId: number, tenantName: string) => void;
}

const SORT_LABELS: Record<SortKey, string> = {
  revenue: '收入',
  records: '接诊',
  patients: '患者',
  avg_per_record: '客单价',
};

const RANK_COLORS = ['#faad14', '#8c8c8c', '#d48806'];

function RankBadge({ rank }: { rank: number }) {
  const bg = rank <= 3 ? RANK_COLORS[rank - 1] : '#f5f5f5';
  const color = rank <= 3 ? '#fff' : '#999';
  return (
    <div style={{
      width: 26, height: 26, borderRadius: '50%', background: bg, color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, fontWeight: 700,
    }}>
      {rank}
    </div>
  );
}

function SummaryCards({ data, isMobile }: { data: GlobalStatsData; isMobile: boolean }) {
  const { summary } = data;
  const cards = [
    { label: '平台总收入', value: `¥ ${Math.round(summary.total_revenue).toLocaleString()}`, sub: `${summary.tenant_count} 家诊所累计`, gradient: 'linear-gradient(135deg,#1890ff,#36cfc9)' },
    { label: '总接诊记录', value: String(summary.total_records), sub: '本期全平台', gradient: 'linear-gradient(135deg,#52c41a,#95de64)' },
    { label: '总患者人次', value: String(summary.total_patients), sub: '新患+复诊', gradient: 'linear-gradient(135deg,#722ed1,#b37feb)' },
    { label: '平均客单价', value: `¥ ${summary.avg_revenue_per_record.toFixed(1)}`, sub: '收入÷接诊数', gradient: 'linear-gradient(135deg,#fa8c16,#ffc069)' },
  ];

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        <div style={{ borderRadius: 10, padding: '14px 16px', color: '#fff', background: cards[0].gradient }}>
          <div style={{ fontSize: 12, opacity: 0.88 }}>{cards[0].label}</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{cards[0].value}</div>
          <div style={{ fontSize: 11, opacity: 0.72 }}>{cards[0].sub}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {cards.slice(1, 3).map(c => (
            <div key={c.label} style={{ borderRadius: 10, padding: '12px 14px', color: '#fff', background: c.gradient }}>
              <div style={{ fontSize: 11, opacity: 0.88 }}>{c.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{c.value}</div>
            </div>
          ))}
        </div>
        <div style={{ borderRadius: 10, padding: '14px 16px', color: '#fff', background: cards[3].gradient }}>
          <div style={{ fontSize: 12, opacity: 0.88 }}>{cards[3].label}</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{cards[3].value}</div>
          <div style={{ fontSize: 11, opacity: 0.72 }}>{cards[3].sub}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 14 }}>
      {cards.map(c => (
        <div key={c.label} style={{ borderRadius: 10, padding: '18px 20px', color: '#fff', background: c.gradient, boxShadow: '0 2px 8px rgba(0,0,0,.12)' }}>
          <div style={{ fontSize: 13, opacity: 0.88 }}>{c.label}</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{c.value}</div>
          <div style={{ fontSize: 11, opacity: 0.72, marginTop: 3 }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

export default function GlobalStatsPanel({ startDate, endDate, onViewDetail }: Props) {
  const isMobile = useIsMobile();
  const [data, setData] = useState<GlobalStatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const fetchData = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await getGlobalStats(startDate, endDate, p, pageSize);
      // Support both axios-wrapped ({ data: { code, data } }) and direct ({ code, data })
      const axiosBody = res as unknown as { data: { code: number; data: GlobalStatsData } };
      const directBody = res as unknown as { code: number; data: GlobalStatsData };
      const body = axiosBody.data ?? directBody;
      if (body.code === 0) setData(body.data);
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    setPage(1);
    fetchData(1);
  }, [fetchData]);

  // Local sort (no re-request) when switching dimensions
  const sortedTenants = useMemo(() => {
    if (!data) return [];
    return [...data.tenants].sort((a, b) => b[sortKey] - a[sortKey]);
  }, [data, sortKey]);

  const tenantOptions = useMemo(() =>
    sortedTenants.map(t => ({ value: t.tenant_id, label: t.tenant_name })),
    [sortedTenants],
  );

  // ── Desktop: table columns (must be at top level, not in conditional branch) ──────
  const columns = useMemo<ColumnsType<GlobalTenantItem & { rank: number }>>(() => [
    { title: '排名', dataIndex: 'rank', width: 56, render: (r) => <RankBadge rank={r} /> },
    { title: '诊所名称', dataIndex: 'tenant_name', render: (v) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { title: <span style={{ color: sortKey === 'revenue' ? '#52c41a' : undefined }}>收入 {sortKey === 'revenue' ? '↓' : ''}</span>, dataIndex: 'revenue', align: 'right', render: (v) => <span style={{ color: '#1890ff', fontWeight: 600 }}>¥ {Math.round(v).toLocaleString()}</span> },
    { title: <span style={{ color: sortKey === 'records' ? '#52c41a' : undefined }}>接诊 {sortKey === 'records' ? '↓' : ''}</span>, dataIndex: 'records', align: 'right' },
    { title: <span style={{ color: sortKey === 'patients' ? '#52c41a' : undefined }}>患者 {sortKey === 'patients' ? '↓' : ''}</span>, dataIndex: 'patients', align: 'right' },
    { title: <span style={{ color: sortKey === 'avg_per_record' ? '#52c41a' : undefined }}>客单价 {sortKey === 'avg_per_record' ? '↓' : ''}</span>, dataIndex: 'avg_per_record', align: 'right', render: (v) => `¥ ${v.toFixed(1)}` },
    {
      title: '收入占比', dataIndex: 'revenue_percent', width: 140,
      render: (v) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1, height: 5, background: '#f0f0f0', borderRadius: 3 }}>
            <div style={{ width: `${v}%`, height: 5, background: 'linear-gradient(90deg,#52c41a,#36cfc9)', borderRadius: 3 }} />
          </div>
          <span style={{ fontSize: 11, color: '#999', minWidth: 32 }}>{v.toFixed(1)}%</span>
        </div>
      ),
    },
  ], [sortKey]);

  if (loading && !data) {
    return (
      <div style={{ padding: isMobile ? 0 : 4 }}>
        <Skeleton active paragraph={{ rows: 3 }} style={{ marginBottom: 14 }} />
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  if (!data) return <Empty description="暂无全局统计数据" />;

  const ExpandDetail = ({ item }: { item: GlobalTenantItem }) => (
    <div style={{ padding: '12px 16px', background: '#f6ffed', borderLeft: '3px solid #52c41a', borderRadius: '0 6px 6px 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 8, marginBottom: 10 }}>
        {[
          { label: '总收入', value: `¥ ${Math.round(item.revenue).toLocaleString()}`, color: '#1890ff' },
          { label: '接诊记录', value: String(item.records), color: '#52c41a' },
          { label: '患者人次', value: String(item.patients), color: '#722ed1' },
          { label: '客单价', value: `¥ ${item.avg_per_record.toFixed(1)}`, color: '#fa8c16' },
        ].map(c => (
          <div key={c.label} style={{ background: '#fff', borderRadius: 6, padding: '8px 10px', border: '1px solid #e8e8e8', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>{c.label}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'right' }}>
        <Button size="small" type="primary" onClick={() => onViewDetail(item.tenant_id, item.tenant_name)}>查看完整报表</Button>
      </div>
    </div>
  );

  // ── Mobile: card list ──────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SummaryCards data={data} isMobile={isMobile} />

        {/* Search */}
        <div style={{ background: '#fff', borderRadius: 8, padding: '10px 12px', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>快速查询诊所</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Select
              style={{ flex: 1 }}
              size="small"
              showSearch
              placeholder="选择诊所"
              options={tenantOptions}
              value={selectedTenantId}
              onChange={setSelectedTenantId}
              filterOption={(input, opt) => (opt?.label as string ?? '').includes(input)}
              allowClear
            />
            <Button size="small" type="primary" disabled={!selectedTenantId} onClick={() => selectedTenantId && onViewDetail(selectedTenantId, tenantOptions.find(t => t.value === selectedTenantId)?.label ?? '')}>
              完整报表
            </Button>
          </div>
        </div>

        {/* Ranking */}
        <div style={{ background: '#fff', borderRadius: 8, padding: '10px 12px', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>各诊所排名</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
                <button
                  key={k}
                  onClick={() => setSortKey(k)}
                  style={{
                    padding: '2px 8px', borderRadius: 10, fontSize: 10, cursor: 'pointer',
                    background: sortKey === k ? '#52c41a' : '#fff',
                    color: sortKey === k ? '#fff' : '#666',
                    border: `1px solid ${sortKey === k ? '#52c41a' : '#e8e8e8'}`,
                  }}
                >
                  {SORT_LABELS[k]}
                </button>
              ))}
            </div>
          </div>
          {sortedTenants.map((item, idx) => (
            <div key={item.tenant_id}>
              <div
                onClick={() => setExpandedId(expandedId === item.tenant_id ? null : item.tenant_id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px', borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }}
              >
                <RankBadge rank={idx + 1} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{item.tenant_name}</div>
                  <div style={{ fontSize: 11, color: '#aaa' }}>接诊 {item.records} · 患者 {item.patients} · 客单 ¥{item.avg_per_record.toFixed(1)}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1890ff', flexShrink: 0 }}>¥ {Math.round(item.revenue).toLocaleString()}</div>
              </div>
              {expandedId === item.tenant_id && <ExpandDetail item={item} />}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Desktop: table ─────────────────────────────────────────────────────────
  const tableData = sortedTenants.map((t, i) => ({ ...t, rank: i + 1, key: t.tenant_id }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SummaryCards data={data} isMobile={isMobile} />

      {/* Search bar */}
      <div style={{ background: '#fff', borderRadius: 8, padding: '12px 16px', boxShadow: '0 1px 4px rgba(0,0,0,.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: '#666', fontWeight: 500, whiteSpace: 'nowrap' }}>快速查询诊所：</span>
        <Select
          style={{ minWidth: 280 }}
          showSearch
          placeholder="输入诊所名称搜索"
          options={tenantOptions}
          value={selectedTenantId}
          onChange={setSelectedTenantId}
          filterOption={(input, opt) => (opt?.label as string ?? '').includes(input)}
          allowClear
        />
        <Button type="primary" disabled={!selectedTenantId} onClick={() => {
          if (selectedTenantId) {
            const name = tenantOptions.find(t => t.value === selectedTenantId)?.label ?? '';
            onViewDetail(selectedTenantId, name);
          }
        }}>
          查看完整报表 →
        </Button>
        <span style={{ fontSize: 12, color: '#aaa' }}>将切换到该诊所的数据概览</span>
      </div>

      {/* Ranking table */}
      <div style={{ background: '#fff', borderRadius: 8, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>各诊所排名</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                style={{
                  padding: '4px 12px', borderRadius: 12, fontSize: 12, cursor: 'pointer',
                  background: sortKey === k ? '#52c41a' : '#fff',
                  color: sortKey === k ? '#fff' : '#666',
                  border: `1px solid ${sortKey === k ? '#52c41a' : '#e8e8e8'}`,
                }}
              >
                {SORT_LABELS[k]}排名
              </button>
            ))}
          </div>
        </div>
        <Table
          size="small"
          columns={columns}
          dataSource={tableData}
          rowKey="tenant_id"
          expandable={{
            expandedRowKeys: expandedId ? [expandedId] : [],
            onExpand: (_, record) => setExpandedId(expandedId === record.tenant_id ? null : record.tenant_id),
            expandedRowRender: (record) => <ExpandDetail item={record} />,
            showExpandColumn: false,
          }}
          onRow={(record) => ({
            onClick: () => setExpandedId(expandedId === record.tenant_id ? null : record.tenant_id),
            style: { cursor: 'pointer', background: expandedId === record.tenant_id ? '#f6ffed' : undefined },
          })}
          pagination={{
            current: page,
            pageSize,
            total: data.summary.total,
            onChange: (p) => { setPage(p); fetchData(p); },
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 家诊所`,
          }}
        />
        <div style={{ fontSize: 11, color: '#ccc', textAlign: 'right', marginTop: 4 }}>点击任意行展开摘要 · 切换排名维度不重新请求</div>
      </div>
    </div>
  );
}
