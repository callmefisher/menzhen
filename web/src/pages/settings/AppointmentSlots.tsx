import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Card, Table, Button, Modal, Form, Select, InputNumber, TimePicker, Space, message, Typography, Empty, Spin, Tag
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import {
  listSlotConfigs, createSlotConfig, updateSlotConfig, deleteSlotConfig, type SlotConfig
} from '../../api/appointmentSlot';
import { listQueueDoctors, type QueueDoctor } from '../../api/queue-doctor';

const { Title } = Typography;

export default function AppointmentSlots() {
  const [doctors, setDoctors] = useState<QueueDoctor[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | undefined>();
  const [slots, setSlots] = useState<SlotConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<SlotConfig | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [form] = Form.useForm();

  // Load doctors on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await listQueueDoctors();
        const body = res as unknown as { data?: { list?: QueueDoctor[] } };
        const list = (body.data?.list ?? []).filter(d => d.enabled);
        setDoctors(list);
        if (list.length > 0) setSelectedDoctorId(list[0].user_id);
      } catch {
        message.error('加载医生列表失败');
      }
    })();
  }, []);

  const fetchSlots = useCallback(async (doctorId: number) => {
    setLoading(true);
    try {
      const res = await listSlotConfigs(doctorId);
      const body = res as unknown as { data?: { list?: SlotConfig[] } };
      setSlots(body.data?.list ?? []);
    } catch {
      message.error('加载时间段失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedDoctorId) fetchSlots(selectedDoctorId);
  }, [selectedDoctorId, fetchSlots]);

  const handleAdd = useCallback(() => {
    setEditingSlot(null);
    form.resetFields();
    form.setFieldsValue({ max_count: 10 });
    setModalOpen(true);
  }, [form]);

  const handleEdit = useCallback((slot: SlotConfig) => {
    setEditingSlot(slot);
    form.setFieldsValue({
      slot_start: dayjs(slot.slot_start, 'HH:mm'),
      slot_end: dayjs(slot.slot_end, 'HH:mm'),
      max_count: slot.max_count,
    });
    setModalOpen(true);
  }, [form]);

  const handleDelete = useCallback((slot: SlotConfig) => {
    Modal.confirm({
      title: '确认删除',
      content: `删除时间段 ${slot.slot_start}–${slot.slot_end}？`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteSlotConfig(slot.id);
          message.success('已删除');
          if (selectedDoctorId) fetchSlots(selectedDoctorId);
        } catch {
          message.error('删除失败');
        }
      },
    });
  }, [selectedDoctorId, fetchSlots]);

  const handleSubmit = useCallback(async () => {
    let values: { slot_start: Dayjs; slot_end: Dayjs; max_count: number };
    try {
      values = await form.validateFields();
    } catch { return; }

    if (!selectedDoctorId) { message.warning('请先选择医生'); return; }

    setSubmitLoading(true);
    try {
      if (editingSlot) {
        await updateSlotConfig(editingSlot.id, {
          slot_start: values.slot_start.format('HH:mm'),
          slot_end: values.slot_end.format('HH:mm'),
          max_count: values.max_count,
        });
        message.success('已更新');
      } else {
        await createSlotConfig({
          doctor_id: selectedDoctorId,
          slot_start: values.slot_start.format('HH:mm'),
          slot_end: values.slot_end.format('HH:mm'),
          max_count: values.max_count,
        });
        message.success('已添加');
      }
      setModalOpen(false);
      setEditingSlot(null);
      form.resetFields();
      fetchSlots(selectedDoctorId);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(msg ?? '操作失败');
    } finally {
      setSubmitLoading(false);
    }
  }, [form, editingSlot, selectedDoctorId, fetchSlots]);

  const columns = useMemo<ColumnsType<SlotConfig>>(() => [
    {
      title: '开始时间',
      dataIndex: 'slot_start',
      key: 'slot_start',
      width: 120,
    },
    {
      title: '结束时间',
      dataIndex: 'slot_end',
      key: 'slot_end',
      width: 120,
    },
    {
      title: '时长',
      key: 'duration',
      width: 100,
      render: (_: unknown, r: SlotConfig) => {
        const start = dayjs(r.slot_start, 'HH:mm');
        const end = dayjs(r.slot_end, 'HH:mm');
        const mins = end.diff(start, 'minute');
        return <Tag color="blue">{mins}分钟</Tag>;
      },
    },
    {
      title: '最大预约人数',
      dataIndex: 'max_count',
      key: 'max_count',
      width: 130,
      render: (v: number) => `${v} 人`,
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: unknown, r: SlotConfig) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)}>删除</Button>
        </Space>
      ),
    },
  ], [handleEdit, handleDelete]);

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Title level={4} style={{ marginBottom: 16 }}>预约时间段配置</Title>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Select
            placeholder="选择医生"
            value={selectedDoctorId}
            onChange={setSelectedDoctorId}
            style={{ width: 200 }}
            options={doctors.map(d => ({ value: d.user_id, label: d.user_name }))}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} disabled={!selectedDoctorId}>
            添加时间段
          </Button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : slots.length === 0 ? (
          <Empty description={selectedDoctorId ? '该医生暂无时间段配置' : '请先选择医生'} />
        ) : (
          <Table<SlotConfig>
            rowKey="id"
            dataSource={slots}
            columns={columns}
            pagination={false}
            size="middle"
          />
        )}
      </Card>

      <Modal
        title={editingSlot ? '编辑时间段' : '添加时间段'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => { setModalOpen(false); setEditingSlot(null); form.resetFields(); }}
        okText="确定"
        cancelText="取消"
        confirmLoading={submitLoading}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="开始时间"
            name="slot_start"
            rules={[{ required: true, message: '请选择开始时间' }]}
          >
            <TimePicker format="HH:mm" minuteStep={15} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label="结束时间"
            name="slot_end"
            rules={[{ required: true, message: '请选择结束时间' }]}
          >
            <TimePicker format="HH:mm" minuteStep={15} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label="最大预约人数"
            name="max_count"
            rules={[{ required: true, message: '请输入最大预约人数' }]}
          >
            <InputNumber min={1} max={100} style={{ width: '100%' }} addonAfter="人" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
