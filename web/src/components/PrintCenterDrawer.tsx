import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Drawer,
  Segmented,
  Collapse,
  InputNumber,
  Button,
  Spin,
  message,
  Tag,
  Descriptions,
} from 'antd';
import {
  PrinterOutlined,
  DollarOutlined,
  CheckCircleOutlined,
  MedicineBoxOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import type { PrescriptionData } from '../api/prescription';
import type { BillingDetail } from '../api/billing';
import {
  getPrescriptionBilling,
} from '../api/billing';
import useIsMobile from '../hooks/useIsMobile';

type PrintMode = 'prescription' | 'billing' | 'combined';

interface PrintCenterDrawerProps {
  open: boolean;
  prescription: PrescriptionData;
  prescriptionId: number;
  recordId?: number;
  patientName?: string;
  patientAge?: number;
  chiefComplaint?: string;
  treatment?: string;
  doctorName?: string;
  clinicName?: string;
  onClose: () => void;
}

/* ---------- time helpers ---------- */
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

/* ---------- XSS protection ---------- */
function escapeHtml(s: string | undefined | null): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------- print template builders ---------- */

/* ---------- shelf tag helper ---------- */
function shelfTagHtml(shelfNo: string | undefined): string {
  if (!shelfNo) return '<span class="shelf-tag empty">--</span>';
  return `<span class="shelf-tag">${escapeHtml(shelfNo)}</span>`;
}

function buildPrescriptionHtml(
  prescription: PrescriptionData,
  patientName?: string,
  patientAge?: number,
  chiefComplaint?: string,
  treatment?: string,
  timeStr?: string,
  shelfMap?: Record<string, string>,
  clinicName?: string,
): string {
  const allItems = prescription.items || [];
  const herbs = allItems.filter((i) => !i.category || i.category === 'herb');
  const patents = allItems.filter((i) => i.category === 'patent');
  const HERBS_PER_COLUMN = 10;
  const herbColumns: typeof herbs[] = [];
  for (let i = 0; i < herbs.length; i += HERBS_PER_COLUMN) {
    herbColumns.push(herbs.slice(i, i + HERBS_PER_COLUMN));
  }
  const doctorName = prescription.creator?.real_name || prescription.creator?.username || '';

  return `
    <div class="prescription-print">
      ${clinicName ? `<div class="clinic-header">${escapeHtml(clinicName)}</div><hr class="clinic-sep" />` : ''}
      <h2>处 方 笺</h2>
      <div class="info-row">
        <span>姓名：${escapeHtml(patientName) || '—'}</span>
        <span>年龄：${patientAge ? `${patientAge}岁` : '—'}</span>
        <span>日期：${escapeHtml(timeStr)}</span>
      </div>
      ${chiefComplaint ? `<div class="clinical-info"><span class="label">主诉：</span>${escapeHtml(chiefComplaint)}</div>` : ''}
      ${treatment ? `<div class="clinical-info"><span class="label">治疗方案：</span>${escapeHtml(treatment)}</div>` : ''}
      ${prescription.formula_name ? `<div style="font-size:14px;margin-bottom:4px">方剂：${escapeHtml(prescription.formula_name)}</div>` : ''}
      <div class="rp">Rp.</div>
      ${herbs.length > 0 ? `
        <div class="herb-columns">
          ${herbColumns.map((col) => `
            <div class="herb-column"><ul class="herb-list">
              ${col.map((item) => `
                <li>
                  ${shelfMap ? `<span class="shelf-col">${shelfTagHtml(shelfMap[item.herb_name])}</span>` : ''}
                  <span class="herb-name">${escapeHtml(item.herb_name)}</span>
                  <span class="herb-dosage">${escapeHtml(item.dosage)}克</span>
                  <span class="herb-notes">${escapeHtml(item.notes)}</span>
                </li>
              `).join('')}
            </ul></div>
          `).join('')}
        </div>
        ${prescription.total_doses > 0 ? `<div style="text-align:right;font-size:14px;margin-top:8px">共 ${prescription.total_doses} 付</div>` : ''}
      ` : ''}
      ${patents.length > 0 ? `
        <div style="margin-top:${herbs.length > 0 ? 12 : 0}px">
          <div style="font-size:14px;font-weight:bold;margin-bottom:4px">中成药：</div>
          <ul class="herb-list">
            ${patents.map((item) => `
              <li>
                ${shelfMap ? `<span class="shelf-col">${shelfTagHtml(shelfMap[item.herb_name])}</span>` : ''}
                <span class="herb-name">${escapeHtml(item.herb_name)}</span>
                <span class="herb-dosage">${escapeHtml(item.dosage)}盒</span>
                <span class="herb-notes">${escapeHtml(item.notes)}</span>
              </li>
            `).join('')}
          </ul>
        </div>
      ` : ''}
      <div class="footer">
        ${prescription.notes ? `
          <div style="margin-top:4px">
            <span>医嘱：</span>
            ${prescription.notes.split('\n').map((line) => `<div style="padding-left:42px">${escapeHtml(line)}</div>`).join('')}
          </div>
        ` : ''}
      </div>
      <div class="signature">医师：${escapeHtml(doctorName)}</div>
    </div>
  `;
}

function buildBillingHtml(
  detail: BillingDetail,
  consultationFee: number,
  actualPaid: number,
  patientName?: string,
  patientAge?: number,
  doctorName?: string,
  timeStr?: string,
  clinicName?: string,
): string {
  const herbs = (detail.items || []).filter((i) => i.category === 'herb');
  const patents = (detail.items || []).filter((i) => i.category === 'patent');
  const drugCostTotal = detail.drug_cost_total ?? 0;

  // 计算缺口标签（打印页仅显示缺量，不显示"无库存"）
  const shortageLabel = (item: BillingDetail['items'][0]) => {
    if (!item.in_stock) return '';
    const needed = item.category === 'herb' ? item.dosage_val * item.doses : item.dosage_val;
    const shortage = needed - (item.stock_quantity ?? 0);
    if (shortage > 0) {
      const unitLabel = item.category === 'herb' ? 'g' : '盒';
      return ` <span class="shortage">(缺${Math.ceil(shortage)}${unitLabel})</span>`;
    }
    return '';
  };

  return `
    <div class="billing-print">
      ${clinicName ? `<div class="clinic-header">${escapeHtml(clinicName)}</div><hr class="clinic-sep" />` : ''}
      <h2>收 费 单</h2>
      <div class="info-row">
        <span>姓名：${escapeHtml(patientName) || '—'}</span>
        <span>年龄：${patientAge ? `${patientAge}岁` : '—'}</span>
        <span>日期：${escapeHtml(timeStr)}</span>
      </div>
      ${detail.formula_name ? `<div style="font-size:14px;margin-bottom:12px">方剂：${escapeHtml(detail.formula_name)}</div>` : ''}
      ${herbs.length > 0 ? (() => {
        const HERBS_PER_COL = 10;
        const herbCols: typeof herbs[] = [];
        for (let i = 0; i < herbs.length; i += HERBS_PER_COL) {
          herbCols.push(herbs.slice(i, i + HERBS_PER_COL));
        }
        return `
        <div style="font-size:13px;font-weight:bold;margin-bottom:4px">中药明细：</div>
        <div class="herb-columns">
          ${herbCols.map((col) => `
            <div class="herb-column"><ul class="billing-herb-list">
              ${col.map((item) => `
                <li>
                  <span class="shelf-col">${shelfTagHtml(item.shelf_no)}</span>
                  <span class="herb-name">${escapeHtml(item.herb_name)}${shortageLabel(item)}</span>
                  <span class="herb-detail">${item.dosage_val}g×${item.doses}付</span>
                  <span class="herb-cost">¥${item.item_cost.toFixed(2)}</span>
                </li>
              `).join('')}
            </ul></div>
          `).join('')}
        </div>`;
      })() : ''}
      ${detail.total_doses > 0 ? `<div style="text-align:right;font-size:13px;margin-top:6px;margin-bottom:2px">共 <b>${detail.total_doses}</b> 付</div>` : ''}
      ${patents.length > 0 ? `
        <div style="margin-top:8px">
          <div style="font-size:13px;font-weight:bold;margin-bottom:4px">中成药明细：</div>
          <div class="herb-columns">
            <div class="herb-column"><ul class="billing-herb-list">
              ${patents.map((item) => `
                <li>
                  <span class="shelf-col">${shelfTagHtml(item.shelf_no)}</span>
                  <span class="herb-name">${escapeHtml(item.herb_name)}${shortageLabel(item)}</span>
                  <span class="herb-detail">${item.dosage_val}盒</span>
                  <span class="herb-cost">¥${item.item_cost.toFixed(2)}</span>
                </li>
              `).join('')}
            </ul></div>
          </div>
        </div>
      ` : ''}
      <div class="summary">
        <div class="row"><span>药费合计：</span><span>¥${drugCostTotal.toFixed(2)}</span></div>
        <div class="row"><span>诊疗费：</span><span>¥${consultationFee.toFixed(2)}</span></div>
        <div class="row" style="font-weight:bold;font-size:16px"><span>实收：</span><span>¥${actualPaid.toFixed(2)}</span></div>
      </div>
      <div class="signature">收费员：${escapeHtml(doctorName) || '—'}</div>
    </div>
  `;
}

const PRINT_STYLES = `
  @page { margin: 20mm; }
  body { font-family: "SimSun", "宋体", serif; color: #333; }
  /* Prescription styles */
  .prescription-print { max-width: 800px; margin: 0 auto; }
  .prescription-print .clinic-header { text-align: center; font-size: 16px; font-weight: bold; color: #000; letter-spacing: 4px; margin-bottom: 6px; }
  .prescription-print .clinic-sep { width: 60px; border: none; border-top: 1px solid #ccc; margin: 6px auto 10px; }
  .prescription-print h2 { text-align: center; margin-bottom: 12px; color: #000; }
  .prescription-print .info-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; padding-bottom: 10px; border-bottom: 1px solid #ddd; }
  .prescription-print .clinical-info { font-size: 14px; margin-bottom: 4px; }
  .prescription-print .clinical-info .label { font-weight: bold; }
  .prescription-print .rp { font-size: 18px; font-weight: bold; margin: 8px 0; }
  .prescription-print .herb-columns { display: flex; gap: 24px; flex-wrap: wrap; }
  .prescription-print .herb-column { flex: 1; min-width: 300px; }
  .prescription-print .herb-list { list-style: none; padding: 0; margin: 0; }
  .prescription-print .herb-list li { display: flex; align-items: center; padding: 5px 0; border-bottom: 1px dashed #ddd; font-size: 14px; }
  .prescription-print .shelf-col { width: 46px; flex-shrink: 0; text-align: center; margin-right: 8px; }
  .shelf-tag { display: inline-block; background: #f6ffed; color: #389e0d; border: 1px solid #b7eb8f; border-radius: 3px; padding: 1px 4px; font-size: 12px; font-weight: bold; font-family: monospace; min-width: 36px; text-align: center; }
  .shelf-tag.empty { background: #f5f5f5; color: #ccc; border-color: #e0e0e0; }
  .prescription-print .herb-name { flex: 1; white-space: nowrap; }
  .prescription-print .herb-dosage { width: 60px; text-align: right; }
  .prescription-print .herb-notes { width: 80px; text-align: right; color: #888; }
  .prescription-print .footer { margin-top: 16px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 14px; }
  .prescription-print .footer .row { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .prescription-print .signature { margin-top: 32px; text-align: right; font-size: 14px; color: #666; }
  /* Billing styles */
  .billing-print { max-width: 800px; margin: 0 auto; }
  .billing-print .clinic-header { text-align: center; font-size: 16px; font-weight: bold; color: #000; letter-spacing: 4px; margin-bottom: 6px; }
  .billing-print .clinic-sep { width: 60px; border: none; border-top: 1px solid #ccc; margin: 6px auto 10px; }
  .billing-print h2 { text-align: center; margin-bottom: 12px; color: #000; }
  .billing-print .info-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; padding-bottom: 10px; border-bottom: 1px solid #ddd; }
  .billing-print .summary { font-size: 14px; margin-top: 20px; padding-top: 12px; border-top: 1px solid #ddd; }
  .billing-print .summary .row { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .billing-print .signature { margin-top: 32px; text-align: right; font-size: 14px; color: #666; }
  .billing-print .herb-columns { display: flex; gap: 24px; flex-wrap: wrap; }
  .billing-print .herb-column { flex: 1; min-width: 300px; }
  .billing-print .billing-herb-list { list-style: none; padding: 0; margin: 0; }
  .billing-print .billing-herb-list li { display: flex; align-items: center; padding: 4px 0; border-bottom: 1px dashed #ddd; font-size: 13px; }
  .billing-print .shelf-col { width: 46px; flex-shrink: 0; text-align: center; margin-right: 8px; }
  .billing-print .herb-name { flex: 1; white-space: nowrap; }
  .billing-print .herb-detail { width: 90px; text-align: right; color: #666; white-space: nowrap; }
  .billing-print .herb-cost { width: 70px; text-align: right; font-weight: 500; white-space: nowrap; }
  .billing-print .shortage { color: #cf1322; font-size: 11px; margin-left: 4px; white-space: nowrap; }
  /* Separator for combined mode */
  .print-separator { border: none; border-top: 2px dashed #999; margin: 24px 0; }
`;

/* Inject @media print style to hide app and show portal (shared with DispensePrint) */
const PORTAL_STYLE_ID = 'shared-print-portal-style';
function ensurePortalPrintStyle() {
  if (document.getElementById(PORTAL_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PORTAL_STYLE_ID;
  style.textContent = `
    @media print {
      body > *:not(.print-portal) { display: none !important; }
      .print-portal { display: block !important; }
    }
  `;
  document.head.appendChild(style);
}

/* ---------- component ---------- */
export default function PrintCenterDrawer({
  open,
  prescription,
  prescriptionId,
  // recordId reserved for future record-level billing
  patientName,
  patientAge,
  chiefComplaint,
  treatment,
  doctorName,
  clinicName,
  onClose,
}: PrintCenterDrawerProps) {
  const isMobile = useIsMobile();
  const [mode, setMode] = useState<PrintMode>('combined');
  const [loading, setLoading] = useState(false);
  const [billingDetail, setBillingDetail] = useState<BillingDetail | null>(null);
  const [consultationFee, setConsultationFee] = useState(100);
  const [actualPaid, setActualPaid] = useState(0);
  const actualPaidManualRef = useRef(false);

  useEffect(() => { ensurePortalPrintStyle(); }, []);

  const loadBilling = useCallback(async () => {
    if (!prescriptionId) return;
    setLoading(true);
    try {
      const res = await getPrescriptionBilling(prescriptionId);
      const body = res as unknown as { code: number; data: BillingDetail };
      const d = body.data;
      setBillingDetail(d);
      setConsultationFee(d.consultation_fee);
      const total = (d.drug_cost_total ?? 0) + d.consultation_fee;
      setActualPaid(d.actual_paid > 0 ? d.actual_paid : total);
      actualPaidManualRef.current = false;
    } catch {
      message.error('加载收费明细失败');
    } finally {
      setLoading(false);
    }
  }, [prescriptionId]);

  useEffect(() => {
    if (open) {
      loadBilling();
      setMode('combined');
    }
    if (!open) actualPaidManualRef.current = false;
  }, [open, loadBilling]);

  const drugCostTotal = billingDetail?.drug_cost_total ?? 0;
  const totalAmount = drugCostTotal + consultationFee;

  /* ---------- print handler (mobile-compatible, no window.open) ---------- */
  const handlePrint = () => {
    const timeStr = getCurrentBeijingTime();
    let body = '';
    if (mode === 'prescription' || mode === 'combined') {
      body += buildPrescriptionHtml(prescription, patientName, patientAge, chiefComplaint, treatment, timeStr, Object.keys(shelfMap).length > 0 ? shelfMap : undefined, clinicName);
    }
    if (mode === 'combined') {
      body += '<hr class="print-separator" />';
    }
    if ((mode === 'billing' || mode === 'combined') && billingDetail) {
      body += buildBillingHtml(billingDetail, consultationFee, actualPaid, patientName, patientAge, doctorName, timeStr, clinicName);
    }
    if (isMobile) {
      /* Remove any stale center print portals */
      document.querySelectorAll('.center-print-portal').forEach(el => el.remove());
      /* Mobile: inject DOM directly + @media print (no React timing issues) */
      const div = document.createElement('div');
      div.className = 'center-print-portal';
      div.innerHTML = `<style>${PRINT_STYLES}</style>${body}`;
      document.body.appendChild(div);
      setTimeout(() => {
        window.print();
        const cleanup = () => {
          if (div.parentNode) document.body.removeChild(div);
          window.removeEventListener('afterprint', cleanup);
        };
        window.addEventListener('afterprint', cleanup);
        // fallback cleanup after 10s in case afterprint doesn't fire
        setTimeout(cleanup, 10000);
      }, 50);
    } else {
      /* Desktop: window.open (more reliable print preview) */
      const win = window.open('', '_blank');
      if (!win) {
        message.error('打印窗口被浏览器拦截，请允许弹出窗口后重试');
        return;
      }
      win.document.write(`<html><head><title>${mode === 'prescription' ? '处方笺' : mode === 'billing' ? '收费单' : '处方笺 + 收费单'}</title><style>${PRINT_STYLES}</style></head><body>${body}</body></html>`);
      win.document.close();
      win.print();
      win.close();
    }
  };

  /* ---------- preview helpers ---------- */
  const allItems = prescription.items || [];
  const rxHerbs = allItems.filter((i) => !i.category || i.category === 'herb');
  const rxPatents = allItems.filter((i) => i.category === 'patent');
  const hasItems = rxHerbs.length > 0 || rxPatents.length > 0;

  const billingHerbs = (billingDetail?.items || []).filter((i) => i.category === 'herb');
  const billingPatents = (billingDetail?.items || []).filter((i) => i.category === 'patent');

  // Build shelf map from billing detail for prescription preview and print
  const shelfMap = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const item of billingDetail?.items ?? []) {
      if (item.shelf_no) m[item.herb_name] = item.shelf_no;
    }
    return m;
  }, [billingDetail?.items]);

  // 计算库存缺口（预览区用）
  const getStockShortage = (item: BillingDetail['items'][0]) => {
    if (!item.in_stock) return { shortage: 0, insufficient: false, noStock: true };
    const needed = item.category === 'herb' ? item.dosage_val * item.doses : item.dosage_val;
    const shortage = needed - (item.stock_quantity ?? 0);
    return { shortage: Math.max(0, shortage), insufficient: shortage > 0, noStock: false };
  };

  const MODE_OPTIONS = [
    { label: '仅打印处方', value: 'prescription' as const },
    { label: '仅打印收费', value: 'billing' as const },
    { label: '合并打印', value: 'combined' as const },
  ];

  const showBillingSection = mode === 'billing' || mode === 'combined';
  const showPrescriptionSection = mode === 'prescription' || mode === 'combined';

  return (
    <>
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PrinterOutlined style={{ color: '#1677ff', fontSize: 18 }} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>打印中心</span>
        </div>
      }
      open={open}
      onClose={onClose}
      destroyOnClose
      width="100%"
      placement="right"
      styles={{ body: { paddingBottom: 80 } }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Button
            type="primary"
            icon={<PrinterOutlined />}
            onClick={handlePrint}
            disabled={mode !== 'prescription' && !billingDetail}
          >
            预览打印
          </Button>
        </div>
      }
    >
      <Spin spinning={loading}>
        {/* Mode selector */}
        <Segmented
          block
          options={MODE_OPTIONS}
          value={mode}
          onChange={(v) => setMode(v as PrintMode)}
          style={{ marginBottom: 16 }}
        />

        {/* Prescription preview */}
        {showPrescriptionSection && (
          <Collapse
            defaultActiveKey={['rx']}
            style={{ marginBottom: 12 }}
            items={[{
              key: 'rx',
              label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FileTextOutlined style={{ color: '#1677ff' }} />
                  <span style={{ fontWeight: 500 }}>处方预览</span>
                  {prescription.formula_name && (
                    <Tag color="blue" style={{ marginLeft: 4 }}>{prescription.formula_name}</Tag>
                  )}
                </div>
              ),
              children: (
                <div>
                  {rxHerbs.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: '#555', marginBottom: 4 }}>中药：</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', lineHeight: '24px' }}>
                        {rxHerbs.map((h) => (
                          <span key={h.id} style={{ whiteSpace: 'nowrap', fontSize: 14 }}>
                            {shelfMap[h.herb_name]
                              ? <Tag color="green" style={{ fontSize: 11, padding: '0 4px', marginRight: 4, fontFamily: 'monospace', minWidth: 36, textAlign: 'center' }}>{shelfMap[h.herb_name]}</Tag>
                              : <Tag style={{ fontSize: 11, padding: '0 4px', marginRight: 4, fontFamily: 'monospace', color: '#ccc', minWidth: 36, textAlign: 'center' }}>--</Tag>
                            }
                            {h.herb_name} <span style={{ color: '#1677ff' }}>{h.dosage}克</span>
                            {h.notes && <span style={{ color: '#999' }}>({h.notes})</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {rxPatents.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: '#555', marginBottom: 4 }}>中成药：</div>
                      {rxPatents.map((p) => (
                        <span key={p.id} style={{ whiteSpace: 'nowrap', fontSize: 14, marginRight: 12 }}>
                          {shelfMap[p.herb_name]
                            ? <Tag color="green" style={{ fontSize: 11, padding: '0 4px', marginRight: 4, fontFamily: 'monospace', minWidth: 36, textAlign: 'center' }}>{shelfMap[p.herb_name]}</Tag>
                            : <Tag style={{ fontSize: 11, padding: '0 4px', marginRight: 4, fontFamily: 'monospace', color: '#ccc', minWidth: 36, textAlign: 'center' }}>--</Tag>
                          }
                          <span style={{ color: '#722ed1' }}>[成药]</span> {p.herb_name} <span style={{ color: '#1677ff' }}>{p.dosage}盒</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {prescription.total_doses > 0 && (
                    <div style={{ fontSize: 13, color: '#333' }}>共 {prescription.total_doses} 付</div>
                  )}
                  {prescription.notes && (
                    <div style={{ marginTop: 6, fontSize: 12, color: '#666' }}>
                      医嘱：{prescription.notes}
                    </div>
                  )}
                </div>
              ),
            }]}
          />
        )}

        {/* Billing preview */}
        {showBillingSection && billingDetail && (
          <Collapse
            defaultActiveKey={['billing']}
            style={{ marginBottom: 12 }}
            items={[{
              key: 'billing',
              label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <DollarOutlined style={{ color: '#faad14' }} />
                  <span style={{ fontWeight: 500 }}>收费预览</span>
                  {billingDetail.stock_deducted && (
                    <Tag color="green" icon={<CheckCircleOutlined />} style={{ marginLeft: 4 }}>已出库</Tag>
                  )}
                </div>
              ),
              children: (
                <div>
                  {/* Info header */}
                  {hasItems && (
                    <Descriptions column={1} size="small" style={{ marginBottom: 12 }}>
                      <Descriptions.Item label="方剂">{billingDetail.formula_name || '自定义处方'}</Descriptions.Item>
                      <Descriptions.Item label="付数">{billingDetail.total_doses} 付</Descriptions.Item>
                    </Descriptions>
                  )}

                  {/* Herb items */}
                  {billingHerbs.length > 0 && (
                    <>
                      <div style={{ fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                        <MedicineBoxOutlined style={{ color: '#1677ff' }} />
                        中药明细
                        <Tag color="blue" style={{ marginLeft: 4 }}>{billingDetail.total_doses}付</Tag>
                      </div>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
                        gap: '4px 12px',
                        marginBottom: 8,
                      }}>
                        {billingHerbs.map((item) => {
                          const stock = getStockShortage(item);
                          return (
                            <div key={item.herb_name} style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              padding: '4px 8px', borderBottom: '1px dashed #eee', fontSize: 13,
                            }}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                                {item.shelf_no
                                  ? <Tag color="green" style={{ fontSize: 11, padding: '0 4px', margin: 0, fontFamily: 'monospace', minWidth: 36, textAlign: 'center', flexShrink: 0 }}>{item.shelf_no}</Tag>
                                  : <Tag style={{ fontSize: 11, padding: '0 4px', margin: 0, fontFamily: 'monospace', color: '#ccc', minWidth: 36, textAlign: 'center', flexShrink: 0 }}>--</Tag>
                                }
                                <span style={{ whiteSpace: 'nowrap' }}>{item.herb_name}</span>
                                <span style={{ color: '#666', whiteSpace: 'nowrap' }}>{item.dosage_val}g×{item.doses}付</span>
                                {stock.noStock && <Tag color="orange" style={{ fontSize: 11, margin: 0 }}>无库存</Tag>}
                                {stock.insufficient && (
                                  <span style={{ fontSize: 11, padding: '0 6px', background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 4, color: '#cf1322', fontWeight: 500, whiteSpace: 'nowrap' }}>
                                    缺{Math.ceil(stock.shortage)}g
                                  </span>
                                )}
                              </span>
                              <span style={{ color: '#cf1322', fontWeight: 500, whiteSpace: 'nowrap', marginLeft: 4 }}>¥{item.item_cost.toFixed(2)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {/* Patent items */}
                  {billingPatents.length > 0 && (
                    <>
                      <div style={{ fontWeight: 600, marginTop: billingHerbs.length > 0 ? 8 : 0, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                        <MedicineBoxOutlined style={{ color: '#722ed1' }} />
                        中成药明细
                      </div>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
                        gap: '4px 12px',
                        marginBottom: 8,
                      }}>
                        {billingPatents.map((item) => {
                          const stock = getStockShortage(item);
                          return (
                            <div key={item.herb_name} style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              padding: '4px 8px', borderBottom: '1px dashed #eee', fontSize: 13,
                            }}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                                {item.shelf_no
                                  ? <Tag color="green" style={{ fontSize: 11, padding: '0 4px', margin: 0, fontFamily: 'monospace', minWidth: 36, textAlign: 'center', flexShrink: 0 }}>{item.shelf_no}</Tag>
                                  : <Tag style={{ fontSize: 11, padding: '0 4px', margin: 0, fontFamily: 'monospace', color: '#ccc', minWidth: 36, textAlign: 'center', flexShrink: 0 }}>--</Tag>
                                }
                                <Tag color="purple" style={{ fontSize: 11, margin: 0, flexShrink: 0 }}>成药</Tag>
                                <span style={{ whiteSpace: 'nowrap' }}>{item.herb_name}</span>
                                <span style={{ color: '#666', whiteSpace: 'nowrap' }}>{item.dosage_val}盒</span>
                                {stock.noStock && <Tag color="orange" style={{ fontSize: 11, margin: 0 }}>无库存</Tag>}
                                {stock.insufficient && (
                                  <span style={{ fontSize: 11, padding: '0 6px', background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 4, color: '#cf1322', fontWeight: 500, whiteSpace: 'nowrap' }}>
                                    缺{Math.ceil(stock.shortage)}盒
                                  </span>
                                )}
                              </span>
                              <span style={{ color: '#cf1322', fontWeight: 500, whiteSpace: 'nowrap', marginLeft: 4 }}>¥{item.item_cost.toFixed(2)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {/* No items hint */}
                  {!hasItems && (
                    <div style={{ textAlign: 'center', padding: '16px', color: '#999', border: '1px dashed #d9d9d9', borderRadius: 8, marginBottom: 12 }}>
                      仅收取诊疗费（无药品）
                    </div>
                  )}

                  {/* Summary */}
                  <div style={{
                    marginTop: 8,
                    padding: '10px 12px',
                    background: 'linear-gradient(135deg, #fff7e6 0%, #fff1cc 100%)',
                    borderRadius: 10,
                    border: '1px solid #ffe58f',
                  }}>
                    {hasItems && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, fontSize: 13, color: '#666' }}>
                        <span>药费合计</span>
                        <span style={{ fontWeight: 600, color: '#333' }}>¥{drugCostTotal.toFixed(2)}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, fontSize: 13, color: '#666' }}>
                      <span>诊疗费</span>
                      <InputNumber
                        value={consultationFee}
                        onChange={(v) => {
                          const newFee = v ?? 0;
                          setConsultationFee(newFee);
                          if (!actualPaidManualRef.current) {
                            setActualPaid(drugCostTotal + newFee);
                          }
                        }}
                        min={0}
                        precision={2}
                        prefix="¥"
                        size="small"
                        disabled
                        style={{ width: 110 }}
                      />
                    </div>
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                      paddingTop: 8, borderTop: '1px solid #d9d9d9',
                      fontSize: 16, fontWeight: 700, color: '#cf1322',
                    }}>
                      <span>应收</span>
                      <span>¥{totalAmount.toFixed(2)}</span>
                    </div>
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                      marginTop: 8, fontSize: 16, fontWeight: 700, color: '#389e0d',
                    }}>
                      <span>实收</span>
                      <InputNumber
                        value={actualPaid}
                        onChange={(v) => { actualPaidManualRef.current = true; setActualPaid(v ?? 0); }}
                        min={0}
                        precision={2}
                        prefix="¥"
                        size="small"
                        disabled
                        style={{ width: 110, fontWeight: 700 }}
                      />
                    </div>
                  </div>
                </div>
              ),
            }]}
          />
        )}
      </Spin>
    </Drawer>
    </>
  );
}
