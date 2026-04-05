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
  Modal,
} from 'antd';
import { PlusOutlined, SearchOutlined, LeftOutlined, RightOutlined, CalendarOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import { listAppointments, cancelAppointment, deleteAppointment, enqueueToday, type Appointment } from '../../api/appointment';
import { listQueueDoctors, type QueueDoctor } from '../../api/queue-doctor';
import AppointmentModal from '../../components/AppointmentModal';
import AppointmentMatrix from '../../components/AppointmentMatrix';
import { useWebSocket } from '../../hooks/useWebSocket';

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  pending:   { color: 'blue',    label: '待签到' },
  queued:    { color: 'orange',  label: '已入队' },
  cancelled: { color: 'default', label: '已取消' },
  no_show:   { color: 'red',     label: '未到诊' },
};

export default function AppointmentManage() {
  const [selectedDate, setSelectedDate] = useState<Dayjs>(() => dayjs().add(1, 'day'));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState<Record<number, boolean>>({});
  const [deleteLoading, setDeleteLoading] = useState<Record<number, boolean>>({});
  const [enqueueLoading, setEnqueueLoading] = useState(false);
  const [doctorFilter, setDoctorFilter] = useState('');
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | undefined>(undefined);
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

  // Refresh appointment list when an appointment is created or cancelled via WebSocket.
  const refreshList = useCallback(() => { fetchAppointments(selectedDate); }, [fetchAppointments, selectedDate]);
  useWebSocket('appt_created', refreshList);
  useWebSocket('appt_cancelled', refreshList);
  useWebSocket('appt_deleted', refreshList);

  const handleEnqueueToday = useCallback(async () => {
    setEnqueueLoading(true);
    try {
      const res = await enqueueToday();
      const body = res as unknown as { data?: { enqueued?: number; failed?: number[] } };
      const n = body.data?.enqueued ?? 0;
      message.success(n > 0 ? `已入队 ${n} 名患者` : '无待入队预约');
      fetchAppointments(selectedDate);
    } catch {
      message.error('入队失败，请重试');
    } finally {
      setEnqueueLoading(false);
    }
  }, [fetchAppointments, selectedDate]);

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

  const handleDelete = useCallback(
    async (id: number) => {
      setDeleteLoading((prev) => ({ ...prev, [id]: true }));
      try {
        await deleteAppointment(id);
        message.success('预约已删除');
        fetchAppointments(selectedDate);
      } catch {
        message.error('删除失败，请重试');
      } finally {
        setDeleteLoading((prev) => ({ ...prev, [id]: false }));
      }
    },
    [fetchAppointments, selectedDate],
  );

  const handleMatrixDateChange = useCallback((date: Dayjs, doctorId?: number) => {
    setSelectedDate(date);
    setSelectedDoctorId(doctorId);
    setDoctorFilter('');
  }, []);

  const filteredAppointments = useMemo(() => {
    let result = appointments;
    if (selectedDoctorId !== undefined) {
      result = result.filter((a) => a.doctor_id === selectedDoctorId);
    } else if (doctorFilter.trim()) {
      const lower = doctorFilter.trim().toLowerCase();
      result = result.filter((a) => a.doctor_name.toLowerCase().includes(lower));
    }
    return result;
  }, [appointments, doctorFilter, selectedDoctorId]);

  const columns = useMemo<ColumnsType<Appointment>>(
    () => [
      {
        title: '时间',
        key: 'slot',
        width: 100,
        render: (_: unknown, r: Appointment) => (
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, whiteSpace: 'nowrap' }}>
            {r.slot_start}–{r.slot_end}
          </span>
        ),
      },
      {
        title: '患者',
        dataIndex: 'patient_name',
        key: 'patient_name',
        ellipsis: true,
      },
      {
        title: '医生 / 诊室',
        key: 'doctor_room',
        ellipsis: true,
        render: (_: unknown, r: Appointment) => (
          <span>
            {r.doctor_name}
            {r.room && <span style={{ color: '#999', fontSize: 12, marginLeft: 4 }}>·{r.room}</span>}
          </span>
        ),
      },
      {
        title: '状态',
        key: 'status',
        width: 80,
        render: (_: unknown, r: Appointment) => {
          const s = STATUS_MAP[r.status] ?? { color: 'default', label: r.status };
          return <Tag color={s.color} style={{ marginInlineEnd: 0 }}>{s.label}</Tag>;
        },
      },
      {
        title: '操作',
        key: 'action',
        width: 120,
        render: (_: unknown, r: Appointment) => {
          if (r.status === 'pending' || r.status === 'queued') {
            return (
              <Space size={4}>
                {r.status === 'pending' && (
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: '0 4px' }}
                    onClick={() => { setEditingAppointment(r); setModalOpen(true); }}
                  >
                    编辑
                  </Button>
                )}
                <Button
                  type="link"
                  danger
                  size="small"
                  style={{ padding: '0 4px' }}
                  loading={cancelLoading[r.id]}
                  onClick={() =>
                    Modal.confirm({
                      title: '确认取消预约',
                      content: r.status === 'queued'
                        ? '该预约已入队，取消后将从队列中移除，确认取消？'
                        : `确认取消 ${r.patient_name} 的预约？`,
                      okText: '确认取消',
                      cancelText: '返回',
                      okButtonProps: { danger: true },
                      onOk: () => handleCancel(r.id),
                    })
                  }
                >
                  取消
                </Button>
              </Space>
            );
          }
          if (r.status === 'cancelled' || r.status === 'no_show') {
            return (
              <Button
                type="link"
                danger
                size="small"
                style={{ padding: '0 4px' }}
                loading={deleteLoading[r.id]}
                onClick={() =>
                  Modal.confirm({
                    title: '确认删除预约',
                    content: '删除后不可恢复，确认删除？',
                    okText: '确认删除',
                    cancelText: '返回',
                    okButtonProps: { danger: true },
                    onOk: () => handleDelete(r.id),
                  })
                }
              >
                删除
              </Button>
            );
          }
          return null;
        },
      },
    ],
    [cancelLoading, deleteLoading, handleCancel, handleDelete],
  );

  const isToday = selectedDate.isSame(dayjs(), 'day');
  const isTomorrow = selectedDate.isSame(dayjs().add(1, 'day'), 'day');

  const pendingCount = useMemo(
    () => appointments.filter((a) => a.status === 'pending' || a.status === 'queued').length,
    [appointments],
  );

  return (
    <div style={{ maxWidth: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>预约管理</Typography.Title>
        <Space>
          {isToday && appointments.some(a => a.status === 'pending') && (
            <Button
              loading={enqueueLoading}
              onClick={handleEnqueueToday}
            >
              立即入队
            </Button>
          )}
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => { setEditingAppointment(null); setModalOpen(true); }}
          >
            新建预约
          </Button>
        </Space>
      </div>

      {/* Matrix overview */}
      <AppointmentMatrix
        selectedDate={selectedDate}
        onDateChange={handleMatrixDateChange}
      />

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '10px 12px', background: '#fafafa', borderRadius: 8, marginBottom: 12,
        border: '1px solid #f0f0f0',
      }}>
        {/* Date navigator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <Button
            size="small"
            icon={<LeftOutlined />}
            onClick={() => setSelectedDate((d) => d.subtract(1, 'day'))}
          />
          <DatePicker
            value={selectedDate}
            onChange={(d) => { if (d) setSelectedDate(d); }}
            allowClear={false}
            style={{ width: 130 }}
            format="MM月DD日"
            size="small"
          />
          <Button
            size="small"
            icon={<RightOutlined />}
            onClick={() => setSelectedDate((d) => d.add(1, 'day'))}
          />
          {!isToday && !isTomorrow && (
            <Button
              size="small"
              icon={<CalendarOutlined />}
              onClick={() => setSelectedDate(dayjs().add(1, 'day'))}
            >
              明天
            </Button>
          )}
        </div>

        {/* Date label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ color: '#666', fontSize: 13 }}>
            {selectedDate.format('YYYY年MM月DD日')}
          </span>
          {isToday && <Tag color="green" style={{ marginInlineEnd: 0 }}>今天</Tag>}
          {isTomorrow && <Tag color="blue" style={{ marginInlineEnd: 0 }}>明天</Tag>}
          {pendingCount > 0 && (
            <Tag color="blue" style={{ marginInlineEnd: 0 }}>待诊 {pendingCount}</Tag>
          )}
        </div>

        {/* Doctor filter */}
        <Input
          allowClear
          placeholder="按医生筛选"
          prefix={<SearchOutlined />}
          value={doctorFilter}
          onChange={(e) => { setDoctorFilter(e.target.value); setSelectedDoctorId(undefined); }}
          style={{ width: 140, marginLeft: 'auto' }}
          size="small"
        />
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <Table<Appointment>
          rowKey="id"
          loading={loading}
          dataSource={filteredAppointments}
          columns={columns}
          pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
          locale={{ emptyText: '暂无预约' }}
          size="small"
          scroll={{ x: 480 }}
        />
      </div>

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
