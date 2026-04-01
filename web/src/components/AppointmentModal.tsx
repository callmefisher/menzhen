import { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, DatePicker, Spin, Tooltip, message } from 'antd';
import dayjs from 'dayjs';
import { createAppointment, getSlots, type SlotInfo } from '../api/appointment';

interface AppointmentModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  doctorOptions: Array<{ id: number; name: string; room: string }>;
}

export default function AppointmentModal({ open, onClose, onSuccess, doctorOptions }: AppointmentModalProps) {
  const [form] = Form.useForm();
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const doctorId = Form.useWatch('doctor_id', form) as number | undefined;
  const appointDate = Form.useWatch('appoint_date', form) as { format: (f: string) => string } | undefined;

  useEffect(() => {
    if (!doctorId || !appointDate) { setSlots([]); return; }
    const dateStr = appointDate.format('YYYY-MM-DD');
    setSelectedSlot(null);
    setSlotsLoading(true);
    getSlots(dateStr, doctorId)
      .then(res => {
        const body = res as unknown as { data?: { data?: { list?: SlotInfo[] } } };
        setSlots(body.data?.data?.list ?? []);
      })
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [doctorId, appointDate]);

  const handleClose = () => {
    form.resetFields();
    setSelectedSlot(null);
    setSlots([]);
    onClose();
  };

  const handleSubmit = async () => {
    let values: { patient_name: string; doctor_id: number; appoint_date: { format: (f: string) => string } };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (!selectedSlot) {
      message.warning('请选择时间段');
      return;
    }
    const slot = slots.find(s => s.slot_start === selectedSlot);
    const doc = doctorOptions.find(d => d.id === values.doctor_id);
    setSubmitting(true);
    try {
      await createAppointment({
        patient_name: values.patient_name,
        doctor_id: values.doctor_id,
        doctor_name: doc?.name ?? '',
        room: doc?.room ?? '',
        appoint_date: values.appoint_date.format('YYYY-MM-DD'),
        slot_start: selectedSlot,
        slot_end: slot?.slot_end ?? '',
      });
      message.success('预约成功');
      form.resetFields();
      setSelectedSlot(null);
      setSlots([]);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(msg ?? '预约失败');
    } finally {
      setSubmitting(false);
    }
  };

  const today = dayjs();
  const maxDate = today.add(7, 'day');

  return (
    <Modal
      title="新建预约"
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      okText="确认预约"
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ appoint_date: today }}>
        <Form.Item label="患者姓名" name="patient_name" rules={[{ required: true, message: '请输入患者姓名' }]}>
          <Input placeholder="请输入患者姓名" />
        </Form.Item>
        <Form.Item label="就诊医生" name="doctor_id" rules={[{ required: true, message: '请选择医生' }]}>
          <Select
            placeholder="请选择医生"
            options={doctorOptions.map(d => ({ value: d.id, label: d.name }))}
          />
        </Form.Item>
        <Form.Item label="预约日期" name="appoint_date" rules={[{ required: true, message: '请选择日期' }]}>
          <DatePicker
            style={{ width: '100%' }}
            disabledDate={d => d.isBefore(today, 'day') || d.isAfter(maxDate, 'day')}
            format="YYYY-MM-DD"
          />
        </Form.Item>
        <Form.Item label="时间段">
          {slotsLoading ? (
            <Spin size="small" />
          ) : slots.length === 0 ? (
            <div style={{ color: '#999', fontSize: 13 }}>
              {doctorId && appointDate ? '暂无可用时间段' : '请先选择医生和日期'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {slots.map(slot => {
                const isSelected = selectedSlot === slot.slot_start;
                const isFull = !slot.available;
                return (
                  <Tooltip key={slot.slot_start} title={isFull ? '已满' : undefined}>
                    <div
                      onClick={() => { if (!isFull) setSelectedSlot(slot.slot_start); }}
                      style={{
                        padding: '8px 6px',
                        borderRadius: 6,
                        border: `1px solid ${isSelected ? '#52c41a' : isFull ? '#d9d9d9' : '#52c41a'}`,
                        background: isSelected ? '#52c41a' : isFull ? '#f5f5f5' : '#f6ffed',
                        color: isSelected ? '#fff' : isFull ? '#bfbfbf' : '#135200',
                        cursor: isFull ? 'not-allowed' : 'pointer',
                        textAlign: 'center',
                        fontSize: 12,
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{slot.slot_start}–{slot.slot_end}</div>
                      <div style={{ fontSize: 11, marginTop: 2 }}>
                        {slot.booked_count}/{slot.max_count}
                      </div>
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          )}
        </Form.Item>
      </Form>
    </Modal>
  );
}
