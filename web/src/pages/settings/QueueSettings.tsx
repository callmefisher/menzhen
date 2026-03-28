import { useState, useEffect, useCallback } from 'react';
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
  type QueueDoctor,
} from '../../api/queue-doctor';
import { listUsers } from '../../api/user';
import { useAuth } from '../../store/auth';
import useIsMobile from '../../hooks/useIsMobile';

const AVATAR_COLORS = ['#52c41a', '#faad14', '#722ed1', '#cf1322', '#1677ff', '#13c2c2', '#eb2f96', '#fa541c'];

interface UserOption {
  id: number;
  real_name: string;
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
  const { fetchQueueEnabled } = useAuth();

  // Feature toggle
  const [enabled, setEnabled] = useState(true);
  const [toggleLoading, setToggleLoading] = useState(false);

  // Call display duration
  const [callDuration, setCallDuration] = useState(10);
  const [durationSaving, setDurationSaving] = useState(false);

  // Show arrival time toggle
  const [showArrivalTime, setShowArrivalTime] = useState(true);
  const [arrivalTimeLoading, setArrivalTimeLoading] = useState(false);

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

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /* ---- Fetch data ---- */
  const fetchDoctors = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listQueueDoctors();
      const body = res as any;
      setDoctors(body.data?.list || []);
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchEnabled = useCallback(async () => {
    try {
      const res = await getQueueEnabled();
      const body = res as any;
      setEnabled(body.data?.enabled ?? true);
    } catch {
      // default on
    }
  }, []);

  const fetchCallDuration = useCallback(async () => {
    try {
      const res = await getCallDisplayDuration();
      const body = res as any;
      setCallDuration(body.data?.seconds ?? 10);
    } catch {
      // default 10s
    }
  }, []);

  const fetchShowArrivalTime = useCallback(async () => {
    try {
      const res = await getShowArrivalTime();
      const body = res as any;
      setShowArrivalTime(body.data?.show ?? true);
    } catch {
      // default on
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await listUsers({ page: 1, size: 200 });
      const body = res as any;
      const list = body.data?.list || body.data || [];
      setAllUsers(
        list.map((u: any) => ({
          id: u.id,
          real_name: u.real_name || u.username,
          username: u.username,
        })),
      );
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchDoctors();
    fetchEnabled();
    fetchCallDuration();
    fetchShowArrivalTime();
    fetchUsers();
  }, [fetchDoctors, fetchEnabled, fetchCallDuration, fetchShowArrivalTime, fetchUsers]);

  /* ---- Toggle handler ---- */
  const handleToggle = async (checked: boolean) => {
    setToggleLoading(true);
    try {
      await setQueueEnabled(checked);
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
      await setCallDisplayDuration(val);
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
      await apiSetShowArrivalTime(checked);
      setShowArrivalTime(checked);
      message.success(checked ? '入队时间显示已开启' : '入队时间显示已关闭');
    } catch {
      message.error('操作失败');
    } finally {
      setArrivalTimeLoading(false);
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
        });
        message.success('更新成功');
      } else {
        await createQueueDoctor({
          user_id: values.user_id,
          room: values.room,
          enabled: values.enabled,
        });
        message.success('添加成功');
      }

      handleModalCancel();
      fetchDoctors();
    } catch {
      // validation or request error
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
          await deleteQueueDoctor(doctor.id);
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
      await updateQueueDoctorSort(orders);
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
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
          <Button
            type="primary"
            loading={durationSaving}
            onClick={() => handleSaveDuration(callDuration)}
          >
            保存
          </Button>
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
