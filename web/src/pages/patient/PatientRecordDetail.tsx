import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Tag, Spin, Button, Divider } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { getRecord } from '../../api/patientPortal';

interface PrescriptionItem {
  herb_name: string;
  dosage: string;
  unit: string;
}
interface Prescription {
  id: number;
  type: string;
  doses: number;
  instructions: string;
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

export default function PatientRecordDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<RecordDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getRecord(Number(id))
      .then((res: unknown) => setData((res as { data: RecordDetail }).data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;
  if (!data) return <div style={{ padding: 20, color: '#888' }}>记录不存在</div>;

  const { record, prescriptions } = data;

  return (
    <div style={{ padding: '12px' }}>
      <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ marginBottom: 12 }}>返回</Button>
      <Card size="small" style={{ marginBottom: 12 }}>
        <div style={{ color: '#888', fontSize: 12 }}>{record.visit_date?.slice(0, 10)}</div>
        <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>{record.diagnosis}</div>
        {record.chief_complaint && <div style={{ marginTop: 6 }}><Tag color="blue">主诉</Tag> {record.chief_complaint}</div>}
        {record.treatment && <div style={{ marginTop: 6 }}><Tag color="green">治法</Tag> {record.treatment}</div>}
        {record.notes && <div style={{ marginTop: 6, color: '#888', fontSize: 13 }}>{record.notes}</div>}
      </Card>
      {prescriptions.map((p) => (
        <Card key={p.id} size="small" title={`处方 ${p.type === 'herb' ? '草药' : '中成药'}`} style={{ marginBottom: 10 }}>
          {p.doses > 0 && <div style={{ marginBottom: 6, color: '#888', fontSize: 12 }}>共 {p.doses} 付</div>}
          {p.items.map((item, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #f5f5f5' }}>
              <span>{item.herb_name}</span><span style={{ color: '#888' }}>{item.dosage}{item.unit}</span>
            </div>
          ))}
          {p.instructions && (<><Divider style={{ margin: '8px 0' }} /><div style={{ fontSize: 12, color: '#888' }}>医嘱：{p.instructions}</div></>)}
        </Card>
      ))}
    </div>
  );
}
