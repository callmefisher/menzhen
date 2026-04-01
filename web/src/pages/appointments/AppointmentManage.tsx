import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Row,
  Col,
  Calendar,
  Table,
  Button,
  Input,
  Tag,
  Space,
  Typography,
  message,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import type { CellRenderInfo } from '@rc-component/picker/interface';
import { listAppointments, cancelAppointment, type Appointment } from '../../api/appointment';

const { Title } = Typography;

export default function AppointmentManage() {
  const [selectedDate, setSelectedDate] = useState<string>(() => dayjs().format('YYYY-MM-DD'));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState<Record<number, boolean>>({});
  const [doctorFilter, setDoctorFilter] = useState('');

  const fetchAppointments = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const res = await listAppointments(date);
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

  const cellRender = useCallback(
    (date: Dayjs, info: CellRenderInfo<Dayjs>) => {
      if (info.type !== 'date') return info.originNode;
      const dateStr = date.format('YYYY-MM-DD');
      const hasAppts = appointments.some(
        (a) => a.appoint_date === dateStr && a.status !== 'cancelled',
      );
      if (!hasAppts) return null;
      return (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 2 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#52C41A',
              display: 'block',
            }}
          />
        </div>
      );
    },
    [appointments],
  );
  // Note: dots only show for the currently loaded date (selectedDate).
  // Pre-fetching the full month would require N API calls; this is a known product limitation.

  const columns = useMemo<ColumnsType<Appointment>>(
    () => [
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
        title: '时间段',
        key: 'slot',
        render: (_: unknown, r: Appointment) => `${r.slot_start}–${r.slot_end}`,
      },
      {
        title: '状态',
        key: 'status',
        render: (_: unknown, r: Appointment) => {
          const map: Record<string, { color: string; label: string }> = {
            pending: { color: 'blue', label: '待签到' },
            queued: { color: 'orange', label: '已入队' },
            cancelled: { color: 'default', label: '已取消' },
            no_show: { color: 'red', label: '未到诊' },
          };
          const s = map[r.status] ?? { color: 'default', label: r.status };
          return <Tag color={s.color}>{s.label}</Tag>;
        },
      },
      {
        title: '操作',
        key: 'action',
        render: (_: unknown, r: Appointment) =>
          r.status === 'pending' ? (
            <Button
              danger
              size="small"
              loading={cancelLoading[r.id]}
              onClick={() => handleCancel(r.id)}
            >
              取消
            </Button>
          ) : null,
      },
    ],
    [cancelLoading, handleCancel],
  );

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>
        预约管理
      </Title>
      <Row gutter={16}>
        {/* Left: mini calendar */}
        <Col span={6}>
          <Calendar
            fullscreen={false}
            value={dayjs(selectedDate)}
            cellRender={cellRender}
            onSelect={(date) => {
              setSelectedDate(date.format('YYYY-MM-DD'));
            }}
          />
        </Col>

        {/* Right: filters + table */}
        <Col span={18}>
          <Space style={{ marginBottom: 12 }}>
            <span style={{ color: '#666' }}>
              {dayjs(selectedDate).format('YYYY年MM月DD日')} 预约列表
            </span>
            <Input
              allowClear
              placeholder="按医生姓名筛选"
              prefix={<SearchOutlined />}
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              style={{ width: 200 }}
            />
          </Space>
          <Table<Appointment>
            rowKey="id"
            loading={loading}
            dataSource={filteredAppointments}
            columns={columns}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            locale={{ emptyText: '暂无预约' }}
          />
        </Col>
      </Row>
    </div>
  );
}
