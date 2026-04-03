import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { List, Card, Empty, Spin } from 'antd';
import { listRecords } from '../../api/patientPortal';
import type { MedicalRecord } from '../../api/patientPortal';

export default function PatientRecords() {
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    listRecords().then((res) => setRecords(res.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;

  return (
    <div style={{ padding: '16px 12px' }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>我的病历</div>
      {records.length === 0 ? <Empty description="暂无就诊记录" /> : (
        <List dataSource={records} renderItem={(r) => (
          <Card key={r.id} size="small" hoverable style={{ marginBottom: 10, borderLeft: '3px solid #52C41A', cursor: 'pointer' }} onClick={() => navigate(`/patient/records/${r.id}`)}>
            <div style={{ fontSize: 12, color: '#aaa' }}>{r.visit_date?.slice(0, 10)}</div>
            <div style={{ fontWeight: 600, marginTop: 2 }}>{r.diagnosis || '无诊断记录'}</div>
            {r.chief_complaint && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>主诉：{r.chief_complaint}</div>}
          </Card>
        )} />
      )}
    </div>
  );
}
