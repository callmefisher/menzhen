import { useState, useEffect, useCallback } from 'react';
import { Badge, Button, Spin, message } from 'antd';
import { CheckOutlined, DownOutlined, RightOutlined } from '@ant-design/icons';
import {
  listNotifications,
  markDone as apiMarkDone,
  batchMarkDone,
  getPendingCount,
} from '../api/prescriptionNotification';
import type { PrescriptionNotificationItem } from '../api/prescriptionNotification';
import { useWebSocket } from '../hooks/useWebSocket';
import useIsMobile from '../hooks/useIsMobile';
import DispenseDetail from './DispenseDetail';

/* ---------- helpers ---------- */

function formatTime(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return hh + ':' + mm;
}

function isToday(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function categoryTag(herbCount: number, patentCount: number) {
  if (herbCount > 0 && patentCount > 0) return { label: '中药+中成药', color: 'mixed' as const };
  if (patentCount > 0) return { label: '中成药', color: 'patent' as const };
  return { label: '中药', color: 'herb' as const };
}

const tagStyles: Record<string, React.CSSProperties> = {
  herb: { background: '#f6ffed', color: '#389e0d', border: '1px solid #b7eb8f' },
  patent: { background: '#f9f0ff', color: '#722ed1', border: '1px solid #d3adf7' },
  mixed: { background: '#fff7e6', color: '#d48806', border: '1px solid #ffd591' },
};

/* ---------- component ---------- */

export default function DispenseNotification() {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(true);
  const [tab, setTab] = useState<'pending' | 'done'>('pending');
  const [items, setItems] = useState<PrescriptionNotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);

  /* --- data fetching --- */

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listNotifications(tab);
      const list: PrescriptionNotificationItem[] = (res as any).data?.list || (res as any).data || [];
      setItems(list);
    } catch { /* interceptor */ }
    finally { setLoading(false); }
  }, [tab]);

  const fetchCount = useCallback(async () => {
    try {
      const res = await getPendingCount();
      const count = (res as any).data?.count ?? 0;
      setPendingCount(count);
    } catch { /* ignore */ }
  }, []);

  const fullRefetch = useCallback(async () => {
    await Promise.all([fetchList(), fetchCount()]);
  }, [fetchList, fetchCount]);

  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => { fetchCount(); }, [fetchCount]);

  /* --- WebSocket --- */

  useWebSocket('rx_notify', useCallback((msg) => {
    const item = msg.payload as PrescriptionNotificationItem;
    if (tab === 'pending') {
      setItems(prev => [item, ...prev]);
    }
    setPendingCount(c => c + 1);
  }, [tab]));

  useWebSocket('rx_done', useCallback((msg) => {
    const id = msg.payload?.id as number;
    if (tab === 'pending') {
      setItems(prev => prev.filter(i => i.id !== id));
    } else {
      fetchList();
    }
    setPendingCount(c => Math.max(0, c - 1));
  }, [tab, fetchList]));

  useWebSocket('_reconnect', useCallback(() => {
    fullRefetch();
  }, [fullRefetch]));

  /* --- actions --- */

  const handleMarkDone = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiMarkDone(id);
      message.success('已标记完成');
      setItems(prev => prev.filter(i => i.id !== id));
      setPendingCount(c => Math.max(0, c - 1));
    } catch { message.error('操作失败'); }
  };

  const handleBatchDone = async () => {
    if (items.length === 0) return;
    setBatchLoading(true);
    try {
      await batchMarkDone();
      message.success('已全部标记完成');
      setItems([]);
      setPendingCount(0);
    } catch { message.error('操作失败'); }
    finally { setBatchLoading(false); }
  };

  const handleDetailDone = useCallback(() => {
    setDetailId(null);
    fetchList();
    fetchCount();
  }, [fetchList, fetchCount]);

  /* --- render --- */

  // We fetch by tab from API, so items already reflect the active tab
  const visibleItems = items;

  return (
    <>
      <div style={{
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,.08)',
        border: '1px solid #e8e5d8',
        marginBottom: 16,
        overflow: 'hidden',
      }}>
        {/* Collapsible header */}
        <div
          onClick={() => setExpanded(!expanded)}
          style={{
            padding: isMobile ? '10px 14px' : '14px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
            userSelect: 'none',
            borderBottom: expanded ? '1px solid #e8e5d8' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: isMobile ? 14 : 15 }}>
              处方通知
            </span>
            <Badge count={pendingCount} overflowCount={99} size="small" />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#52c41a' }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%', background: '#52c41a',
                animation: 'live-blink 1.5s ease-in-out infinite',
              }} />
              {isMobile ? '实时' : 'WebSocket'}
            </span>
          </div>
          {expanded
            ? <DownOutlined style={{ color: '#999', fontSize: 12 }} />
            : <RightOutlined style={{ color: '#999', fontSize: 12 }} />}
        </div>

        {expanded && (
          <div>
            {/* Tab bar */}
            <div style={{
              display: 'flex', gap: isMobile ? 5 : 8, alignItems: 'center',
              padding: isMobile ? '8px 14px' : '10px 20px',
              background: '#fafaf5', borderBottom: '1px solid #e8e5d8',
              flexWrap: 'wrap',
            }}>
              <div style={{ display: 'flex', gap: 4, flex: isMobile ? 1 : undefined }}>
                <button
                  onClick={() => setTab('pending')}
                  style={{
                    flex: isMobile ? 1 : undefined, textAlign: 'center',
                    padding: '4px 12px', border: '1px solid #e8e5d8', borderRadius: 4,
                    cursor: 'pointer', fontSize: 13, transition: 'all .2s',
                    background: tab === 'pending' ? '#52c41a' : 'transparent',
                    borderColor: tab === 'pending' ? '#52c41a' : '#e8e5d8',
                    color: tab === 'pending' ? '#fff' : '#666',
                  }}
                >
                  待抓药{tab === 'pending' && pendingCount > 0 && (
                    <span style={{ color: tab === 'pending' ? '#fff' : '#ff4d4f', fontWeight: 700, marginLeft: 4 }}>
                      {pendingCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setTab('done')}
                  style={{
                    flex: isMobile ? 1 : undefined, textAlign: 'center',
                    padding: '4px 12px', border: '1px solid #e8e5d8', borderRadius: 4,
                    cursor: 'pointer', fontSize: 13, transition: 'all .2s',
                    background: tab === 'done' ? '#52c41a' : 'transparent',
                    borderColor: tab === 'done' ? '#52c41a' : '#e8e5d8',
                    color: tab === 'done' ? '#fff' : '#666',
                  }}
                >
                  已完成
                </button>
              </div>
              {tab === 'pending' && (
                <Button
                  size="small"
                  loading={batchLoading}
                  onClick={handleBatchDone}
                  style={{ fontSize: isMobile ? 10 : 12, whiteSpace: 'nowrap' }}
                >
                  {isMobile ? '全部完成' : '全部标记已抓药'}
                </Button>
              )}
            </div>

            {/* List */}
            {loading ? (
              <div style={{ textAlign: 'center', padding: 24 }}><Spin size="small" /></div>
            ) : visibleItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: '#999', fontSize: 13 }}>
                {tab === 'pending' ? '暂无待抓药处方' : '暂无已完成记录'}
              </div>
            ) : (
              visibleItems.map(item => {
                const cat = categoryTag(item.herb_count, item.patent_count);
                const isPending = item.status === 'pending';
                return (
                  <div
                    key={item.id}
                    onClick={() => setDetailId(item.id)}
                    style={{
                      display: 'flex', gap: isMobile ? 10 : 14,
                      padding: isMobile ? '12px 14px' : '14px 20px',
                      borderBottom: '1px solid #f5f3ec',
                      cursor: 'pointer', transition: 'background .2s',
                      background: isPending ? '#fffbe6' : 'transparent',
                      opacity: isPending ? 1 : 0.55,
                      position: 'relative',
                      flexDirection: isMobile ? 'column' : 'row',
                    }}
                  >
                    {/* Unread dot */}
                    {isPending && (
                      <span style={{
                        position: 'absolute', left: isMobile ? 5 : 8, top: '50%',
                        transform: 'translateY(-50%)', width: 6, height: 6,
                        borderRadius: '50%', background: '#ff4d4f',
                      }} />
                    )}

                    {/* Time */}
                    {!isMobile && (
                      <div style={{ flexShrink: 0, width: 56, textAlign: 'center', paddingTop: 2 }}>
                        <div style={{ fontSize: 18, fontWeight: 700 }}>{formatTime(item.created_at)}</div>
                        <div style={{ fontSize: 10, color: '#999' }}>
                          {isToday(item.created_at) ? '今天' : new Date(item.created_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                        </div>
                      </div>
                    )}

                    {/* Body */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 14, fontWeight: 600, marginBottom: 3,
                        display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                        textDecoration: isPending ? 'none' : 'line-through',
                      }}>
                        <span style={{ fontWeight: 700, color: '#1890ff', opacity: isPending ? 1 : 0.6 }}>
                          {item.patient_name}
                        </span>
                        <span>{item.formula_name}</span>
                        <span style={{
                          display: 'inline-block', padding: '1px 7px', borderRadius: 3,
                          fontSize: 10, fontWeight: 500, ...tagStyles[cat.color],
                        }}>
                          {cat.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#999', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <span>{item.doctor_name} 医师</span>
                        {isMobile && <span>{formatTime(item.created_at)}</span>}
                        <span>
                          {item.total_doses > 0 && `${item.total_doses}付`}
                          {item.herb_count > 0 && ` · ${item.herb_count}味中药`}
                          {item.patent_count > 0 && ` · ${item.patent_count}种中成药`}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{
                      flexShrink: 0, display: 'flex',
                      flexDirection: isMobile ? 'row' : 'column',
                      gap: 5, alignItems: isMobile ? 'center' : 'flex-end',
                      justifyContent: 'center',
                    }}>
                      {isPending ? (
                        <button
                          onClick={(e) => handleMarkDone(item.id, e)}
                          style={{
                            padding: '4px 10px', border: '1px solid #faad14',
                            background: '#fffbe6', borderRadius: 4, cursor: 'pointer',
                            fontSize: 12, color: '#d48806', whiteSpace: 'nowrap',
                            transition: 'all .15s',
                          }}
                        >
                          未抓药
                        </button>
                      ) : (
                        <span style={{
                          padding: '4px 10px', border: '1px solid #52c41a',
                          background: '#f6ffed', borderRadius: 4, fontSize: 12,
                          color: '#52c41a', whiteSpace: 'nowrap',
                        }}>
                          已抓药 <CheckOutlined />
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {detailId !== null && (
        <DispenseDetail
          notificationId={detailId}
          open={true}
          onClose={() => setDetailId(null)}
          onDone={handleDetailDone}
        />
      )}

      {/* Global keyframe for live indicator */}
      <style>{`
        @keyframes live-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </>
  );
}
