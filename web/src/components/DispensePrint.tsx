import { useEffect, useImperativeHandle, forwardRef } from 'react';
import type { DispenseDetail, DispenseDetailItem } from '../api/prescriptionNotification';
import { fmtTotal, chunkToRows } from '../utils/format';

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

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* Inject shared @media print style */
const PRINT_STYLE_ID = 'shared-print-portal-style';
function ensurePrintStyle() {
  if (document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = `
    @media print {
      body > *:not(.dispense-print-portal):not(.center-print-portal) { display: none !important; }
      .dispense-print-portal, .center-print-portal { display: block !important; }
    }
  `;
  document.head.appendChild(style);
}

const DISPENSE_PRINT_STYLES = `
  @page { margin: 10mm; }
  body { font-family: "SimSun", "宋体", serif; color: #333; }
  .dp-page { max-width: 800px; margin: 0 auto; }
  .dp-clinic { text-align: center; padding: 16px 20px 4px; font-size: 15px; font-weight: 600; }
  .dp-title { text-align: center; padding: 4px 20px 12px; font-size: 22px; font-weight: 800; letter-spacing: 4px; border-bottom: 2px solid #333; }
  .dp-info { display: flex; flex-wrap: wrap; gap: 6px 20px; padding: 10px 20px; font-size: 12px; border-bottom: 1px dashed #ccc; }
  .dp-info .label { color: #999; }
  .dp-info b.big { font-size: 15px; color: #d4380d; }
  .dp-section { padding: 6px 20px; font-size: 12px; font-weight: 700; background: #f9f9f9; border-bottom: 1px solid #ddd; }
  .dp-cols { display: table; table-layout: fixed; width: 100%; }
  .dp-col { display: table-cell; width: 50%; vertical-align: top; padding: 0 4px; }
  .dp-col + .dp-col { border-left: 1px dashed #ccc; }
  .dp-row-sep { border-top: 1px dashed #ccc; }
  .dp-row { display: table; table-layout: auto; width: 100%; font-size: 12px; border-bottom: 1px dotted #eee; }
  .dp-row > span { display: table-cell; padding: 2px 4px; vertical-align: baseline; white-space: nowrap; }
  .dp-sh { width: 50px; font-weight: 700; }
  .dp-nm { white-space: normal !important; word-break: break-all; }
  .dp-ca { width: 70px; color: #666; font-size: 11px; }
  .dp-to { width: 60px; font-weight: 700; text-align: right; }
  .dp-pn { white-space: normal !important; word-break: break-all; }
  .dp-pq { width: 50px; font-weight: 700; text-align: right; }
  .dp-sum { padding: 6px 20px; font-size: 12px; font-weight: 600; border-top: 2px solid #666; text-align: right; }
  .dp-notes { padding: 8px 20px; font-size: 11px; border-top: 1px dashed #ccc; }
  .dp-footer { display: flex; justify-content: space-between; padding: 10px 20px; font-size: 11px; color: #666; border-top: 1px dashed #ccc; }
`;

function buildHerbRows(items: DispenseDetailItem[], totalDoses: number): string {
  return items.map(item => {
    const dosageNum = parseFloat(item.dosage) || 0;
    const total = dosageNum * totalDoses;
    const nameDisplay = item.notes
      ? `${escapeHtml(item.herb_name)}(${escapeHtml(item.notes)})`
      : escapeHtml(item.herb_name);
    return `<div class="dp-row">` +
      `<span class="dp-sh">${escapeHtml(item.shelf_no || '--')}</span>` +
      `<span class="dp-nm">${nameDisplay}</span>` +
      `<span class="dp-ca">${escapeHtml(item.dosage)}g×${totalDoses}</span>` +
      `<span class="dp-to">${fmtTotal(total)}g</span>` +
      `</div>`;
  }).join('');
}

function buildPatentRows(items: DispenseDetailItem[]): string {
  return items.map(item => {
    return `<div class="dp-row">` +
      `<span class="dp-sh">${escapeHtml(item.shelf_no || '--')}</span>` +
      `<span class="dp-pn">${escapeHtml(item.herb_name)}</span>` +
      `<span class="dp-pq">×${escapeHtml(item.dosage)}</span>` +
      `</div>`;
  }).join('');
}

function buildChunkedHerbs(herbs: DispenseDetailItem[], totalDoses: number): string {
  if (herbs.length < 10) {
    // Single column at 50% width
    return `<div style="width:50%">${buildHerbRows(herbs, totalDoses)}</div>`;
  }
  const rows = chunkToRows(herbs, 10);
  return rows.map((rowCols, rowIdx) => {
    const sep = rowIdx > 0 ? ' dp-row-sep' : '';
    let h = `<div class="dp-cols${sep}">`;
    h += `<div class="dp-col">${buildHerbRows(rowCols[0], totalDoses)}</div>`;
    h += `<div class="dp-col">${rowCols[1] ? buildHerbRows(rowCols[1], totalDoses) : ''}</div>`;
    h += `</div>`;
    return h;
  }).join('');
}

function buildChunkedPatents(patents: DispenseDetailItem[]): string {
  if (patents.length < 5) {
    return `<div style="width:50%">${buildPatentRows(patents)}</div>`;
  }
  const rows = chunkToRows(patents, 5);
  return rows.map((rowCols, rowIdx) => {
    const sep = rowIdx > 0 ? ' dp-row-sep' : '';
    let h = `<div class="dp-cols${sep}">`;
    h += `<div class="dp-col">${buildPatentRows(rowCols[0])}</div>`;
    h += `<div class="dp-col">${rowCols[1] ? buildPatentRows(rowCols[1]) : ''}</div>`;
    h += `</div>`;
    return h;
  }).join('');
}

function buildDispenseHtml(
  detail: DispenseDetail,
  clinicName?: string,
  operatorName?: string,
): string {
  const noti = detail.notification;
  const herbs = detail.herbs || [];
  const patents = detail.patents || [];
  const totalDoses = noti.total_doses || 0;
  const timeStr = getCurrentBeijingTime();

  let html = '<div class="dp-page">';

  if (clinicName) html += `<div class="dp-clinic">${escapeHtml(clinicName)}</div>`;
  html += `<div class="dp-title">抓 药 单</div>`;

  html += `<div class="dp-info">`;
  html += `<span><span class="label">患者：</span><b>${escapeHtml(noti.patient_name)}</b></span>`;
  html += `<span><span class="label">医师：</span><b>${escapeHtml(noti.doctor_name)}</b></span>`;
  html += `<span><span class="label">方剂：</span><b>${escapeHtml(noti.formula_name)}</b></span>`;
  if (totalDoses > 0) html += `<span><span class="label">总付数：</span><b class="big">${totalDoses} 付</b></span>`;
  html += `</div>`;

  if (herbs.length > 0) {
    html += `<div class="dp-section">中药明细（${herbs.length}味）</div>`;
    html += buildChunkedHerbs(herbs, totalDoses);
    html += `<div class="dp-sum">总付数：${totalDoses} 付</div>`;
  }

  if (patents.length > 0) {
    html += `<div class="dp-section">中成药明细（${patents.length}种）</div>`;
    const totalQty = patents.reduce((s, p) => s + (parseFloat(p.dosage) || 0), 0);
    html += buildChunkedPatents(patents);
    html += `<div class="dp-sum">合计：${totalQty} 盒</div>`;
  }

  if (noti.notes) html += `<div class="dp-notes"><strong>医嘱：</strong>${escapeHtml(noti.notes)}</div>`;

  html += `<div class="dp-footer">`;
  html += `<span>核对人：${operatorName ? escapeHtml(operatorName) : '__________'}</span>`;
  html += `<span>RX-${noti.id}</span>`;
  html += `<span>${timeStr}</span>`;
  html += `</div></div>`;

  return html;
}

const DispensePrint = forwardRef<DispensePrintHandle, DispensePrintProps>(
  ({ detail, clinicName, operatorName }, ref) => {

    useEffect(() => { ensurePrintStyle(); }, []);

    useImperativeHandle(ref, () => ({
      print: () => {
        const html = buildDispenseHtml(detail, clinicName, operatorName);

        /* Remove any stale dispense print portals */
        document.querySelectorAll('.dispense-print-portal').forEach(el => el.remove());

        /* Direct DOM injection — no React timing issues */
        const div = document.createElement('div');
        div.className = 'dispense-print-portal';
        div.innerHTML = `<style>${DISPENSE_PRINT_STYLES}</style>${html}`;
        document.body.appendChild(div);

        setTimeout(() => {
          window.print();
          const cleanup = () => {
            if (div.parentNode) document.body.removeChild(div);
            window.removeEventListener('afterprint', cleanup);
          };
          window.addEventListener('afterprint', cleanup);
          setTimeout(cleanup, 10000); // fallback
        }, 50);
      },
    }));

    return null; // no visible render needed
  }
);

DispensePrint.displayName = 'DispensePrint';
export default DispensePrint;
