import { useEffect, useState } from 'react';
import { List, Card, Tag, Button, Modal, Select, DatePicker, message, Empty, Spin } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { listAppointments, listDoctors, getAppointmentSlots, createAppointment, cancelAppointment, checkinAppointment, getDoctorSchedule } from '../../api/patientPortal';
import type { Appointment, Doctor, SlotInfo } from '../../api/patientPortal';

/** Returns a disabledDate predicate from doctor's schedule config.
 *  bit0=Sun, bit1=Mon, ..., bit6=Sat.  weekdays=0 means no restriction. */
function makePatientDisabledDate(weekdays: number, rangeStart: number, rangeEnd: number) {
  return (d: Dayjs) => {
    const today = dayjs();
    // Allow today when range_start=0; otherwise require d to be after today.
    if (rangeStart > 0 && !d.isAfter(today, 'day')) return true;
    if (rangeStart === 0 && d.isBefore(today, 'day')) return true;
    if (d.isBefore(today.add(rangeStart, 'day'), 'day')) return true;
    if (d.isAfter(today.add(rangeEnd, 'day'), 'day')) return true;
    if (weekdays !== 0) {
      const dow = d.day(); // 0=Sun, 1=Mon, ..., 6=Sat
      if (!((weekdays >> dow) & 1)) return true;
    }
    return false;
  };
}

