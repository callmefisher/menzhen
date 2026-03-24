import { useState, useEffect, useCallback, useRef } from 'react';
import { Modal, Button, Spin, message } from 'antd';
import { PrinterOutlined, CheckOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { getNotificationDetail, markDone as apiMarkDone } from '../api/prescriptionNotification';
import type { DispenseDetail as DispenseDetailData, DispenseDetailItem } from '../api/prescriptionNotification';
import useIsMobile from '../hooks/useIsMobile';
import { useAuth } from '../store/auth';
import DispensePrint from './DispensePrint';

interface DispenseDetailProps {
  notificationId: number;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

/* ---------- shared styles ---------- */

const shelfTagStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  minWidth: 32, height: 20, padding: '0 4px',
  background: '#e6f7ff', color: '#1890ff', fontSize: 11, fontWeight: 700,
  borderRadius: 3, border: '1px solid #91d5ff',
};

const patentShelfStyle: React.CSSProperties = {
  ...shelfTagStyle,
  background: '#f9f0ff', color: '#722ed1', border: '1px solid #d3adf7',
};

/* ---------- component ---------- */

export default function DispenseDetail({ notificationId, open, onClose, onDone }: DispenseDetailProps) {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [data, setData] = useState<DispenseDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [markLoading, setMarkLoading] = useState(false);
  const printRef = useRef<{ print: () => void }>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getNotificationDetail(notificationId);
      setData((res as any).data || null);
    } catch { message.error('加载详情失败'); }
    finally { setLoading(false); }
  }, [notificationId]);

  useEffect(() => {
    if (open) fetchDetail();
  }, [open, fetchDetail]);

  const handleMarkDone = async () => {
    setMarkLoading(true);
    try {
      await apiMarkDone(notificationId);
      message.success('已标记完成');
      onDone();
    } catch { message.error('操作失败'); }
    finally { setMarkLoading(false); }
  };

  const handlePrint = () => {
    printRef.current?.print();
  };

  if (!open) return null;

  const noti = data?.notification;
  const herbs = data?.herbs || [];
  const patents = data?.patents || [];
  const isPending = noti?.status === 'pending';
  const totalDoses = noti?.total_doses || 0;

  /* Multi-column split */
  const useHerbCols = herbs.length > 10;
  const herbMid = Math.ceil(herbs.length / 2);
  const herbCol1 = useHerbCols ? herbs.slice(0, herbMid) : herbs;
  const herbCol2 = useHerbCols ? herbs.slice(herbMid) : [];

  const usePatentCols = patents.length > 5;
  const patentMid = Math.ceil(patents.length / 2);
  const patentCol1 = usePatentCols ? patents.slice(0, patentMid) : patents;
  const patentCol2 = usePatentCols ? patents.slice(patentMid) : [];

  /* --- Desktop table renderers --- */
  const renderHerbTable = (items: DispenseDetailItem[]) => (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {['货架', '药物', '单付×总付', '总量'].map(h => (
            <th key={h} style={{
              background: '#f5f3ec', padding: '6px 8px', fontSize: 11,
              fontWeight: 600, color: '#999', textAlign: h === '总量' ? 'right' : 'left',
              borderBottom: '2px solid #e8e5d8', whiteSpace: 'nowrap',
              paddingRight: h === '总量' ? 12 : 8,
            }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => {
          const dosageNum = parseFloat(item.dosage) || 0;
          const total = dosageNum * totalDoses;
          return (
            <tr key={idx} style={{ borderBottom: '1px solid #f5f3ec' }}>
              <td style={{ padding: '5px 8px' }}>
                <span style={shelfTagStyle}>{item.shelf_no || '--'}</span>
              </td>
              <td style={{ padding: '5px 8px', fontSize: 13 }}>
                {item.herb_name}
                {item.notes && (
                  <span style={{
                    fontSize: 10, color: '#d48806', background: '#fffbe6',
                    padding: '0 3px', borderRadius: 2, marginLeft: 2,
                  }}>
                    {item.notes}
                  </span>
                )}
              </td>
              <td style={{ padding: '5px 8px', fontSize: 12, color: '#666', textAlign: 'center', whiteSpace: 'nowrap' }}>
                {item.dosage}g<span style={{ color: '#999', margin: '0 1px' }}>×</span>{totalDoses}
              </td>
              <td style={{
                padding: '5px 8px', paddingRight: 12, fontSize: 13,
                fontWeight: 700, color: '#52c41a', textAlign: 'right', whiteSpace: 'nowrap',
              }}>
                {total}g
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const renderPatentTable = (items: DispenseDetailItem[]) => (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {['货架', '药品', '数量'].map(h => (
            <th key={h} style={{
              background: '#f5f0ff', padding: '6px 8px', fontSize: 11,
              fontWeight: 600, color: '#999', textAlign: h === '数量' ? 'right' : 'left',
              borderBottom: '2px solid #e8d9f7', whiteSpace: 'nowrap',
              paddingRight: h === '数量' ? 12 : 8,
            }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => (
          <tr key={idx} style={{ borderBottom: '1px solid #f5f3ec' }}>
            <td style={{ padding: '5px 8px' }}>
              <span style={patentShelfStyle}>{item.shelf_no || '--'}</span>
            </td>
            <td style={{ padding: '5px 8px', fontSize: 13 }}>{item.herb_name}</td>
            <td style={{
              padding: '5px 8px', paddingRight: 12, fontSize: 14,
              fontWeight: 800, color: '#722ed1', textAlign: 'right',
            }}>
              ×{item.dosage}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  /* --- Mobile compact row renderers --- */
  const renderMobileHerbRow = (item: DispenseDetailItem, idx: number) => {
    const dosageNum = parseFloat(item.dosage) || 0;
    const total = dosageNum * totalDoses;
    return (
      <div key={idx} style={{
        display: 'flex', alignItems: 'baseline', gap: 3,
        padding: '3px 8px', fontSize: 11, borderBottom: '1px dotted #f0ede5', lineHeight: 1.4,
      }}>
        <span style={{ fontWeight: 700, color: '#1890ff', fontSize: 10, minWidth: 18 }}>
          {item.shelf_no || '--'}
        </span>
        <span>{item.herb_name}</span>
        {item.notes && (
          <span style={{ fontSize: 10, color: '#d48806', background: '#fffbe6', padding: '0 3px', borderRadius: 2 }}>
            {item.notes}
          </span>
        )}
        <span style={{ marginLeft: 'auto', color: '#999', fontSize: 10, whiteSpace: 'nowrap' }}>
          {item.dosage}g×{totalDoses}
        </span>
        <span style={{ fontWeight: 700, color: '#52c41a', fontSize: 11, minWidth: 30, textAlign: 'right' }}>
          {total}g
        </span>
      </div>
    );
  };

  const renderMobilePatentRow = (item: DispenseDetailItem, idx: number) => (
    <div key={idx} style={{
      display: 'flex', alignItems: 'baseline', gap: 3,
      padding: '3px 8px', fontSize: 11, borderBottom: '1px dotted #f0ede5', lineHeight: 1.4,
    }}>
      <span style={{ fontWeight: 700, color: '#722ed1', fontSize: 10, minWidth: 22 }}>
        {item.shelf_no || '--'}
      </span>
      <span>{item.herb_name}</span>
      <span style={{ marginLeft: 'auto', fontWeight: 700, color: '#722ed1', fontSize: 11, whiteSpace: 'nowrap' }}>
        ×{item.dosage}
      </span>
    </div>
  );

  /* --- time display --- */
  const formatDateTime = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hh}:${mm}`;
  };

  const patentTotalQty = patents.reduce((sum, p) => {
    const n = parseFloat(p.dosage) || 0;
    return sum + n;
  }, 0);

  return (
    <>
      <Modal
        open={open}
        onCancel={onClose}
        footer={null}
        width={isMobile ? '100%' : 900}
        style={isMobile ? { top: 0, margin: 0, maxWidth: '100%' } : undefined}
        styles={{ body: { padding: 0 } }}
        destroyOnClose
        closable={false}
      >
        {loading || !data ? (
          <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
        ) : (
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            {/* Header */}
            {isMobile ? (
              <div style={{
                background: 'linear-gradient(135deg, #1A2E1A, #2a4a2a)', color: '#fff',
                padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 700, color: '#95DE64',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {noti?.formula_name} <span style={{ color: '#fff', fontWeight: 600, fontSize: 12 }}>{noti?.patient_name}</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.55)', marginTop: 1 }}>
                    {noti?.doctor_name} · {user?.tenant_name || ''} · {formatDateTime(noti?.created_at).split(' ')[1]}
                  </div>
                </div>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  padding: '4px 10px', background: 'rgba(82,196,26,.2)',
                  border: '2px solid #95DE64', borderRadius: 8,
                  fontSize: 16, fontWeight: 800, color: '#95DE64', lineHeight: 1,
                  flexShrink: 0, marginLeft: 8,
                }}>
                  {totalDoses}<small style={{ fontSize: 12, fontWeight: 400, marginLeft: 4, opacity: 0.8 }}>付</small>
                </div>
              </div>
            ) : (
              <div style={{
                background: 'linear-gradient(135deg, #1A2E1A, #2a4a2a)', color: '#fff',
                padding: '18px 22px', display: 'flex', justifyContent: 'space-between',
                alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, borderRadius: '8px 8px 0 0',
              }}>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, color: '#95DE64', margin: 0 }}>
                    {noti?.formula_name}
                  </h2>
                  <div style={{ fontSize: 15, marginTop: 5, color: '#fff', fontWeight: 600 }}>
                    患者：{noti?.patient_name}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 3, color: 'rgba(255,255,255,.55)' }}>
                    医师：{noti?.doctor_name} | {user?.tenant_name || ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    padding: '8px 16px', background: 'rgba(82,196,26,.2)',
                    border: '2px solid #95DE64', borderRadius: 8,
                    fontSize: 24, fontWeight: 800, color: '#95DE64', lineHeight: 1,
                  }}>
                    {totalDoses}<small style={{ fontSize: 12, fontWeight: 400, marginLeft: 4, opacity: 0.8 }}>付</small>
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginTop: 5 }}>
                    {formatDateTime(noti?.created_at)}
                  </div>
                </div>
              </div>
            )}

            {/* Herbs section */}
            {herbs.length > 0 && (
              <div>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: isMobile ? '6px 12px' : '10px 20px',
                  background: '#fafaf5', borderBottom: '1px solid #e8e5d8',
                  fontSize: isMobile ? 11 : 13, fontWeight: 600,
                }}>
                  <span>中药明细</span>
                  <span style={{ fontSize: 11, fontWeight: 400, color: '#999' }}>{herbs.length} 味</span>
                </div>

                {isMobile ? (
                  /* Mobile: compact rows, two columns, no headers */
                  <div style={{ display: 'flex', gap: 0 }}>
                    <div style={{ flex: 1, borderRight: useHerbCols ? '1px solid #e8e5d8' : 'none' }}>
                      {herbCol1.map((item, idx) => renderMobileHerbRow(item, idx))}
                    </div>
                    {useHerbCols && (
                      <div style={{ flex: 1 }}>
                        {herbCol2.map((item, idx) => renderMobileHerbRow(item, idx))}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Desktop: table with headers, two columns */
                  <div style={{ display: 'flex', gap: 0, width: '100%' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {renderHerbTable(herbCol1)}
                    </div>
                    {useHerbCols && (
                      <div style={{ flex: 1, minWidth: 0, borderLeft: '2px solid #e8e5d8' }}>
                        {renderHerbTable(herbCol2)}
                      </div>
                    )}
                  </div>
                )}

                {/* Summary */}
                <div style={{
                  display: 'flex', gap: 16, justifyContent: 'flex-end',
                  padding: isMobile ? '6px 12px' : '10px 20px',
                  background: '#f6ffed', borderTop: '2px solid #b7eb8f', fontSize: 12,
                }}>
                  <div>
                    <span style={{ color: '#999' }}>总付数：</span>
                    <span style={{ fontWeight: 700, color: '#389e0d', fontSize: isMobile ? 12 : 14 }}>
                      {totalDoses} 付
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Patents section */}
            {patents.length > 0 && (
              <div>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: isMobile ? '6px 12px' : '10px 20px',
                  background: '#faf5ff', borderBottom: '1px solid #e8e5d8',
                  fontSize: isMobile ? 11 : 13, fontWeight: 600,
                }}>
                  <span>中成药明细</span>
                  <span style={{ fontSize: 11, fontWeight: 400, color: '#999' }}>{patents.length} 种</span>
                </div>

                {isMobile ? (
                  <div style={{ display: 'flex', gap: 0 }}>
                    <div style={{ flex: 1, borderRight: usePatentCols ? '1px solid #e8e5d8' : 'none' }}>
                      {patentCol1.map((item, idx) => renderMobilePatentRow(item, idx))}
                    </div>
                    {usePatentCols && (
                      <div style={{ flex: 1 }}>
                        {patentCol2.map((item, idx) => renderMobilePatentRow(item, idx))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 0, width: '100%' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {renderPatentTable(patentCol1)}
                    </div>
                    {usePatentCols && (
                      <div style={{ flex: 1, minWidth: 0, borderLeft: '2px solid #e8e5d8' }}>
                        {renderPatentTable(patentCol2)}
                      </div>
                    )}
                  </div>
                )}

                {/* Patent summary */}
                <div style={{
                  display: 'flex', gap: 16, justifyContent: 'flex-end',
                  padding: isMobile ? '6px 12px' : '10px 20px',
                  background: '#faf5ff', borderTop: '2px solid #d3adf7', fontSize: 12,
                }}>
                  <div>
                    <span style={{ color: '#999' }}>合计：</span>
                    <span style={{ fontWeight: 700, color: '#722ed1', fontSize: isMobile ? 12 : 14 }}>
                      {patentTotalQty} 盒
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Notes */}
            {noti?.notes && (
              <div style={{
                padding: isMobile ? '8px 12px' : '12px 20px',
                background: '#fff7e6', borderTop: '2px solid #ffd591',
                fontSize: isMobile ? 11 : 13, color: '#ad6800',
              }}>
                <strong style={{ marginRight: 4 }}>医嘱：</strong>{noti.notes}
              </div>
            )}

            {/* Footer */}
            <div style={{
              display: 'flex', gap: 8, justifyContent: 'flex-end',
              padding: isMobile ? '8px 12px' : '14px 20px',
              borderTop: '1px solid #e8e5d8', flexWrap: 'wrap',
            }}>
              <Button
                onClick={onClose}
                style={{ fontSize: isMobile ? 11 : 13, padding: isMobile ? '5px 10px' : undefined }}
                icon={<ArrowLeftOutlined />}
              >
                返回{!isMobile && '列表'}
              </Button>
              <Button
                onClick={handlePrint}
                style={{ fontSize: isMobile ? 11 : 13, padding: isMobile ? '5px 10px' : undefined }}
                icon={<PrinterOutlined />}
              >
                打印{!isMobile && '抓药单'}
              </Button>
              {isPending && (
                <Button
                  type="primary"
                  loading={markLoading}
                  onClick={handleMarkDone}
                  style={{
                    fontSize: isMobile ? 11 : 13,
                    padding: isMobile ? '5px 10px' : undefined,
                    background: '#52c41a', borderColor: '#52c41a',
                    flex: isMobile ? 1 : undefined,
                  }}
                  icon={<CheckOutlined />}
                >
                  标记已完成
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Hidden print component */}
      {data && (
        <DispensePrint
          ref={printRef}
          detail={data}
          clinicName={user?.tenant_name}
        />
      )}
    </>
  );
}
