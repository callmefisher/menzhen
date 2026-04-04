import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, List, Tag, Spin } from 'antd';
import { CalendarOutlined, NumberOutlined, FileTextOutlined, DollarOutlined } from '@ant-design/icons';
import { usePatientAuth } from '../../store/patientAuth';
import { listAppointments, listRecords } from '../../api/patientPortal';
import type { Appointment, MedicalRecord } from '../../api/patientPortal';

const QUICK_ACTIONS = [
  { icon: <CalendarOutlined style={{ fontSize: 24, color: '#52C41A' }} />, label: '在线预约', sub: '选医生选时段', path: '/patient/appointments', primary: true },
  { icon: <NumberOutlined style={{ fontSize: 24, color: '#1890ff' }} />, label: '快捷取号', sub: '到院后自助取号', path: '/patient/queue' },
  { icon: <FileTextOutlined style={{ fontSize: 24, color: '#722ed1' }} />, label: '我的病历', sub: '历次就诊记录', path: '/patient/records' },
  { icon: <DollarOutlined style={{ fontSize: 24, color: '#fa8c16' }} />, label: '收费明细', sub: '账单记录', path: '/patient/billing' },
];

export default function PatientHome() {
  const { user } = usePatientAuth();
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      listAppointments().catch(() => ({ data: [] as Appointment[] })),
      listRecords().catch(() => ({ data: [] as MedicalRecord[] })),
    ]).then(([apptRes, recRes]) => {
      setAppointments(apptRes.data.slice(0, 3));
      setRecords(recRes.data.slice(0, 3));
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spin /></div>;

  const upcomingAppt = appointments.find(a => a.status === 'pending');

  return (
    <div>
      <div style={{ background: 'linear-gradient(135deg, #52C41A, #389E0D)', padding: '16px 16px 24px', color: '#fff' }}>
        <div style={{ fontSize: 13, opacity: 0.85 }}>你好，</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{user?.name} 👋</div>
        {user?.patient_id && (
          <Tag style={{ marginTop: 6, background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', fontSize: 11 }}>
            🔗 档案已关联
          </Tag>
        )}
      </div>

      <div style={{ padding: '0 12px', marginTop: -12 }}>
        {upcomingAppt && (
          <Card size="small" style={{ marginBottom: 12, borderLeft: '3px solid #52C41A', cursor: 'pointer' }} onClick={() => navigate('/patient/appointments')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>📅</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{upcomingAppt.appoint_date} {upcomingAppt.slot_start} · {upcomingAppt.doctor_name}</div>
                <div style={{ fontSize: 12, color: '#888' }}>预约已确认，请准时到诊</div>
              </div>
              <span style={{ color: '#52C41A' }}>›</span>
            </div>
          </Card>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          {QUICK_ACTIONS.map((action) => (
            <Card key={action.path} size="small" hoverable onClick={() => navigate(action.path)}
              style={{ textAlign: 'center', background: action.primary ? 'linear-gradient(135deg, #f6ffed, #d9f7be)' : '#fff' }}>
              {action.icon}
              <div style={{ fontWeight: 600, marginTop: 4, fontSize: 13 }}>{action.label}</div>
              <div style={{ fontSize: 11, color: '#aaa' }}>{action.sub}</div>
            </Card>
          ))}
        </div>

        {records.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 8, textTransform: 'uppercase' }}>最近就诊</div>
            <List dataSource={records} renderItem={(r) => (
              <Card size="small" style={{ marginBottom: 8, borderLeft: '3px solid #52C41A', cursor: 'pointer' }} onClick={() => navigate(`/patient/records/${r.id}`)}>
                <div style={{ fontSize: 11, color: '#aaa' }}>{r.visit_date?.slice(0, 10)}</div>
                <div style={{ fontWeight: 600 }}>{r.diagnosis || '无诊断记录'}</div>
              </Card>
            )} />
          </>
        )}
      </div>
    </div>
  );
}
