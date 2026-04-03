import { useEffect, useState, useCallback } from 'react';
import { Card, Button, Select, message, Spin, Tag } from 'antd';
import { takeQueueNumber, getMyQueueStatus, listDoctors, listPatientQueue } from '../../api/patientPortal';
import type { Doctor, QueueEntry } from '../../api/patientPortal';

export default function PatientQueue() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<number | null>(null);
  const [myEntry, setMyEntry] = useState<{ queue_entry: QueueEntry; waiting_ahead: number } | null>(null);
  const [queueList, setQueueList] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [taking, setTaking] = useState(false);

  const fetchStatus = useCallback(() => {
    return (getMyQueueStatus() as Promise<{ data: { queue_entry: QueueEntry; waiting_ahead: number } | null }>)
      .catch(() => ({ data: null }))
      .then((statusRes) => {
        setMyEntry(statusRes.data);
        return statusRes.data;
      });
  }, []);

  useEffect(() => {
    Promise.all([
      listDoctors().catch(() => ({ data: [] as Doctor[] })),
      fetchStatus(),
    ]).then(([docRes]) => {
      setDoctors(docRes.data);
    }).finally(() => setLoading(false));
  }, [fetchStatus]);

  // When we have an active queue entry, fetch the full queue for that doctor.
  useEffect(() => {
    if (myEntry && (myEntry.queue_entry.status === 'waiting' || myEntry.queue_entry.status === 'seeing')) {
      listPatientQueue(myEntry.queue_entry.doctor_id)
        .then((res) => setQueueList(res.data))
        .catch(() => setQueueList([]));
    } else {
      setQueueList([]);
    }
  }, [myEntry]);

  const handleTake = async () => {
    if (!selectedDoctor) { message.warning('请先选择医生'); return; }
    setTaking(true);
    try {
      const res = await takeQueueNumber(selectedDoctor) as { data: { queue_entry: QueueEntry; waiting_ahead: number } };
      setMyEntry(res.data);
      message.success('取号成功！');
    } catch (err: unknown) {
      const errData = (err as { response?: { data?: { code?: number; message?: string } } })?.response?.data;
      if (errData?.code === 409) {
        message.warning(errData.message ?? '您今日已在排队中');
        // Refresh status to show their existing entry
        await fetchStatus();
      } else {
        message.error('取号失败，请稍后重试');
      }
    } finally { setTaking(false); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;

  if (myEntry && (myEntry.queue_entry.status === 'waiting' || myEntry.queue_entry.status === 'seeing')) {
    const { queue_entry: e, waiting_ahead } = myEntry;
    return (
      <div style={{ padding: '20px 16px' }}>
        {/* My queue card */}
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
        <Card size="small" style={{ background: '#f6ffed', border: '1px solid #d9f7be', textAlign: 'center', fontSize: 13, color: '#389E0D', marginBottom: 16 }}>
          📢 叫到您时诊所将叫号，请在候诊区等待
        </Card>

        {/* Full queue list */}
        {queueList.length > 0 && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: '#333' }}>
              {e.doctor_name} 候诊队列
            </div>
            {queueList.map((entry, idx) => {
              const isMe = entry.id === e.id;
              const isSeeing = entry.status === 'seeing';
              const borderColor = isMe ? '#52C41A' : isSeeing ? '#faad14' : '#1677ff';
              const bg = isMe ? '#f6ffed' : isSeeing ? '#fff7e6' : '#f0f7ff';
              return (
                <div key={entry.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px',
                  background: bg,
                  borderLeft: `4px solid ${borderColor}`,
                  borderRadius: '0 10px 10px 0',
                  marginBottom: 6,
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                    background: isMe ? 'linear-gradient(135deg, #52C41A, #389E0D)' : isSeeing ? 'linear-gradient(135deg, #ffa940, #fa8c16)' : 'linear-gradient(135deg, #4096ff, #1677ff)',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 800,
                  }}>
                    {String(entry.seq_number).padStart(2, '0')}
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: isMe ? 700 : 500, fontSize: 15 }}>
                      {isMe ? entry.patient_name : `${entry.patient_name.charAt(0)}${'*'.repeat(Math.max(0, entry.patient_name.length - 1))}`}
                    </span>
                  </div>
                  {isMe && (
                    <Tag color="green" style={{ fontWeight: 700 }}>我</Tag>
                  )}
                  {isSeeing && !isMe && (
                    <Tag color="orange">就诊中</Tag>
                  )}
                  <span style={{ fontSize: 11, color: '#999' }}>#{idx + 1}</span>
                </div>
              );
            })}
          </div>
        )}
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
