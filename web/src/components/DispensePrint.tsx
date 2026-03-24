import { useRef, useImperativeHandle, forwardRef } from 'react';
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
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const DispensePrint = forwardRef<DispensePrintHandle, DispensePrintProps>(
  ({ detail, clinicName, operatorName }, ref) => {
    const printRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      print: () => {
        if (!printRef.current) return;
        const noti = detail.notification;
        const herbs = detail.herbs || [];
        const patents = detail.patents || [];
        const totalDoses = noti.total_doses || 0;
        const timeStr = getCurrentBeijingTime();

        /* Build HTML string */
        let html = '';

        /* Clinic name */
        if (clinicName) {
          html += `<div class="print-clinic">${escapeHtml(clinicName)}</div>`;
        }
        html += `<div class="print-title">抓 药 单</div>`;

        /* Info row */
        html += `<div class="print-info">`;
        html += `<div class="info-item"><span class="info-label">患者：</span><span class="info-value">${escapeHtml(noti.patient_name)}</span></div>`;
        html += `<div class="info-item"><span class="info-label">医师：</span><span class="info-value">${escapeHtml(noti.doctor_name)}</span></div>`;
        html += `<div class="info-item"><span class="info-label">方剂：</span><span class="info-value">${escapeHtml(noti.formula_name)}</span></div>`;
        if (totalDoses > 0) {
          html += `<div class="info-item"><span class="info-label">总付数：</span><span class="info-value big">${totalDoses} 付</span></div>`;
        }
        html += `</div>`;

        /* Herbs section */
        if (herbs.length > 0) {
          html += `<div class="print-section-title">中药明细（${herbs.length}味）</div>`;
          const mid = Math.ceil(herbs.length / 2);
          const col1 = herbs.slice(0, mid);
          const col2 = herbs.slice(mid);

          html += `<div class="print-multi-col">`;
          html += `<div class="pcol">${buildHerbRows(col1, totalDoses)}</div>`;
          if (col2.length > 0) {
            html += `<div class="pcol">${buildHerbRows(col2, totalDoses)}</div>`;
          }
          html += `</div>`;
          html += `<div class="print-summary">总付数：${totalDoses} 付</div>`;
        }

        /* Patents section */
        if (patents.length > 0) {
          html += `<div class="print-section-title">中成药明细（${patents.length}种）</div>`;
          const mid = Math.ceil(patents.length / 2);
          const col1 = patents.slice(0, mid);
          const col2 = patents.slice(mid);
          const totalQty = patents.reduce((s, p) => s + (parseFloat(p.dosage) || 0), 0);

          html += `<div class="print-multi-col">`;
          html += `<div class="pcol">${buildPatentRows(col1)}</div>`;
          if (col2.length > 0) {
            html += `<div class="pcol">${buildPatentRows(col2)}</div>`;
          }
          html += `</div>`;
          html += `<div class="print-summary">合计：${totalQty} 盒</div>`;
        }

        /* Notes */
        if (noti.notes) {
          html += `<div class="print-notes"><strong>医嘱：</strong>${escapeHtml(noti.notes)}</div>`;
        }

        /* Footer */
        html += `<div class="print-footer">`;
        html += `<span>核对人：${operatorName ? escapeHtml(operatorName) : '__________'}</span>`;
        html += `<span>RX-${noti.id}</span>`;
        html += `<span>${timeStr}</span>`;
        html += `</div>`;

        /* Open print window */
        const win = window.open('', '_blank');
        if (!win) return;
        win.document.write(`<!DOCTYPE html>
<html><head><title>抓药单</title>
<style>
  @page { margin: 10mm; }
  body { font-family: "SimSun", "宋体", serif; color: #333; margin: 0; padding: 0; }
  .print-clinic { text-align: center; padding: 16px 20px 4px; font-size: 15px; font-weight: 600; color: #333; }
  .print-title { text-align: center; padding: 4px 20px 12px; font-size: 22px; font-weight: 800; letter-spacing: 4px; border-bottom: 2px solid #333; }
  .print-info { display: flex; flex-wrap: wrap; gap: 6px 20px; padding: 10px 20px; font-size: 12px; border-bottom: 1px dashed #ccc; }
  .print-info .info-item { display: flex; gap: 3px; }
  .print-info .info-label { color: #999; }
  .print-info .info-value { font-weight: 600; }
  .print-info .info-value.big { font-size: 15px; color: #d4380d; }
  .print-section-title { padding: 6px 20px; font-size: 12px; font-weight: 700; background: #f9f9f9; border-bottom: 1px solid #ddd; }
  .print-multi-col { display: flex; gap: 0; width: 100%; padding: 0 10px; }
  .print-multi-col .pcol { flex: 1; min-width: 0; overflow: hidden; }
  .print-multi-col .pcol + .pcol { border-left: 1px dashed #ccc; padding-left: 8px; }
  .print-herb-row { display: flex; align-items: baseline; gap: 2px; padding: 3px 0; font-size: 12px; border-bottom: 1px dotted #eee; }
  .print-herb-row .ph-shelf { font-weight: 700; min-width: 20px; color: #333; flex-shrink: 0; }
  .print-herb-row .ph-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .print-herb-row .ph-calc { color: #666; white-space: nowrap; flex-shrink: 0; font-size: 11px; }
  .print-herb-row .ph-total { font-weight: 700; min-width: 38px; text-align: right; flex-shrink: 0; padding-left: 2px; }
  .print-patent-row { display: flex; align-items: baseline; gap: 3px; padding: 3px 0; font-size: 12px; border-bottom: 1px dotted #eee; }
  .print-patent-row .pp-shelf { font-weight: 700; min-width: 20px; color: #333; flex-shrink: 0; }
  .print-patent-row .pp-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .print-patent-row .pp-qty { font-weight: 700; text-align: right; min-width: 36px; flex-shrink: 0; }
  .print-summary { padding: 6px 20px; font-size: 12px; font-weight: 600; border-top: 2px solid #666; text-align: right; }
  .print-notes { padding: 8px 20px; font-size: 11px; color: #333; border-top: 1px dashed #ccc; }
  .print-footer { display: flex; justify-content: space-between; padding: 10px 20px; font-size: 11px; color: #666; border-top: 1px dashed #ccc; }
</style>
</head><body>${html}</body></html>`);
        win.document.close();
        win.print();
        win.close();
      },
    }));

    return (
      <div style={{ display: 'none' }}>
        <div ref={printRef} />
      </div>
    );
  }
);

