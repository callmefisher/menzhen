import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Switch,
  Button,
  Modal,
  Form,
  Input,
  Radio,
  Select,
  Tag,
  message,
  Spin,
  Empty,
  Space,
  Slider,
  InputNumber,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  HolderOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  listQueueDoctors,
  createQueueDoctor,
  updateQueueDoctor,
  deleteQueueDoctor,
  updateQueueDoctorSort,
  setQueueEnabled,
  getQueueEnabled,
  getCallDisplayDuration,
  setCallDisplayDuration,
  getShowArrivalTime,
  setShowArrivalTime as apiSetShowArrivalTime,
  getAppointmentEnabled,
  setAppointmentEnabled as apiSetAppointmentEnabled,
  getAppointmentConfig,
  setAppointmentConfig as apiSetAppointmentConfig,
  getCallSoundEnabled,
  setCallSoundEnabled as apiSetCallSoundEnabled,
  type QueueDoctor,
  type AppointmentConfig,
} from '../../api/queue-doctor';
import { listUsers } from '../../api/user';
import { useAuth } from '../../store/auth';
import useIsMobile from '../../hooks/useIsMobile';
import TenantSelector from '../../components/TenantSelector';

const AVATAR_COLORS = ['#52c41a', '#faad14', '#722ed1', '#cf1322', '#1677ff', '#13c2c2', '#eb2f96', '#fa541c'];

interface UserOption {
  id: number;
  real_name: string;
  username: string;
}

interface RawUser {
  id: number;
  real_name?: string;
  username: string;
}

/* ========== SortableItem ========== */
function SortableDoctorItem({
  doctor,
  colorIndex,
  onEdit,
  onDelete,
  isMobile,
}: {
  doctor: QueueDoctor;
  colorIndex: number;
  onEdit: (d: QueueDoctor) => void;
  onDelete: (d: QueueDoctor) => void;
  isMobile: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: doctor.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const color = AVATAR_COLORS[colorIndex % AVATAR_COLORS.length];

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        gap: isMobile ? 8 : 12,
        padding: isMobile ? '10px 8px' : '12px 16px',
        background: '#fafafa',
        borderRadius: 8,
        marginBottom: 8,
        border: isDragging ? '1px dashed #1677ff' : '1px solid transparent',
      }}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        style={{
          cursor: 'grab',
          color: '#bbb',
          fontSize: isMobile ? 20 : 18,
          padding: isMobile ? '4px 2px' : '2px 4px',
          touchAction: 'none',
          flexShrink: 0,
        }}
      >
        <HolderOutlined />
      </div>

      {/* Avatar */}
      <div
        style={{
          width: 36,
          height: 36,
          background: `linear-gradient(135deg, ${color}, ${color}cc)`,
          color: '#fff',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 15,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {(doctor.user_name || '?').charAt(0)}
      </div>

      {/* Name + Room */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{doctor.user_name}</div>
        <div style={{ fontSize: 12, color: '#999' }}>{doctor.room || '-'}</div>
      </div>

      {/* Status tag */}
      <Tag color={doctor.enabled ? 'green' : 'orange'} style={{ margin: 0 }}>
        {doctor.enabled ? '出诊中' : '停诊'}
      </Tag>

      {/* Actions */}
      <Space size="small">
        <Button
          type="link"
          size="small"
          icon={<EditOutlined />}
          onClick={() => onEdit(doctor)}
        >
          {!isMobile && '编辑'}
        </Button>
        <Button
          type="link"
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => onDelete(doctor)}
        >
          {!isMobile && '删除'}
        </Button>
      </Space>
    </div>
  );
}

