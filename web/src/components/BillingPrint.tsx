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
                .billing-print table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 4px; }
                .billing-print th, .billing-print td { border-bottom: 1px solid #e8e8e8; padding: 6px 8px; text-align: center; vertical-align: middle; }
                .billing-print th { font-weight: bold; border-bottom: 2px solid #ccc; color: #555; }
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
                <table>
                  <thead>
                    <tr>
                      <th>药名</th>
                      <th>用量</th>
                      <th>单价(元/克)</th>
                      <th>小计(元)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {herbs.map((item, idx) => (
                      <tr key={idx}>
                        <td style={{ textAlign: 'left' }}><ShelfTag shelfNo={item.shelf_no} />{item.herb_name}{!item.in_stock && ' *'}</td>
                        <td>{item.dosage_val}g × {item.doses}付</td>
                        <td>{item.in_stock ? item.unit_price.toFixed(2) : '-'}</td>
                        <td>{item.item_cost.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                <table>
                  <thead>
                    <tr>
                      <th>药名</th>
                      <th>用量</th>
                      <th>单价(元/盒)</th>
                      <th>小计(元)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patents.map((item, idx) => (
                      <tr key={idx}>
                        <td style={{ textAlign: 'left' }}><ShelfTag shelfNo={item.shelf_no} />{item.herb_name}{!item.in_stock && ' *'}</td>
                        <td>{item.dosage_val}盒</td>
                        <td>{item.in_stock ? item.unit_price.toFixed(2) : '-'}</td>
                        <td>{item.item_cost.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