/* Helper functions to build HTML rows */

function buildHerbRows(items: DispenseDetailItem[], totalDoses: number): string {
  return items.map(item => {
    const dosageNum = parseFloat(item.dosage) || 0;
    const total = dosageNum * totalDoses;
    const nameDisplay = item.notes
      ? `${escapeHtml(item.herb_name)}(${escapeHtml(item.notes)})`
      : escapeHtml(item.herb_name);
    return `<div class="print-herb-row">` +
      `<span class="ph-shelf">${escapeHtml(item.shelf_no || '--')}</span>` +
      `<span class="ph-name">${nameDisplay}</span>` +
      `<span class="ph-calc">${escapeHtml(item.dosage)}g×${totalDoses}</span>` +
      `<span class="ph-total">${total}g</span>` +
      `</div>`;
  }).join('');
}

function buildPatentRows(items: DispenseDetailItem[]): string {
  return items.map(item => {
    return `<div class="print-patent-row">` +
      `<span class="pp-shelf">${escapeHtml(item.shelf_no || '--')}</span>` +
      `<span class="pp-name">${escapeHtml(item.herb_name)}</span>` +
      `<span class="pp-qty">×${escapeHtml(item.dosage)}</span>` +
      `</div>`;
  }).join('');
}

DispensePrint.displayName = 'DispensePrint';
export default DispensePrint;
