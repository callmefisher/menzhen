import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Card, Table, Button, Modal, Form, Select, InputNumber, TimePicker, Space, message, Typography, Tag, Alert, Divider, Checkbox
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, GlobalOutlined, CopyOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import {
  listSlotConfigs, createSlotConfig, updateSlotConfig, deleteSlotConfig, type SlotConfig
} from '../../api/appointmentSlot';
import {
  listQueueDoctors, getAppointmentConfig, getDoctorSchedule, setDoctorSchedule, type QueueDoctor, type DoctorScheduleConfig
} from '../../api/queue-doctor';

// Weekday bitmask helpers (bit0=Sun, bit1=Mon, ..., bit6=Sat — matches JS Date.getDay())
const WEEKDAY_OPTIONS = [
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 0 },
];
const fromBitmask = (mask: number): number[] => WEEKDAY_OPTIONS.map(o => o.value).filter(d => (mask >> d) & 1);
const toBitmask = (days: number[]): number => days.reduce((acc, d) => acc | (1 << d), 0);

const { Title } = Typography;

export default function AppointmentSlots() {
  const [doctors, setDoctors] = useState<QueueDoctor[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | undefined>();
  const [slots, setSlots] = useState<SlotConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [globalSlots, setGlobalSlots] = useState<SlotConfig[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<SlotConfig | null>(null);
  const [isAddingGlobal, setIsAddingGlobal] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [form] = Form.useForm();

  // Doctor schedule config state
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([]);
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(30);

  const fetchGlobalSlots = useCallback(async () => {
    setGlobalLoading(true);
    try {
      const res = await listSlotConfigs(0);
      const body = res as unknown as { data?: { list?: SlotConfig[] } };
      setGlobalSlots(body.data?.list ?? []);
    } catch {
      message.error('加载全局时间段失败');
    } finally {
      setGlobalLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGlobalSlots();
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
  }, [fetchGlobalSlots]);

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

  // Load doctor schedule config when selected doctor changes
  useEffect(() => {
    if (!selectedDoctorId) return;
    let cancelled = false;
    setScheduleLoading(true);
    setSelectedWeekdays([]);
    setRangeStart(1);
    setRangeEnd(30);
    getDoctorSchedule(selectedDoctorId)
      .then(res => {
        if (cancelled) return;
        const body = res as unknown as { data?: DoctorScheduleConfig };
        const cfg = body.data ?? { doctor_id: selectedDoctorId, weekdays: 0, range_start: 1, range_end: 30 };
        setSelectedWeekdays(fromBitmask(cfg.weekdays));
        setRangeStart(cfg.range_start);
        setRangeEnd(cfg.range_end);
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedWeekdays([]);
          setRangeStart(1);
          setRangeEnd(30);
        }
      })
      .finally(() => { if (!cancelled) setScheduleLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDoctorId]);

  const handleSaveSchedule = useCallback(async () => {
    if (!selectedDoctorId) return;
    if (rangeStart < 1 || rangeEnd < rangeStart) {
      message.warning('日期范围无效：起始天数 ≥ 1，且结束天数 ≥ 起始天数');
      return;
    }
    setScheduleSaving(true);
    try {
      await setDoctorSchedule(selectedDoctorId, {
        weekdays: toBitmask(selectedWeekdays),
        range_start: rangeStart,
        range_end: rangeEnd,
      });
      message.success('出诊日期规则已保存');
    } catch {
      message.error('保存失败，请重试');
    } finally {
      setScheduleSaving(false);
    }
  }, [selectedDoctorId, selectedWeekdays, rangeStart, rangeEnd]);

  const openModal = useCallback((forGlobal: boolean, slot: SlotConfig | null = null) => {
    setIsAddingGlobal(forGlobal);
    setEditingSlot(slot);
    if (slot) {
      form.setFieldsValue({
        slot_start: dayjs(slot.slot_start, 'HH:mm'),
        slot_end: dayjs(slot.slot_end, 'HH:mm'),
        max_count: slot.max_count,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ max_count: 1 });
    }
    setModalOpen(true);
  }, [form]);

  const handleDelete = useCallback((slot: SlotConfig, forGlobal: boolean) => {
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
          if (forGlobal) {
            fetchGlobalSlots();
          } else if (selectedDoctorId) {
            fetchSlots(selectedDoctorId);
          }
        } catch {
          message.error('删除失败');
        }
      },
    });
  }, [selectedDoctorId, fetchSlots, fetchGlobalSlots]);

  const handleSubmit = useCallback(async () => {
    let values: { slot_start: Dayjs; slot_end: Dayjs; max_count: number };
    try {
      values = await form.validateFields();
    } catch { return; }

    const startStr = values.slot_start.format('HH:mm');
    const endStr = values.slot_end.format('HH:mm');
    if (startStr >= endStr) {
      message.warning('结束时间必须晚于开始时间');
      return;
    }

    if (!isAddingGlobal && !selectedDoctorId) {
      message.warning('请先选择医生');
      return;
    }

    setSubmitLoading(true);
    try {
      if (editingSlot) {
        await updateSlotConfig(editingSlot.id, {
          slot_start: startStr,
          slot_end: endStr,
          max_count: values.max_count,
        });
        message.success('已更新');
      } else {
        await createSlotConfig({
          doctor_id: isAddingGlobal ? 0 : selectedDoctorId!,
          slot_start: startStr,
          slot_end: endStr,
          max_count: values.max_count,
        });
        message.success('已添加');
      }
      setModalOpen(false);
      setEditingSlot(null);
      form.resetFields();
      if (isAddingGlobal) {
        fetchGlobalSlots();
      } else if (selectedDoctorId) {
        fetchSlots(selectedDoctorId);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(msg ?? '操作失败');
    } finally {
      setSubmitLoading(false);
    }
  }, [form, editingSlot, isAddingGlobal, selectedDoctorId, fetchGlobalSlots, fetchSlots]);

  const [initLoading, setInitLoading] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);

  // Copy all global slots to the selected doctor
  const handleCopyGlobalSlots = useCallback(async () => {
    if (!selectedDoctorId || globalSlots.length === 0) return;
    Modal.confirm({
      title: '复制全局配置',
      content: `将把 ${globalSlots.length} 个全局默认时间段复制给该医生，已有个人配置不会被删除。确认继续？`,
      okText: '确认复制',
      cancelText: '取消',
      onOk: async () => {
        setCopyLoading(true);
        try {
          const results = await Promise.allSettled(
            globalSlots.map(s => createSlotConfig({
              doctor_id: selectedDoctorId,
              slot_start: s.slot_start,
              slot_end: s.slot_end,
              max_count: s.max_count,
            }))
          );
          const failed = results.filter(r => r.status === 'rejected').length;
          if (failed === 0) {
            message.success(`已复制 ${globalSlots.length} 个时间段`);
          } else {
            message.warning(`复制完成，${globalSlots.length - failed} 成功，${failed} 失败（可能已存在）`);
          }
          fetchSlots(selectedDoctorId);
        } catch {
          message.error('复制失败');
        } finally {
          setCopyLoading(false);
        }
      },
    });
  }, [selectedDoctorId, globalSlots, fetchSlots]);

  // Auto-seed global slots: 08:00–17:00 based on slot_minutes config, max_count=10
  const handleInitGlobalSlots = useCallback(async () => {
    setInitLoading(true);
    try {
      const cfgRes = await getAppointmentConfig();
      const cfgBody = cfgRes as unknown as { data?: { slot_minutes?: number } };
      const mins = cfgBody.data?.slot_minutes ?? 30;
      // Generate slots from 08:00 to 17:00, skip 12:00–13:00 lunch break
      const slots: Array<{ slot_start: string; slot_end: string }> = [];
      let cur = 8 * 60; // minutes since midnight
      const dayEnd = 17 * 60;
      const lunchStart = 12 * 60;
      const lunchEnd = 13 * 60;
      while (cur + mins <= dayEnd) {
        const slotEnd = cur + mins;
        // Skip any slot that overlaps with lunch (12:00–13:00)
        if (cur < lunchEnd && slotEnd > lunchStart) {
          // Jump to end of lunch break
          cur = lunchEnd;
          continue;
        }
        const fmt = (m: number) =>
          `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        slots.push({ slot_start: fmt(cur), slot_end: fmt(slotEnd) });
        cur = slotEnd;
      }
      const maxCount = 1;
      const results = await Promise.allSettled(
        slots.map(s => createSlotConfig({ doctor_id: 0, slot_start: s.slot_start, slot_end: s.slot_end, max_count: maxCount }))
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed === 0) {
        message.success(`已初始化 ${slots.length} 个默认时间段`);
      } else {
        message.warning(`初始化完成，${slots.length - failed} 成功，${failed} 失败（可能已存在）`);
      }
      fetchGlobalSlots();
    } catch {
      message.error('初始化失败，请重试');
    } finally {
      setInitLoading(false);
    }
  }, [fetchGlobalSlots]);

  const slotColumns = useCallback((forGlobal: boolean): ColumnsType<SlotConfig> => [
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
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openModal(forGlobal, r)}>编辑</Button>
          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r, forGlobal)}>删除</Button>
        </Space>
      ),
    },
  ], [openModal, handleDelete]);

  const globalColumns = useMemo(() => slotColumns(true), [slotColumns]);
  const doctorColumns = useMemo(() => slotColumns(false), [slotColumns]);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <Title level={4} style={{ marginBottom: 16 }}>预约时间段配置</Title>

      {/* Global defaults section */}
      <Card
        style={{ marginBottom: 16 }}
        title={
          <Space>
            <GlobalOutlined />
            <span>全局默认时间段</span>
          </Space>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} size="small" onClick={() => openModal(true)}>
            添加默认时间段
          </Button>
        }
      >
        <div style={{ fontSize: 13, color: '#999', marginBottom: 12 }}>
          所有医生未单独配置时将使用这些时间段
        </div>
        {!globalLoading && globalSlots.length === 0 && (
          <Alert
            type="warning"
            message="尚未配置全局默认时间段"
            description="可点击「一键初始化」按照当前时间粒度自动生成 08:00–17:00 的标准时间段（最大预约人数默认 1 人），也可手动逐个添加。"
            showIcon
            style={{ marginBottom: 12 }}
            action={
              <Button size="small" loading={initLoading} disabled={initLoading} onClick={handleInitGlobalSlots}>
                一键初始化
              </Button>
            }
          />
        )}
        <Table<SlotConfig>
          rowKey="id"
          loading={globalLoading}
          dataSource={globalSlots}
          columns={globalColumns}
          pagination={false}
          size="small"
          locale={{ emptyText: '暂无全局默认配置，建议添加标准工作时间段' }}
        />
      </Card>

      {/* Doctor-specific section */}
      <Card
        title="医生个人时间段配置"
        extra={
          <Space>
            <Button
              icon={<CopyOutlined />}
              size="small"
              disabled={!selectedDoctorId || globalSlots.length === 0}
              loading={copyLoading}
              onClick={handleCopyGlobalSlots}
            >
              复制全局配置
            </Button>
            <Divider type="vertical" />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              size="small"
              disabled={!selectedDoctorId}
              onClick={() => openModal(false)}
            >
              添加时间段
            </Button>
          </Space>
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ marginRight: 8, color: '#666', fontSize: 14 }}>选择医生：</span>
          <Select
            placeholder="选择医生"
            value={selectedDoctorId}
            onChange={setSelectedDoctorId}
            style={{ width: 200 }}
            options={doctors.map(d => ({ value: d.user_id, label: d.user_name }))}
          />
        </div>

        {selectedDoctorId && !loading && slots.length === 0 && (
          <Alert
            type="info"
            message="该医生使用全局默认时间段"
            description={'该医生尚未配置个人时间段，将使用全局默认配置。可点击「添加时间段」为该医生单独配置。'}
            showIcon
            style={{ marginBottom: 12 }}
          />
        )}

        <Table<SlotConfig>
          rowKey="id"
          loading={loading}
          dataSource={slots}
          columns={doctorColumns}
          pagination={false}
          size="middle"
          locale={{ emptyText: selectedDoctorId ? '该医生无个人配置（使用全局默认）' : '请先选择医生' }}
        />

        {selectedDoctorId && (
          <>
            <Divider style={{ fontSize: 13, color: '#555', marginTop: 20 }}>出诊日期规则</Divider>
            <div style={{ opacity: scheduleLoading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>出诊星期</div>
                <Checkbox.Group
                  options={WEEKDAY_OPTIONS}
                  value={selectedWeekdays}
                  onChange={vals => setSelectedWeekdays(vals as number[])}
                />
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>全不勾选 = 不限制，所有星期均可预约</div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>可预约日期范围</div>
                <Space>
                  <span style={{ fontSize: 13, color: '#666' }}>从今天起</span>
                  <InputNumber
                    min={1} max={180}
                    value={rangeStart}
                    onChange={v => setRangeStart(v ?? 1)}
                    style={{ width: 70 }}
                    addonAfter="天后"
                  />
                  <span style={{ fontSize: 13, color: '#666' }}>到</span>
                  <InputNumber
                    min={1} max={180}
                    value={rangeEnd}
                    onChange={v => setRangeEnd(v ?? 30)}
                    style={{ width: 70 }}
                    addonAfter="天内"
                  />
                </Space>
              </div>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                size="small"
                loading={scheduleSaving}
                onClick={handleSaveSchedule}
              >
                保存规则
              </Button>
            </div>
          </>
        )}
      </Card>

      <Modal
        title={editingSlot ? '编辑时间段' : (isAddingGlobal ? '添加全局默认时间段' : '添加时间段')}
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
