import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Table,
  Button,
  Input,
  Tag,
  Space,
  Typography,
  message,
  DatePicker,
  Badge,
} from 'antd';
import { PlusOutlined, SearchOutlined, LeftOutlined, RightOutlined, CalendarOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import { listAppointments, cancelAppointment, type Appointment } from '../../api/appointment';
import { listQueueDoctors, type QueueDoctor } from '../../api/queue-doctor';
import AppointmentModal from '../../components/AppointmentModal';

const { Title } = Typography;

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  pending:   { color: 'blue',    label: '待签到' },
  queued:    { color: 'orange',  label: '已入队' },
  cancelled: { color: 'default', label: '已取消' },
  no_show:   { color: 'red',     label: '未到诊' },
};

export default function AppointmentManage() {
  const [selectedDate, setSelectedDate] = useState<Dayjs>(() => dayjs());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState<Record<number, boolean>>({});
  const [doctorFilter, setDoctorFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [doctors, setDoctors] = useState<QueueDoctor[]>([]);

  const fetchAppointments = useCallback(async (date: Dayjs) => {
    setLoading(true);
    try {
      const res = await listAppointments(date.format('YYYY-MM-DD'));
      const body = res as unknown as { data?: { list?: Appointment[] } };
      setAppointments(body.data?.list ?? []);
    } catch {
      message.error('加载预约失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAppointments(selectedDate);
  }, [selectedDate, fetchAppointments]);

  useEffect(() => {
    (async () => {
      try {
        const res = await listQueueDoctors();
        const body = res as unknown as { data?: { list?: QueueDoctor[] } };
        setDoctors((body.data?.list ?? []).filter(d => d.enabled));
      } catch {
        // non-critical, modal will still work
      }
    })();
  }, []);

  const handleCancel = useCallback(
    async (id: number) => {
      setCancelLoading((prev) => ({ ...prev, [id]: true }));
      try {
        await cancelAppointment(id);
        message.success('预约已取消');
        fetchAppointments(selectedDate);
      } catch {
        message.error('取消失败，请重试');
      } finally {
        setCancelLoading((prev) => ({ ...prev, [id]: false }));
      }
    },
    [fetchAppointments, selectedDate],
  );

  const filteredAppointments = useMemo(() => {
    if (!doctorFilter.trim()) return appointments;
    const lower = doctorFilter.trim().toLowerCase();
    return appointments.filter((a) => a.doctor_name.toLowerCase().includes(lower));
  }, [appointments, doctorFilter]);

  const columns = useMemo<ColumnsType<Appointment>>(
    () => [
      {
        title: '时间段',
        key: 'slot',
        width: 120,
        render: (_: unknown, r: Appointment) => (
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
            {r.slot_start}–{r.slot_end}
          </span>
        ),
      },
      {
        title: '患者姓名',
        dataIndex: 'patient_name',
        key: 'patient_name',
      },
      {
        title: '就诊医生',
        dataIndex: 'doctor_name',
        key: 'doctor_name',
      },
      {
        title: '诊室',
        dataIndex: 'room',
        key: 'room',
        render: (v: string) => v || '-',
      },
      {
        title: '状态',
        key: 'status',
        width: 100,
        render: (_: unknown, r: Appointment) => {
          const s = STATUS_MAP[r.status] ?? { color: 'default', label: r.status };
          return <Tag color={s.color}>{s.label}</Tag>;
        },
      },
      {
        title: '操作',
        key: 'action',
        width: 140,
        render: (_: unknown, r: Appointment) =>
          r.status === 'pending' ? (
            <Space size="small">
              <Button
                size="small"
                onClick={() => { setEditingAppointment(r); setModalOpen(true); }}
              >
                编辑
              </Button>
              <Button
                danger
                size="small"
                loading={cancelLoading[r.id]}
                onClick={() => handleCancel(r.id)}
              >
                取消
              </Button>
            </Space>
          ) : null,
      },
    ],
    [cancelLoading, handleCancel],
  );

  const isToday = selectedDate.isSame(dayjs(), 'day');

  const pendingCount = useMemo(
    () => appointments.filter((a) => a.status === 'pending' || a.status === 'queued').length,
    [appointments],
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>预约管理</Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => { setEditingAppointment(null); setModalOpen(true); }}
        >
          新建预约
        </Button>
      </div>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '12px 16px', background: '#fafafa', borderRadius: 8, marginBottom: 16,
        border: '1px solid #f0f0f0',
      }}>
        {/* Date navigator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Button
            size="small"
            icon={<LeftOutlined />}
            onClick={() => setSelectedDate((d) => d.subtract(1, 'day'))}
          />
          <DatePicker
            value={selectedDate}
            onChange={(d) => { if (d) setSelectedDate(d); }}
            allowClear={false}
            style={{ width: 140 }}
            format="YYYY年MM月DD日"
          />
          <Button
            size="small"
            icon={<RightOutlined />}
            onClick={() => setSelectedDate((d) => d.add(1, 'day'))}
          />
          {!isToday && (
            <Button
              size="small"
              icon={<CalendarOutlined />}
              onClick={() => setSelectedDate(dayjs())}
            >
              今天
            </Button>
          )}
        </div>

        {/* Doctor filter */}
        <Input
          allowClear
          placeholder="按医生姓名筛选"
          prefix={<SearchOutlined />}
          value={doctorFilter}
          onChange={(e) => setDoctorFilter(e.target.value)}
          style={{ width: 200 }}
          size="middle"
        />

        {/* Date summary */}
        <Space style={{ marginLeft: 'auto' }}>
          <span style={{ color: '#666', fontSize: 14 }}>
            {selectedDate.format('YYYY年MM月DD日')}
            {isToday && <Tag color="green" style={{ marginLeft: 6 }}>今天</Tag>}
          </span>
          {pendingCount > 0 && (
            <Badge count={pendingCount} color="#1677ff" overflowCount={99}>
              <span style={{ fontSize: 13, color: '#666' }}>待诊</span>
            </Badge>
          )}
        </Space>
      </div>

      {/* Table */}
      <Table<Appointment>
        rowKey="id"
        loading={loading}
        dataSource={filteredAppointments}
        columns={columns}
        pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
        locale={{ emptyText: '暂无预约' }}
        size="middle"
      />

      <AppointmentModal
        open={modalOpen}
        doctorOptions={doctors.map(d => ({ id: d.id, name: d.user_name, room: d.room }))}
        initialValues={editingAppointment ? {
          id: editingAppointment.id,
          patient_name: editingAppointment.patient_name,
          patient_id: editingAppointment.patient_id,
          doctor_id: editingAppointment.doctor_id,
          doctor_name: editingAppointment.doctor_name,
          room: editingAppointment.room,
          appoint_date: editingAppointment.appoint_date,
          slot_start: editingAppointment.slot_start,
          slot_end: editingAppointment.slot_end,
        } : undefined}
        onSuccess={() => fetchAppointments(selectedDate)}
        onClose={() => { setModalOpen(false); setEditingAppointment(null); }}
      />
    </div>
  );
}
