import { useState, useImperativeHandle, forwardRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { DispenseDetail, DispenseDetailItem } from '../api/prescriptionNotification';

export interface DispensePrintHandle {
  print: () => void;
}

interface DispensePrintProps {
  detail: DispenseDetail;
  clinicName?: string;
  operatorName?: string;
}

function getCurrentBeijingTime(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/* Inject global @media print style once */
const PRINT_STYLE_ID = 'dispense-print-style';
function ensurePrintStyle() {
  if (document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = `
    @media print {
      body > *:not(.dispense-print-portal) { display: none !important; }
      .dispense-print-portal { display: block !important; }
    }
  `;
  document.head.appendChild(style);
}

const DispensePrint = forwardRef<DispensePrintHandle, DispensePrintProps>(
  ({ detail, clinicName, operatorName }, ref) => {
    const [printing, setPrinting] = useState(false);
    const [timeStr, setTimeStr] = useState('');

    useEffect(() => {
      ensurePrintStyle();
    }, []);

    /* Listen for afterprint to hide the portal */
    useEffect(() => {
      if (!printing) return;
      const onAfterPrint = () => setPrinting(false);
      window.addEventListener('afterprint', onAfterPrint);
      return () => window.removeEventListener('afterprint', onAfterPrint);
    }, [printing]);

    useImperativeHandle(ref, () => ({
      print: () => {
        setTimeStr(getCurrentBeijingTime());
        setPrinting(true);
        /* Delay to allow React render, then trigger print */
        setTimeout(() => window.print(), 100);
      },
    }));

    const noti = detail.notification;
    const herbs = detail.herbs || [];
    const patents = detail.patents || [];
    const totalDoses = noti.total_doses || 0;

    /* Split herbs into 2 columns */
    const herbMid = Math.ceil(herbs.length / 2);
    const herbCol1 = herbs.slice(0, herbMid);
    const herbCol2 = herbs.slice(herbMid);

    /* Split patents into 2 columns */
    const patentMid = Math.ceil(patents.length / 2);
    const patentCol1 = patents.slice(0, patentMid);
    const patentCol2 = patents.slice(patentMid);

    const totalQty = patents.reduce((s, p) => s + (parseFloat(p.dosage) || 0), 0);

    const renderHerbRow = (item: DispenseDetailItem, idx: number) => {
      const dosageNum = parseFloat(item.dosage) || 0;
      const total = dosageNum * totalDoses;
      const nameDisplay = item.notes ? `${item.herb_name}(${item.notes})` : item.herb_name;
      return (
        <tr key={idx} style={{ borderBottom: '1px dotted #eee' }}>
          <td style={S.shelf}>{item.shelf_no || '--'}</td>
          <td style={S.name}>{nameDisplay}</td>
          <td style={S.calc}>{item.dosage}g×{totalDoses}</td>
          <td style={S.total}>{total}g</td>
        </tr>
      );
    };

    const renderPatentRow = (item: DispenseDetailItem, idx: number) => (
      <tr key={idx} style={{ borderBottom: '1px dotted #eee' }}>
        <td style={S.shelf}>{item.shelf_no || '--'}</td>
        <td style={S.pName}>{item.herb_name}</td>
        <td style={S.pQty}>×{item.dosage}</td>
      </tr>
    );

    const printContent = (
      <div className="dispense-print-portal" style={{ display: printing ? 'block' : 'none' }}>
        <div style={S.page}>
          {/* Header */}
          {clinicName && <div style={S.clinic}>{clinicName}</div>}
          <div style={S.title}>抓 药 单</div>

          {/* Info */}
          <div style={S.info}>
            <span><span style={S.label}>患者：</span><b>{noti.patient_name}</b></span>
            <span><span style={S.label}>医师：</span><b>{noti.doctor_name}</b></span>
            <span><span style={S.label}>方剂：</span><b>{noti.formula_name}</b></span>
            {totalDoses > 0 && <span><span style={S.label}>总付数：</span><b style={{ fontSize: 15, color: '#d4380d' }}>{totalDoses} 付</b></span>}
          </div>

          {/* Herbs */}
          {herbs.length > 0 && (
            <>
              <div style={S.sectionTitle}>中药明细（{herbs.length}味）</div>
              <div style={S.multiCol}>
                <div style={S.col}>
                  <table style={S.table}><tbody>{herbCol1.map(renderHerbRow)}</tbody></table>
                </div>
                {herbCol2.length > 0 && (
                  <div style={{ ...S.col, borderLeft: '1px dashed #ccc' }}>
                    <table style={S.table}><tbody>{herbCol2.map(renderHerbRow)}</tbody></table>
                  </div>
                )}
              </div>
              <div style={S.summary}>总付数：{totalDoses} 付</div>
            </>
          )}

          {/* Patents */}
          {patents.length > 0 && (
            <>
              <div style={S.sectionTitle}>中成药明细（{patents.length}种）</div>
              <div style={S.multiCol}>
                <div style={S.col}>
                  <table style={S.table}><tbody>{patentCol1.map(renderPatentRow)}</tbody></table>
                </div>
                {patentCol2.length > 0 && (
                  <div style={{ ...S.col, borderLeft: '1px dashed #ccc' }}>
                    <table style={S.table}><tbody>{patentCol2.map(renderPatentRow)}</tbody></table>
                  </div>
                )}
              </div>
              <div style={S.summary}>合计：{totalQty} 盒</div>
            </>
          )}

          {/* Notes */}
          {noti.notes && (
            <div style={S.notes}><strong>医嘱：</strong>{noti.notes}</div>
          )}

          {/* Footer */}
          <div style={S.footer}>
            <span>核对人：{operatorName || '__________'}</span>
            <span>RX-{noti.id}</span>
            <span>{timeStr}</span>
          </div>
        </div>
      </div>
    );

    /* Portal to body so @media print can hide #root and show only this */
    return createPortal(printContent, document.body);
  }
);

/* All styles as inline objects for print reliability */
const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: '"SimSun", "宋体", serif', color: '#333', maxWidth: 800, margin: '0 auto', padding: 0 },
  clinic: { textAlign: 'center', padding: '16px 20px 4px', fontSize: 15, fontWeight: 600 },
  title: { textAlign: 'center', padding: '4px 20px 12px', fontSize: 22, fontWeight: 800, letterSpacing: 4, borderBottom: '2px solid #333' },
  info: { display: 'flex', flexWrap: 'wrap', gap: '6px 20px', padding: '10px 20px', fontSize: 12, borderBottom: '1px dashed #ccc' },
  label: { color: '#999' },
  sectionTitle: { padding: '6px 20px', fontSize: 12, fontWeight: 700, background: '#f9f9f9', borderBottom: '1px solid #ddd' },
  multiCol: { display: 'flex', width: '100%' },
  col: { flex: 1, minWidth: 0, padding: '0 4px' },
  table: { width: '100%', borderCollapse: 'collapse' as const, tableLayout: 'fixed' as const },
  shelf: { width: '15%', fontWeight: 700, padding: '2px 0', fontSize: 12, verticalAlign: 'baseline' as const },
  name: { width: '35%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, padding: '2px 0', fontSize: 12, verticalAlign: 'baseline' as const },
  calc: { width: '25%', color: '#666', fontSize: 11, textAlign: 'right' as const, padding: '2px 0', verticalAlign: 'baseline' as const },
  total: { width: '25%', fontWeight: 700, textAlign: 'right' as const, padding: '2px 0', fontSize: 12, verticalAlign: 'baseline' as const },
  pName: { width: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, padding: '2px 0', fontSize: 12, verticalAlign: 'baseline' as const },
  pQty: { width: '25%', fontWeight: 700, textAlign: 'right' as const, padding: '2px 0', fontSize: 12, verticalAlign: 'baseline' as const },
  summary: { padding: '6px 20px', fontSize: 12, fontWeight: 600, borderTop: '2px solid #666', textAlign: 'right' as const },
  notes: { padding: '8px 20px', fontSize: 11, borderTop: '1px dashed #ccc' },
  footer: { display: 'flex', justifyContent: 'space-between', padding: '10px 20px', fontSize: 11, color: '#666', borderTop: '1px dashed #ccc' },
};

DispensePrint.displayName = 'DispensePrint';
export default DispensePrint;
