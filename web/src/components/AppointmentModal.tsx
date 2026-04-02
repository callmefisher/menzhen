import { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, DatePicker, Spin, Tooltip, message } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { createAppointment, updateAppointment, getSlots, type SlotInfo } from '../api/appointment';
import { getDoctorSchedule } from '../api/queue-doctor';

/**
 * Pure function — returns a disabledDate predicate for DatePicker.
 * Rules (AND):
 *   - date must be strictly after today (no same-day booking)
 *   - date must be within [today + rangeStart, today + rangeEnd]
 *   - if weekdays !== 0, date must be one of the configured weekdays
 *     (bit0=Sun, bit1=Mon, ..., bit6=Sat)
 */
export function makeDisabledDate(
  today: Dayjs,
  rangeStart: number,
  rangeEnd: number,
  weekdays: number,
): (d: Dayjs) => boolean {
  return (d: Dayjs) => {
    if (!d.isAfter(today, 'day')) return true;
    if (d.isBefore(today.add(rangeStart, 'day'), 'day')) return true;
    if (d.isAfter(today.add(rangeEnd, 'day'), 'day')) return true;
    if (weekdays !== 0) {
      const dow = d.day(); // 0=Sun, 1=Mon, ...6=Sat
      if (!((weekdays >> dow) & 1)) return true;
    }
    return false;
  };
}

interface InitialValues {
  id: number;
  patient_name: string;
  patient_id?: number;
  doctor_id: number;
  doctor_name: string;
  room?: string;
  appoint_date: string;
  slot_start: string;
  slot_end: string;
}

interface AppointmentModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  doctorOptions: Array<{ id: number; name: string; room: string }>;
  initialValues?: InitialValues;
}

export default function AppointmentModal({ open, onClose, onSuccess, doctorOptions, initialValues }: AppointmentModalProps) {
  const [form] = Form.useForm();
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [scheduleConfig, setScheduleConfig] = useState({ weekdays: 0, range_start: 1, range_end: 30 });

  const isEdit = !!initialValues;

  const doctorId = Form.useWatch('doctor_id', form) as number | undefined;
  const appointDateObj = Form.useWatch('appoint_date', form) as Dayjs | undefined;
  const appointDateStr = appointDateObj?.format('YYYY-MM-DD');

  // Pre-fill form when editing; default to first doctor when creating
  useEffect(() => {
    if (open && initialValues) {
      form.setFieldsValue({
        patient_name: initialValues.patient_name,
        doctor_id: initialValues.doctor_id,
        appoint_date: dayjs(initialValues.appoint_date),
      });
      setSelectedSlot(initialValues.slot_start);
    } else if (open && !initialValues && doctorOptions.length > 0) {
      form.setFieldsValue({ doctor_id: doctorOptions[0].id });
    }
    if (!open) {
      form.resetFields();
      setSelectedSlot(null);
      setSlots([]);
    }
  }, [open, initialValues, form, doctorOptions]);

  useEffect(() => {
    if (!doctorId || !appointDateStr) { setSlots([]); return; }
    // Clear selectedSlot when doctor or date changes so a stale slot_start is never submitted
    setSelectedSlot(null);
    setSlotsLoading(true);
    getSlots(appointDateStr, doctorId)
      .then(res => {
        const body = res as unknown as { data?: { list?: SlotInfo[] } };
        const list = body.data?.list ?? [];
        setSlots(list);
        // In edit mode, restore the original slot selection if it still exists in the new list
        if (initialValues?.slot_start && list.some(s => s.slot_start === initialValues.slot_start)) {
          setSelectedSlot(initialValues.slot_start);
        }
      })
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [doctorId, appointDateStr, initialValues?.slot_start]);

  // Load doctor schedule config when doctor changes
  useEffect(() => {
    if (!doctorId) return;
    let cancelled = false;
    getDoctorSchedule(doctorId)
      .then(res => {
        if (cancelled) return;
        const body = res as unknown as { data?: { weekdays?: number; range_start?: number; range_end?: number } };
        const d = body.data;
        setScheduleConfig({
          weekdays: d?.weekdays ?? 0,
          range_start: d?.range_start ?? 1,
          range_end: d?.range_end ?? 30,
        });
      })
      .catch(() => {
        if (!cancelled) setScheduleConfig({ weekdays: 0, range_start: 1, range_end: 30 });
      });
    return () => { cancelled = true; };
  }, [doctorId]);

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
    const apptDate = values.appoint_date.format('YYYY-MM-DD');
    const slotEnd = slot?.slot_end ?? (isEdit ? initialValues.slot_end : '');
    const doctorName = doc?.name ?? (isEdit ? initialValues.doctor_name : '');
    const room = doc?.room ?? (isEdit ? (initialValues.room ?? '') : '');

    setSubmitting(true);
    try {
      if (isEdit) {
        await updateAppointment(initialValues.id, {
          patient_name: values.patient_name,
          patient_id: initialValues.patient_id,
          doctor_id: values.doctor_id,
          doctor_name: doctorName,
          room,
          appoint_date: apptDate,
          slot_start: selectedSlot,
          slot_end: slotEnd,
        });
        message.success('预约已更新');
      } else {
        await createAppointment({
          patient_name: values.patient_name,
          doctor_id: values.doctor_id,
          doctor_name: doctorName,
          room,
          appoint_date: apptDate,
          slot_start: selectedSlot,
          slot_end: slotEnd,
        });
        message.success('预约成功');
      }
      form.resetFields();
      setSelectedSlot(null);
      setSlots([]);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(msg ?? (isEdit ? '更新失败' : '预约失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const today = dayjs();
  const disabledDate = makeDisabledDate(today, scheduleConfig.range_start, scheduleConfig.range_end, scheduleConfig.weekdays);
  const tomorrow = today.add(scheduleConfig.range_start, 'day');

  return (
    <Modal
      title={isEdit ? '编辑预约' : '新建预约'}
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      okText={isEdit ? '保存' : '确认预约'}
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ appoint_date: tomorrow }}>
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
            disabledDate={disabledDate}
            format="YYYY-MM-DD"
          />
        </Form.Item>
        <Form.Item label="时间段">
          {slotsLoading ? (
            <Spin size="small" />
          ) : slots.length === 0 ? (
            <div style={{ color: '#999', fontSize: 13 }}>
              {doctorId && appointDateObj ? '暂无可用时间段' : '请先选择医生和日期'}
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
