import { useRef } from 'react';
import { Button } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import type { PrescriptionData } from '../api/prescription';

interface PrescriptionPrintProps {
  prescription: PrescriptionData;
  patientName?: string;
  patientAge?: number;
  visitDate?: string;
}

function getCurrentBeijingTime(): string {
  const now = new Date();
  // Format in Asia/Shanghai timezone
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

export default function PrescriptionPrint({
  prescription,
  patientName,
  patientAge,
}: PrescriptionPrintProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    if (!printRef.current) return;
    // Set current Beijing time right before printing
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
          <title>处方笺</title>
          <style>
            @page { margin: 20mm; }
            body { font-family: "SimSun", "宋体", serif; color: #000; }
            .prescription-print { max-width: 800px; margin: 0 auto; }
            .prescription-print h2 { text-align: center; margin-bottom: 4px; }
            .prescription-print .subtitle { text-align: center; font-size: 12px; color: #666; margin-bottom: 16px; }
            .prescription-print .info-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
            .prescription-print .divider { border-top: 1px solid #000; margin: 12px 0; }
            .prescription-print .rp { font-size: 18px; font-weight: bold; margin: 8px 0; }
            .prescription-print .herb-columns { display: flex; gap: 24px; }
            .prescription-print .herb-column { flex: 1; }
            .prescription-print .herb-list { list-style: none; padding: 0; margin: 0; }
            .prescription-print .herb-list li { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dashed #ccc; font-size: 14px; }
            .prescription-print .herb-name { flex: 1; }
            .prescription-print .herb-dosage { width: 60px; text-align: right; }
            .prescription-print .herb-notes { width: 80px; text-align: right; color: #666; }
            .prescription-print .footer { margin-top: 16px; font-size: 14px; }
            .prescription-print .footer .row { display: flex; justify-content: space-between; margin-bottom: 6px; }
            .prescription-print .signature { margin-top: 32px; text-align: right; font-size: 14px; }
          </style>
        </head>
        <body>${printContent}</body>
      </html>
    `);
    win.document.close();
    win.print();
    win.close();
  };

  const herbs = prescription.items || [];
  const HERBS_PER_COLUMN = 10;
  const herbColumns: typeof herbs[] = [];
  for (let i = 0; i < herbs.length; i += HERBS_PER_COLUMN) {
    herbColumns.push(herbs.slice(i, i + HERBS_PER_COLUMN));
  }

  const doctorName = prescription.creator?.real_name || prescription.creator?.username || '';

  return (
    <>
      <Button icon={<PrinterOutlined />} size="small" onClick={handlePrint}>
        打印
      </Button>

      <div style={{ display: 'none' }}>
        <div ref={printRef}>
          <div className="prescription-print">
            <h2>处 方 笺</h2>
            <div className="subtitle">Prescription</div>

            <div className="info-row">
              <span>姓名：{patientName || '—'}</span>
              <span>年龄：{patientAge ? `${patientAge}岁` : '—'}</span>
              <span>日期：<span className="print-time"></span></span>
            </div>

            <div className="divider" />

            {prescription.formula_name && (
              <div style={{ fontSize: 14, marginBottom: 4 }}>
                方剂：{prescription.formula_name}
              </div>
            )}

            <div className="rp">Rp.</div>

            <div className="herb-columns">
              {herbColumns.map((column, colIdx) => (
                <div className="herb-column" key={colIdx}>
                  <ul className="herb-list">
                    {column.map((item) => (
                      <li key={item.id}>
                        <span className="herb-name">{item.herb_name}</span>
                        <span className="herb-dosage">{item.dosage}克</span>
                        <span className="herb-notes">{item.notes || ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="divider" />

            <div className="footer">
              <div className="row">
                <span>共 {prescription.total_doses} 付</span>
              </div>
              {prescription.notes && (
                <div style={{ marginTop: 4 }}>
                  <span>医嘱：</span>
                  {prescription.notes.split('\n').map((line, idx) => (
                    <div key={idx} style={{ paddingLeft: 42 }}>{line}</div>
                  ))}
                </div>
              )}
            </div>

            <div className="signature">
              医师：{doctorName}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
