import { useRef, useImperativeHandle, forwardRef } from 'react';
import type { BillingDetail } from '../api/billing';
import ShelfTag from './ShelfTag';

export interface BillingPrintHandle {
  print: () => void;
}

interface BillingPrintProps {
  detail: BillingDetail;
  patientName?: string;
  patientAge?: number;
  doctorName?: string;
}

function getCurrentBeijingTime(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}年${get('month')}月${get('day')}日 ${get('hour')}:${get('minute')}`;
}

const HERBS_PER_COLUMN = 10;

const BillingPrint = forwardRef<BillingPrintHandle, BillingPrintProps>(
  ({ detail, patientName, patientAge, doctorName }, ref) => {
    const printRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      print: () => {
        if (!printRef.current) return;
        const timeEl = printRef.current.querySelector('.print-time');
        if (timeEl) {
          timeEl.textContent = getCurrentBeijingTime();
        }
        const printContent = printRef.current.innerHTML;
        const win = window.open('', '_blank');
        if (!win) return;
        win.document.write(`
          <html>
            <head>
              <title>收费单</title>
              <style>
                @page { margin: 20mm; }
                body { font-family: "SimSun", "宋体", serif; color: #333; }
                .billing-print { max-width: 800px; margin: 0 auto; }
                .billing-print h2 { text-align: center; margin-bottom: 4px; color: #000; }
                .billing-print .subtitle { text-align: center; font-size: 12px; color: #999; margin-bottom: 16px; }
                .billing-print .info-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; padding-bottom: 10px; border-bottom: 1px solid #ddd; }
                .billing-print .herb-columns { display: flex; gap: 24px; flex-wrap: wrap; }
                .billing-print .herb-column { flex: 1; min-width: 280px; }
                .billing-print .herb-list { list-style: none; padding: 0; margin: 0; }
                .billing-print .herb-list li { display: flex; align-items: center; padding: 4px 0; border-bottom: 1px dashed #ddd; font-size: 13px; }
                .billing-print .shelf-col { width: 46px; flex-shrink: 0; text-align: center; margin-right: 8px; }
                .shelf-tag { display: inline-block; background: #f6ffed; color: #389e0d; border: 1px solid #b7eb8f; border-radius: 3px; padding: 1px 4px; font-size: 12px; font-weight: bold; font-family: monospace; min-width: 36px; text-align: center; }
                .shelf-tag.empty { background: #f5f5f5; color: #ccc; border-color: #e0e0e0; }
                .billing-print .herb-name { flex: 1; white-space: nowrap; }
                .billing-print .herb-detail { width: 90px; text-align: right; color: #666; white-space: nowrap; }
                .billing-print .herb-cost { width: 70px; text-align: right; font-weight: 500; white-space: nowrap; }
                .billing-print .shortage { color: #cf1322; font-size: 11px; margin-left: 4px; white-space: nowrap; }
                .billing-print .summary { font-size: 14px; margin-top: 20px; padding-top: 12px; border-top: 1px solid #ddd; }
                .billing-print .summary .row { display: flex; justify-content: space-between; margin-bottom: 6px; }
                .billing-print .signature { margin-top: 32px; text-align: right; font-size: 14px; color: #666; }
              </style>
            </head>
            <body>${printContent}</body>
          </html>
        `);
        win.document.close();
        win.print();
        win.close();
      },
    }));

    const herbs = (detail.items || []).filter((i) => i.category === 'herb');
    const patents = (detail.items || []).filter((i) => i.category === 'patent');

    // 计算药品库存缺口（打印页面向患者，仅显示缺量，不显示"无库存"）
    const getShortageLabel = (item: BillingDetail['items'][0]) => {
      if (!item.in_stock) return '';
      const needed = item.category === 'herb' ? item.dosage_val * item.doses : item.dosage_val;
      const shortage = needed - (item.stock_quantity ?? 0);
      if (shortage > 0) {
        const unitLabel = item.category === 'herb' ? 'g' : '盒';
        return `缺${Math.ceil(shortage)}${unitLabel}`;
      }
      return '';
    };

    // Split herbs into columns of HERBS_PER_COLUMN
    const herbColumns: typeof herbs[] = [];
    for (let i = 0; i < herbs.length; i += HERBS_PER_COLUMN) {
      herbColumns.push(herbs.slice(i, i + HERBS_PER_COLUMN));
    }

    return (
      <div style={{ display: 'none' }}>
        <div ref={printRef}>
          <div className="billing-print">
            <h2>收 费 单</h2>
            <div className="subtitle">Billing Statement</div>

            <div className="info-row">
              <span>姓名：{patientName || '—'}</span>
              <span>年龄：{patientAge ? `${patientAge}岁` : '—'}</span>
              <span>日期：<span className="print-time"></span></span>
            </div>

            {detail.formula_name && (
              <div style={{ fontSize: 14, marginBottom: 12 }}>方剂：{detail.formula_name}</div>
            )}

            {herbs.length > 0 && (
              <>
                <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 4 }}>中药明细：</div>
                <div className="herb-columns">
                  {herbColumns.map((col, colIdx) => (
                    <div className="herb-column" key={colIdx}>
                      <ul className="herb-list">
                        {col.map((item, idx) => (
                          <li key={`${item.herb_name}-${idx}`}>
                            <span className="shelf-col">
                              <ShelfTag shelfNo={item.shelf_no} />
                            </span>
                            <span className="herb-name">
                              {item.herb_name}
                              {(() => { const label = getShortageLabel(item); return label ? <span className="shortage">({label})</span> : null; })()}
                            </span>
                            <span className="herb-detail">
                              {item.dosage_val}g×{item.doses}付
                            </span>
                            <span className="herb-cost">
                              ¥{item.item_cost.toFixed(2)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            )}

            {detail.total_doses > 0 && (
              <div style={{ textAlign: 'right', fontSize: 13, marginTop: 6, marginBottom: 2 }}>
                共 <b>{detail.total_doses}</b> 付
              </div>
            )}

            {patents.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 4 }}>中成药明细：</div>
                <div className="herb-columns">
                  <div className="herb-column">
                    <ul className="herb-list">
                      {patents.map((item, idx) => (
                        <li key={`${item.herb_name}-${idx}`}>
                          <span className="shelf-col">
                            <ShelfTag shelfNo={item.shelf_no} />
                          </span>
                          <span className="herb-name">
                            {item.herb_name}
                            {(() => { const label = getShortageLabel(item); return label ? <span className="shortage">({label})</span> : null; })()}
                          </span>
                          <span className="herb-detail">
                            {item.dosage_val}盒
                          </span>
                          <span className="herb-cost">
                            ¥{item.item_cost.toFixed(2)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            <div className="summary">
              <div className="row">
                <span>药费合计：</span>
                <span>¥{detail.drug_cost_total.toFixed(2)}</span>
              </div>
              <div className="row">
                <span>诊疗费：</span>
                <span>¥{detail.consultation_fee.toFixed(2)}</span>
              </div>
              <div className="row" style={{ fontWeight: 'bold', fontSize: 16 }}>
                <span>实收：</span>
                <span>¥{detail.actual_paid.toFixed(2)}</span>
              </div>
            </div>

            <div className="signature">
              收费员：{doctorName || '—'}
            </div>
          </div>
        </div>
      </div>
    );
  }
);

BillingPrint.displayName = 'BillingPrint';
export default BillingPrint;