/* ========== Main component ========== */
export default function QueueSettings() {
  const isMobile = useIsMobile();
  const { user: currentUser, isSuperAdmin, fetchQueueEnabled, fetchAppointmentEnabled } = useAuth();
  const navigate = useNavigate();
  const [selectedTenantId, setSelectedTenantId] = useState<number>(currentUser?.tenant_id ?? 0);
  const tenantIdParam = isSuperAdmin ? (selectedTenantId || undefined) : undefined;

  // Feature toggle
  const [enabled, setEnabled] = useState(true);
  const [toggleLoading, setToggleLoading] = useState(false);

  // Call display duration
  const [callDuration, setCallDuration] = useState(6);
  const [durationSaving, setDurationSaving] = useState(false);

  // Show arrival time toggle
  const [showArrivalTime, setShowArrivalTime] = useState(true);
  const [arrivalTimeLoading, setArrivalTimeLoading] = useState(false);

  // Appointment enabled toggle
  const [apptEnabled, setApptEnabled] = useState(true);
  const [apptEnabledLoading, setApptEnabledLoading] = useState(false);

  // Appointment config
  const [apptConfig, setApptConfig] = useState<AppointmentConfig>({
    slot_minutes: 30,
    max_appt_per_slot: 1,
    advance_days: 30,
  });
  const [apptConfigSaving, setApptConfigSaving] = useState(false);

  // Call sound broadcast toggle
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundLoading, setSoundLoading] = useState(false);

  // Doctor list
  const [doctors, setDoctors] = useState<QueueDoctor[]>([]);
  const [loading, setLoading] = useState(false);

  // All users (for Select dropdown in modal)
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);

  // Modal
  const [modalVisible, setModalVisible] = useState(false);
  const [editingDoctor, setEditingDoctor] = useState<QueueDoctor | null>(null);
  const [form] = Form.useForm();
  const [submitLoading, setSubmitLoading] = useState(false);

  // Cancellation ref — set to true when tenantIdParam changes so stale fetches don't update state
  const fetchCancelledRef = useRef(false);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /* ---- Fetch data ---- */
  const fetchDoctors = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listQueueDoctors(tenantIdParam);
      const body = res as unknown as { data?: { list?: QueueDoctor[] } };
      if (!fetchCancelledRef.current) setDoctors(body.data?.list ?? []);
    } catch {
      // handled by interceptor
    } finally {
      if (!fetchCancelledRef.current) setLoading(false);
    }
  }, [tenantIdParam]);

  const fetchEnabled = useCallback(async () => {
    try {
      const res = await getQueueEnabled(tenantIdParam);
      const body = res as unknown as { data?: { enabled?: boolean } };
      if (!fetchCancelledRef.current) setEnabled(body.data?.enabled ?? true);
    } catch {
      // default on
    }
  }, [tenantIdParam]);

  const fetchCallDuration = useCallback(async () => {
    try {
      const res = await getCallDisplayDuration(tenantIdParam);
      const body = res as unknown as { data?: { seconds?: number } };
      if (!fetchCancelledRef.current) setCallDuration(body.data?.seconds ?? 6);
    } catch {
      // default 10s
    }
  }, [tenantIdParam]);

  const fetchShowArrivalTime = useCallback(async () => {
    try {
      const res = await getShowArrivalTime(tenantIdParam);
      const body = res as unknown as { data?: { show?: boolean } };
      if (!fetchCancelledRef.current) setShowArrivalTime(body.data?.show ?? true);
    } catch {
      // default on
    }
  }, [tenantIdParam]);

  const fetchApptEnabled = useCallback(async () => {
    try {
      const res = await getAppointmentEnabled(tenantIdParam);
      const body = res as unknown as { data?: { enabled?: boolean } };
      if (!fetchCancelledRef.current) setApptEnabled(body.data?.enabled ?? true);
    } catch {
      // default on
    }
  }, [tenantIdParam]);

  const fetchApptConfig = useCallback(async () => {
    try {
      const res = await getAppointmentConfig(tenantIdParam);
      const body = res as unknown as { data?: AppointmentConfig };
      if (body.data && !fetchCancelledRef.current) {
        setApptConfig(body.data);
      }
    } catch {
      // keep defaults
    }
  }, [tenantIdParam]);

  const fetchSoundEnabled = useCallback(async () => {
    try {
      const res = await getCallSoundEnabled(tenantIdParam);
      const body = res as unknown as { data?: { enabled?: boolean } };
      if (!fetchCancelledRef.current) setSoundEnabled(body.data?.enabled ?? true);
    } catch { /* keep default */ }
  }, [tenantIdParam]);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await listUsers({ page: 1, size: 200, tenant_id: tenantIdParam });
      const body = res as unknown as { data?: { list?: RawUser[] } | RawUser[] };
      const rawList = Array.isArray(body.data) ? body.data : (body.data as { list?: RawUser[] })?.list ?? [];
      if (!fetchCancelledRef.current) {
        setAllUsers(
          rawList.map((u: RawUser) => ({
            id: u.id,
            real_name: u.real_name || u.username,
            username: u.username,
          })),
        );
      }
    } catch {
      // ignore
    }
  }, [tenantIdParam]);

  useEffect(() => {
    fetchCancelledRef.current = false;
    fetchDoctors();
    fetchEnabled();
    fetchCallDuration();
    fetchShowArrivalTime();
    fetchApptEnabled();
    fetchApptConfig();
    fetchSoundEnabled();
    fetchUsers();
    return () => { fetchCancelledRef.current = true; };
  }, [fetchDoctors, fetchEnabled, fetchCallDuration, fetchShowArrivalTime, fetchApptEnabled, fetchApptConfig, fetchSoundEnabled, fetchUsers]);

  /* ---- Toggle handler ---- */
  const handleToggle = async (checked: boolean) => {
    setToggleLoading(true);
    try {
      await setQueueEnabled(checked, tenantIdParam);
      setEnabled(checked);
      await fetchQueueEnabled();
      message.success(checked ? '排队叫号已开启' : '排队叫号已关闭');
    } catch {
      message.error('操作失败');
    } finally {
      setToggleLoading(false);
    }
  };

  /* ---- Call duration handler ---- */
  const handleSaveDuration = async (val: number) => {
    setDurationSaving(true);
    try {
      await setCallDisplayDuration(val, tenantIdParam);
      setCallDuration(val);
      message.success('叫号显示时长已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setDurationSaving(false);
    }
  };

  /* ---- Show arrival time handler ---- */
  const handleToggleArrivalTime = async (checked: boolean) => {
    setArrivalTimeLoading(true);
    try {
      await apiSetShowArrivalTime(checked, tenantIdParam);
      setShowArrivalTime(checked);
      message.success(checked ? '入队时间显示已开启' : '入队时间显示已关闭');
    } catch {
      message.error('操作失败');
    } finally {
      setArrivalTimeLoading(false);
    }
  };

  /* ---- Call sound toggle handler ---- */
  const handleToggleSound = async (checked: boolean) => {
    setSoundLoading(true);
    try {
      await apiSetCallSoundEnabled(checked, tenantIdParam);
      setSoundEnabled(checked);
      message.success(checked ? '声音播报已开启' : '声音播报已关闭');
    } catch {
      message.error('操作失败');
    } finally {
      setSoundLoading(false);
    }
  };

  /* ---- Appointment enabled toggle handler ---- */
  const handleToggleApptEnabled = async (checked: boolean) => {
    setApptEnabledLoading(true);
    try {
      await apiSetAppointmentEnabled(checked, tenantIdParam);
      setApptEnabled(checked);
      await fetchAppointmentEnabled();
      message.success(checked ? '预约功能已开启' : '预约功能已关闭');
    } catch {
      message.error('操作失败');
    } finally {
      setApptEnabledLoading(false);
    }
  };

  /* ---- Appointment config save handler ---- */
  const handleSaveApptConfig = async () => {
    setApptConfigSaving(true);
    try {
      await apiSetAppointmentConfig(apptConfig, tenantIdParam);
      message.success('预约配置已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setApptConfigSaving(false);
    }
  };

  /* ---- Modal handlers ---- */
  const handleAdd = () => {
    setEditingDoctor(null);
    form.resetFields();
    form.setFieldsValue({ enabled: true });
    setModalVisible(true);
  };

  const handleEdit = (doctor: QueueDoctor) => {
    setEditingDoctor(doctor);
    form.setFieldsValue({
      user_id: doctor.user_id,
      room: doctor.room,
      enabled: doctor.enabled,
    });
    setModalVisible(true);
  };

  const handleModalCancel = () => {
    setModalVisible(false);
    setEditingDoctor(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitLoading(true);

      if (editingDoctor) {
        await updateQueueDoctor(editingDoctor.id, {
          room: values.room,
          enabled: values.enabled,
        }, tenantIdParam);
        message.success('更新成功');
      } else {
        await createQueueDoctor({
          user_id: values.user_id,
          room: values.room,
          enabled: values.enabled,
        }, tenantIdParam);
        message.success('添加成功');
      }

      handleModalCancel();
      fetchDoctors();
    } catch (err: unknown) {
      // validateFields throws without a message when validation fails — ignore those
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error('操作失败，请重试');
    } finally {
      setSubmitLoading(false);
    }
  };

  /* ---- Delete handler ---- */
  const handleDelete = (doctor: QueueDoctor) => {
    Modal.confirm({
      title: '确定删除？',
      content: `确定要移除接诊医生「${doctor.user_name}」吗？`,
      okText: '确定',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteQueueDoctor(doctor.id, tenantIdParam);
          message.success('删除成功');
          fetchDoctors();
        } catch {
          message.error('删除失败');
        }
      },
    });
  };

  /* ---- Drag sort handler ---- */
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = doctors.findIndex((d) => d.id === active.id);
    const newIndex = doctors.findIndex((d) => d.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(doctors, oldIndex, newIndex);
    setDoctors(reordered);

    const orders = reordered.map((d, i) => ({ id: d.id, sort_order: i + 1 }));
    try {
      await updateQueueDoctorSort(orders, tenantIdParam);
    } catch {
      message.error('排序保存失败');
      fetchDoctors();
    }
  };

  /* ---- Available users (exclude already configured) ---- */
  const configuredUserIds = new Set(doctors.map((d) => d.user_id));
  const availableUsers = editingDoctor
    ? allUsers // when editing, show all (selected one is already configured)
    : allUsers.filter((u) => !configuredUserIds.has(u.id));

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <TenantSelector
        value={selectedTenantId}
        onChange={(id) => setSelectedTenantId(id)}
      />
      {/* Feature toggle card */}
      <Card style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>排队叫号功能</div>
            <div style={{ fontSize: 13, color: '#999', marginTop: 4 }}>
              关闭后：侧边栏隐藏排队菜单，患者无法取号
            </div>
          </div>
          <Switch
            checked={enabled}
            loading={toggleLoading}
            onChange={handleToggle}
          />
        </div>
      </Card>

      {/* Call display duration card */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>叫号显示设置</div>
        <div style={{ fontSize: 13, color: '#999', marginBottom: 16 }}>
          每条叫号通知的弹窗展示时长，到期后自动关闭并播放下一条
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', flex: 1 }}>
            <span style={{ fontSize: 14, color: '#555', flexShrink: 0 }}>叫号通知时长</span>
            <Slider
              min={3}
              max={60}
              step={1}
              value={callDuration}
              onChange={setCallDuration}
              style={{ flex: 1, minWidth: 160, maxWidth: 300 }}
              tooltip={{ formatter: (v) => `${v}秒` }}
            />
            <InputNumber
              min={3}
              max={60}
              value={callDuration}
              onChange={(v) => setCallDuration(v ?? 10)}
              addonAfter="秒"
              style={{ width: 100 }}
            />
          </div>
          <Button
            type="primary"
            loading={durationSaving}
            onClick={() => handleSaveDuration(callDuration)}
          >
            保存
          </Button>
        </div>

        {/* Sound enabled toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
          <div>
            <div style={{ fontSize: 14, color: '#555' }}>叫号声音播报</div>
            <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
              开启后叫号时自动朗读患者姓名和诊室，兼容 Android / Windows / macOS
            </div>
          </div>
          <Switch
            checked={soundEnabled}
            loading={soundLoading}
            onChange={handleToggleSound}
          />
        </div>
      </Card>

      {/* Show arrival time card */}
      <Card style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>显示入队时间</div>
            <div style={{ fontSize: 13, color: '#999', marginTop: 4 }}>
              开启后：排队列表和看板中每位患者的入队时间以徽章形式显示
            </div>
          </div>
          <Switch
            checked={showArrivalTime}
            loading={arrivalTimeLoading}
            onChange={handleToggleArrivalTime}
          />
        </div>
      </Card>

      {/* Appointment config card */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>预约配置</div>
        <div style={{ fontSize: 13, color: '#999', marginBottom: 16 }}>
          配置各医生的可预约时间段及每个时段最大预约人数
        </div>

        {/* Appointment enabled toggle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>启用预约功能</div>
            <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
              关闭后：侧边栏隐藏预约菜单，排队页隐藏预约按钮
            </div>
          </div>
          <Switch
            checked={apptEnabled}
            loading={apptEnabledLoading}
            onChange={handleToggleApptEnabled}
          />
        </div>

        {/* Global appointment params (only visible when appointment is enabled) */}
        {apptEnabled && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 16,
              marginBottom: 16,
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
              <div>
                <div style={{ fontSize: 13, color: '#555', marginBottom: 4 }}>时间粒度</div>
                <Select
                  value={apptConfig.slot_minutes}
                  onChange={(v) => setApptConfig((prev) => ({
                    ...prev,
                    slot_minutes: v,
                  }))}
                  style={{ width: 120 }}
                  options={[
                    { value: 5,  label: '5 分钟' },
                    { value: 10, label: '10 分钟' },
                    { value: 15, label: '15 分钟' },
                    { value: 30, label: '30 分钟' },
                    { value: 60, label: '60 分钟' },
                  ]}
                />
              </div>
              <div>
                <div style={{ fontSize: 13, color: '#555', marginBottom: 4 }}>每时段最大预约数</div>
                <InputNumber
                  min={1}
                  max={100}
                  value={apptConfig.max_appt_per_slot}
                  onChange={(v) => setApptConfig((prev) => ({ ...prev, max_appt_per_slot: v ?? 1 }))}
                  addonAfter="人"
                  style={{ width: 120 }}
                />
              </div>
              <div>
                <div style={{ fontSize: 13, color: '#555', marginBottom: 4 }}>可提前预约天数</div>
                <InputNumber
                  min={1}
                  max={30}
                  value={apptConfig.advance_days}
                  onChange={(v) => setApptConfig((prev) => ({ ...prev, advance_days: v ?? 30 }))}
                  addonAfter="天"
                  style={{ width: 120 }}
                />
              </div>
            </div>
            <Button
              type="primary"
              loading={apptConfigSaving}
              onClick={handleSaveApptConfig}
              style={{ alignSelf: 'flex-end' }}
            >
              保存
            </Button>
          </div>
        )}

        <Button
          type="default"
          icon={<CalendarOutlined />}
          onClick={() => navigate('/settings/appointment-slots')}
          disabled={!apptEnabled}
        >
          管理预约时间段
        </Button>
      </Card>

      {/* Doctor list card */}
      <Card
        title="接诊医生"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAdd}
            size={isMobile ? 'small' : 'middle'}
          >
            添加医生
          </Button>
        }
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : doctors.length === 0 ? (
          <Empty description="暂无接诊医生，请点击「添加医生」配置" />
        ) : (
          <>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={doctors.map((d) => d.id)}
                strategy={verticalListSortingStrategy}
              >
                {doctors.map((doctor, idx) => (
                  <SortableDoctorItem
                    key={doctor.id}
                    doctor={doctor}
                    colorIndex={idx}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    isMobile={isMobile}
                  />
                ))}
              </SortableContext>
            </DndContext>
            <div style={{ fontSize: 12, color: '#bbb', marginTop: 4 }}>
              <HolderOutlined /> 拖拽可调整排序
            </div>
          </>
        )}
      </Card>

      {/* Add / Edit doctor modal */}
      <Modal
        title={editingDoctor ? '编辑接诊医生' : '添加接诊医生'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={handleModalCancel}
        confirmLoading={submitLoading}
        okText="确定"
        cancelText="取消"
        width={isMobile ? '95vw' : 480}
        forceRender
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="user_id"
            label="选择医生"
            rules={[{ required: true, message: '请选择医生' }]}
          >
            <Select
              placeholder="请选择医生"
              showSearch
              optionFilterProp="label"
              disabled={!!editingDoctor}
              options={availableUsers.map((u) => ({
                value: u.id,
                label: u.real_name || u.username,
              }))}
            />
          </Form.Item>

          <Form.Item
            name="room"
            label="诊室名称"
            rules={[{ required: true, message: '请输入诊室名称' }]}
          >
            <Input addonBefore="诊室:" placeholder="例如：1" />
          </Form.Item>

          <Form.Item name="enabled" label="初始状态">
            <Radio.Group>
              <Radio value={true}>出诊中</Radio>
              <Radio value={false}>停诊</Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
