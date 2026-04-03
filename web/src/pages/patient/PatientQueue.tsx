import { useEffect, useState } from 'react';
import { Card, Button, Select, message, Spin, Tag } from 'antd';
import { takeQueueNumber, getMyQueueStatus, listDoctors } from '../../api/patientPortal';
import type { Doctor, QueueEntry } from '../../api/patientPortal';

export default function PatientQueue() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<number | null>(null);
  const [myEntry, setMyEntry] = useState<{ queue_entry: QueueEntry; waiting_ahead: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [taking, setTaking] = useState(false);

  useEffect(() => {
    Promise.all([
      listDoctors().catch(() => ({ data: [] as Doctor[] })),
      (getMyQueueStatus() as Promise<{ data: { queue_entry: QueueEntry; waiting_ahead: number } | null }>).catch(() => ({ data: null })),
    ]).then(([docRes, statusRes]) => {
      setDoctors(docRes.data);
      setMyEntry(statusRes.data);
    }).finally(() => setLoading(false));
  }, []);

  const handleTake = async () => {
    if (!selectedDoctor) { message.warning('请先选择医生'); return; }
    setTaking(true);
    try {
      const res = await takeQueueNumber(selectedDoctor) as { data: { queue_entry: QueueEntry; waiting_ahead: number } };
      setMyEntry(res.data);
      message.success('取号成功！');
    } finally { setTaking(false); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;

  if (myEntry && (myEntry.queue_entry.status === 'waiting' || myEntry.queue_entry.status === 'seeing')) {
    const { queue_entry: e, waiting_ahead } = myEntry;
    return (
      <div style={{ padding: '20px 16px' }}>
        <div style={{ background: 'linear-gradient(135deg, #389E0D, #237804)', borderRadius: 16, padding: '24px 20px', color: '#fff', textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 13, opacity: 0.85 }}>您的号码</div>
          <div style={{ fontSize: 64, fontWeight: 900, lineHeight: 1 }}>{e.seq_number}</div>
          <div style={{ fontSize: 14 }}>{e.doctor_name} {e.room && `· ${e.room}`}</div>
          {e.status === 'seeing' && <Tag color="gold" style={{ marginTop: 8 }}>就诊中</Tag>}
        </div>
        <Card size="small" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span style={{ color: '#888' }}>前方等候</span><span style={{ fontWeight: 600 }}>{waiting_ahead} 人</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span style={{ color: '#888' }}>状态</span>
            <Tag color={e.status === 'seeing' ? 'gold' : 'blue'}>{e.status === 'seeing' ? '就诊中' : '等候中'}</Tag>
          </div>
        </Card>
        <Card size="small" style={{ background: '#f6ffed', border: '1px solid #d9f7be', textAlign: 'center', fontSize: 13, color: '#389E0D' }}>
          📢 叫到您时诊所将叫号，请在候诊区等待
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 16px' }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>快捷取号</div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12, color: '#888', fontSize: 13 }}>选择就诊医生</div>
        <Select style={{ width: '100%' }} placeholder="请选择医生" onChange={setSelectedDoctor}
          options={doctors.map(d => ({ value: d.id, label: `${d.doctor_name}${d.room ? ` · ${d.room}` : ''}` }))} />
      </Card>
      <Button type="primary" block size="large" onClick={handleTake} loading={taking}
        style={{ background: '#52C41A', borderColor: '#52C41A', height: 52, fontSize: 16, borderRadius: 10 }}>
        🎫 立即取号入队
      </Button>
      <div style={{ textAlign: 'center', color: '#aaa', fontSize: 12, marginTop: 12 }}>请确认已到达诊所后再取号</div>
    </div>
  );
}
