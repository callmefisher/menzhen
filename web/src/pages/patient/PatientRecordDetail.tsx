import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Spin } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { getRecord } from '../../api/patientPortal';

interface PrescriptionItem {
  herb_name: string;
  dosage: string;
  category: string; // 'herb' | 'patent'
  notes: string;
}
interface Prescription {
  id: number;
  formula_name: string;
  total_doses: number;
  notes: string;
  items: PrescriptionItem[];
}
interface RecordDetail {
  record: {
    id: number;
    visit_date: string;
    diagnosis: string;
    treatment: string;
    chief_complaint: string;
    notes: string;
  };
  prescriptions: Prescription[];
}

function formatDate(dateStr: string): string {
  const parts = dateStr?.slice(0, 10).split('-');
  if (!parts || parts.length < 3) return dateStr ?? '';
  return `${parts[0]}年${parts[1]}月${parts[2]}日`;
}

function SectionBlock({ title, children, isLast }: { title: string; children: React.ReactNode; isLast: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
      {/* Timeline column */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20, flexShrink: 0 }}>
        <div style={{
          width: 14, height: 14, borderRadius: '50%', background: '#52C41A',
          border: '2.5px solid #fff', boxShadow: '0 0 0 3px #d9f7be',
          flexShrink: 0, marginTop: 2,
        }} />
        {!isLast && <div style={{ flex: 1, width: 2, background: '#d9f7be', marginTop: 4 }} />}
      </div>
      {/* Content */}
      <div style={{ flex: 1, paddingBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#389E0D', marginBottom: 10 }}>
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}

function InfoCard({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,.05)', overflow: 'hidden' }}>
      {rows.map((r) => (
        <div key={r.label} style={{
          display: 'flex', alignItems: 'flex-start', padding: '10px 14px',
          borderBottom: '1px solid #fafafa',
        }}>
          <span style={{ width: 40, color: '#bbb', fontSize: 13, flexShrink: 0 }}>{r.label}</span>
          <span style={{ fontSize: 13, color: '#333', flex: 1, lineHeight: 1.6 }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function PrescriptionCard({ p, index }: { p: Prescription; index: number }) {
  const items = p.items ?? [];
  const herbItems = items.filter((it) => !it.category || it.category === 'herb');
  const patentItems = items.filter((it) => it.category === 'patent');

  const hasHerb = herbItems.length > 0;
  const hasPatent = patentItems.length > 0;
  const title = hasHerb && hasPatent ? `处方 ${index} · 草药 + 中成药` : hasPatent ? `处方 ${index} · 中成药` : `处方 ${index} · 草药`;

  return (
    <SectionBlock title={title} isLast={false}>
      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,.05)', overflow: 'hidden' }}>
        {/* Prescription header */}
        {(p.formula_name || p.total_doses > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 8px' }}>
            {p.formula_name && (
              <span style={{ fontSize: 13, fontWeight: 700, color: '#222', flex: 1 }}>{p.formula_name}</span>
            )}
            {p.total_doses > 0 && (
              <span style={{ fontSize: 11, background: '#f6ffed', color: '#52C41A', border: '1px solid #b7eb8f', borderRadius: 10, padding: '2px 8px', flexShrink: 0 }}>
                共 {p.total_doses} 付
              </span>
            )}
          </div>
        )}

        {/* Herb items — tag cloud */}
        {hasHerb && (
          <div style={{ padding: '6px 14px 10px', borderTop: '1px solid #fafafa' }}>
            <div style={{ fontSize: 11, color: '#bbb', marginBottom: 6 }}>草药</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {herbItems.map((item, i) => (
                <span key={i} style={{
                  background: '#f6ffed', border: '1px solid #d9f7be',
                  borderRadius: 20, padding: '4px 10px',
                  fontSize: 12, color: '#389E0D',
                }}>
                  {item.herb_name} {item.dosage}g
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Patent medicine items — list */}
        {hasPatent && (
          <div style={{ borderTop: '1px solid #fafafa' }}>
            <div style={{ fontSize: 11, color: '#bbb', padding: '8px 14px 4px' }}>中成药</div>
            {patentItems.map((item, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 14px',
                borderTop: i > 0 ? '1px solid #fafafa' : 'none',
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                  background: 'linear-gradient(135deg, #fff3cd, #ffe58f)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                }}>💊</div>
                <span style={{ fontSize: 13, color: '#333', flex: 1, fontWeight: 500 }}>{item.herb_name}</span>
                <span style={{ fontSize: 12, color: '#fa8c16', background: '#fff7e6', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                  × {item.dosage}盒
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Usage notes */}
        {p.notes && (
          <div style={{
            fontSize: 12, color: '#888', background: '#f9fff6',
            padding: '8px 14px', borderTop: '1px solid #fafafa',
            display: 'flex', alignItems: 'flex-start', gap: 6,
          }}>
            <span>📋</span>
            <span>{p.notes}</span>
          </div>
        )}

        {!hasHerb && !hasPatent && (
          <div style={{ padding: '10px 14px', fontSize: 13, color: '#bbb' }}>暂无药材信息</div>
        )}
      </div>
    </SectionBlock>
  );
}

export default function PatientRecordDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<RecordDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;
    getRecord(Number(id))
      .then((res: unknown) => setData((res as { data: RecordDetail }).data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;
  if (error) return <div style={{ padding: 20, color: '#ff4d4f' }}>加载失败，请稍后重试</div>;
  if (!data) return <div style={{ padding: 20, color: '#888' }}>记录不存在</div>;

  const { record, prescriptions } = data;
  const safePresc = prescriptions ?? [];

  const infoRows = [
    record.chief_complaint ? { label: '主诉', value: record.chief_complaint } : null,
    record.treatment ? { label: '治法', value: record.treatment } : null,
    record.notes ? { label: '备注', value: record.notes } : null,
  ].filter((r): r is { label: string; value: string } => r !== null);

  const totalSections = (infoRows.length > 0 ? 1 : 0) + safePresc.length;

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fc' }}>
      {/* Banner */}
      <div style={{
        background: 'linear-gradient(160deg, #389E0D 0%, #52C41A 55%, #73d13d 100%)',
        padding: '44px 18px 28px',
        position: 'relative',
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            position: 'absolute', top: 14, left: 14,
            background: 'rgba(255,255,255,.18)', border: 'none', borderRadius: 10,
            color: '#fff', fontSize: 18, width: 36, height: 36,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <ArrowLeftOutlined />
        </button>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.7)', marginBottom: 4 }}>
          {formatDate(record.visit_date)}就诊
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 8 }}>
          {record.diagnosis || '就诊记录'}
        </div>
        <span style={{
          display: 'inline-block', background: 'rgba(255,255,255,.22)',
          color: '#fff', fontSize: 11, padding: '3px 12px', borderRadius: 14,
        }}>就诊记录</span>
      </div>

      {/* Body */}
      <div style={{ padding: '20px 16px' }}>
        {/* Visit info section */}
        {infoRows.length > 0 && (
          <SectionBlock title="就诊信息" isLast={totalSections === 1}>
            <InfoCard rows={infoRows} />
          </SectionBlock>
        )}

        {/* Prescriptions */}
        {safePresc.map((p, idx) => (
          <PrescriptionCard key={p.id} p={p} index={idx + 1} />
        ))}

        {totalSections === 0 && (
          <div style={{ textAlign: 'center', color: '#bbb', paddingTop: 40 }}>暂无详细记录</div>
        )}
      </div>
    </div>
  );
}