export default function PatientAppointment() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedDoctor, setSelectedDoctor] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<SlotInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [checkinLoading, setCheckinLoading] = useState<Record<number, boolean>>({});
  const [scheduleConfig, setScheduleConfig] = useState({ weekdays: 0, range_start: 1, range_end: 30 });

  const fetchData = () => {
    setLoading(true);
    Promise.all([listAppointments(), listDoctors()]).then(([apptRes, docRes]) => {
      setAppointments(apptRes.data);
      setDoctors(docRes.data);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (selectedDoctor && selectedDate) {
      setSlotsLoading(true);
      getAppointmentSlots(selectedDoctor, selectedDate)
        .then((res) => setSlots(res.data))
        .catch(() => setSlots([]))
        .finally(() => setSlotsLoading(false));
    }
  }, [selectedDoctor, selectedDate]);

  // Load doctor schedule when doctor changes, reset date/slot to avoid invalid selections.
  useEffect(() => {
    if (!selectedDoctor) return;
    setSelectedDate(null);
    setSelectedSlot(null);
    setSlots([]);
    getDoctorSchedule(selectedDoctor)
      .then((res) => {
        const d = res.data;
        setScheduleConfig({ weekdays: d.weekdays, range_start: d.range_start, range_end: d.range_end });
      })
      .catch(() => setScheduleConfig({ weekdays: 0, range_start: 1, range_end: 30 }));
  }, [selectedDoctor]);

  const handleBook = async () => {
    if (!selectedDoctor || !selectedDate || !selectedSlot) { message.warning('请选择医生、日期和时段'); return; }
    setSubmitting(true);
    try {
      await createAppointment({ doctor_id: selectedDoctor, appoint_date: selectedDate, slot_start: selectedSlot.slot_start, slot_end: selectedSlot.slot_end });
      message.success('预约成功');
      setModalOpen(false);
      setSelectedDoctor(null); setSelectedDate(null); setSelectedSlot(null); setSlots([]);
      fetchData();
    } catch (err: unknown) {
      const errMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(errMsg ?? '预约失败，请稍后重试');
    } finally { setSubmitting(false); }
  };

  const handleCheckin = async (id: number) => {
    setCheckinLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await checkinAppointment(id);
      message.success('签到成功，已加入队列');
      fetchData();
    } catch (err: unknown) {
      const errMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(errMsg ?? '签到失败，请稍后重试');
    } finally {
      setCheckinLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const today = dayjs().format('YYYY-MM-DD');
  const statusColor: Record<string, string> = { pending: 'blue', queued: 'green', cancelled: 'default', no_show: 'red' };
  const statusLabel: Record<string, string> = { pending: '已预约', queued: '已入队', cancelled: '已取消', no_show: '未到' };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;

  return (
    <div style={{ padding: '16px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>我的预约</div>
        <Button type="primary" onClick={() => setModalOpen(true)} style={{ background: '#52C41A', borderColor: '#52C41A' }}>+ 新建预约</Button>
      </div>

      {appointments.length === 0 ? <Empty description="暂无预约记录" /> : (
        <List dataSource={appointments} renderItem={(a) => (
          <Card size="small" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{a.appoint_date} {a.slot_start}–{a.slot_end}</div>
                <div style={{ color: '#888', fontSize: 13 }}>{a.doctor_name} · {a.room}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <Tag color={statusColor[a.status]}>{statusLabel[a.status] ?? a.status}</Tag>
                {(a.status === 'pending' || a.status === 'queued') && a.appoint_date === today && a.checkin_status !== 'done' && (
                  <Button size="small" type="primary"
                    style={{ background: '#52C41A', borderColor: '#52C41A' }}
                    loading={checkinLoading[a.id]}
                    onClick={() => handleCheckin(a.id)}>
                    签到
                  </Button>
                )}
                {a.status === 'pending' && (
                  <Button size="small" danger onClick={() =>
                    cancelAppointment(a.id)
                      .then(() => { message.success('已取消'); fetchData(); })
                      .catch(() => message.error('取消失败，请重试'))
                  }>取消</Button>
                )}
              </div>
            </div>
          </Card>
        )} />
      )}

      <Modal title="新建预约" open={modalOpen} onOk={handleBook}
        onCancel={() => { setModalOpen(false); setSelectedDoctor(null); setSelectedDate(null); setSelectedSlot(null); setSlots([]); }}
        okText="确认预约" confirmLoading={submitting}
        okButtonProps={{ style: { background: '#52C41A', borderColor: '#52C41A' } }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
          <Select placeholder="选择医生" style={{ width: '100%' }} onChange={setSelectedDoctor}
            options={doctors.map(d => ({ value: d.id, label: `${d.doctor_name}${d.room ? ` · ${d.room}` : ''}` }))} />
          <DatePicker style={{ width: '100%' }}
            getPopupContainer={(trigger) => trigger.parentElement ?? document.body}
            disabledDate={makePatientDisabledDate(scheduleConfig.weekdays, scheduleConfig.range_start, scheduleConfig.range_end)}
            onChange={(_, ds) => { setSelectedDate(ds as string); setSelectedSlot(null); }} />
          {selectedDoctor && selectedDate && slotsLoading && (
            <div style={{ textAlign: 'center', padding: '12px 0' }}><Spin size="small" /></div>
          )}
          {selectedDoctor && selectedDate && !slotsLoading && slots.length === 0 && (
            <div style={{ textAlign: 'center', color: '#aaa', fontSize: 13, padding: '12px 0' }}>
              该日期暂无可用时段
            </div>
          )}
          {slots.length > 0 && !slotsLoading && (
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>选择时段</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                {slots.map((s) => (
                  <div key={s.slot_start} onClick={() => s.available && setSelectedSlot(s)}
                    style={{
                      border: `1px solid ${!s.available ? '#e8e8e8' : selectedSlot?.slot_start === s.slot_start ? '#52C41A' : '#b7eb8f'}`,
                      borderRadius: 6, padding: '6px 4px', textAlign: 'center',
                      background: !s.available ? '#f5f5f5' : selectedSlot?.slot_start === s.slot_start ? '#52C41A' : '#f6ffed',
                      color: !s.available ? '#ccc' : selectedSlot?.slot_start === s.slot_start ? '#fff' : '#389E0D',
                      cursor: s.available ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 600,
                    }}>
                    {s.slot_start}<br />
                    <span style={{ fontSize: 10, fontWeight: 400 }}>{!s.available ? '已满' : `剩${s.max_count - s.booked_count}位`}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
