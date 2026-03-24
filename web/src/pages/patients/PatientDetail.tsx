import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  Card,
  Descriptions,
  Button,
  Timeline,
  Typography,
  Image,
  Spin,
  Empty,
  Space,
  message,
  Popconfirm,
  Tag,
  Modal,
  Form,
  DatePicker,
  Input,
  Select,
  Badge,
  Switch,
} from 'antd';
import {
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  DownOutlined,
  UpOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { getPatient } from '../../api/patient';
import { deleteRecord } from '../../api/record';
import type { PrescriptionData } from '../../api/prescription';
import { AuthImage, AuthAudio, AuthVideo } from '../../components/AuthMedia';
import type { FollowUpListItem } from '../../api/followUp';
import {
  listFollowUps,
  createFollowUp,
  updateFollowUp,
  deleteFollowUp,
} from '../../api/followUp';
import dayjs from 'dayjs';
import { recoveredTagStyle, notRecoveredTagStyle } from '../../utils/followUpStyles';
import { PatientFormModal } from './PatientForm';
import useIsMobile from '../../hooks/useIsMobile';

const { Text, Paragraph } = Typography;

interface Attachment {
  id: number;
  file_type: string;
  file_name: string;
  file_path: string;
  file_size: number;
}

interface MedicalRecord {
  id: number;
  diagnosis: string;
  treatment: string;
  notes: string;
  visit_date: string;
  attachments: Attachment[];
  prescriptions: PrescriptionData[];
}

interface PatientData {
  id: number;
  name: string;
  gender: number;
  age: number;
  birthday: string;
  weight: number;
  phone: string;
  id_card: string;
  address: string;
  native_place: string;
  notes: string;
  created_at: string;
  medical_records: MedicalRecord[];
}

export default function PatientDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const isMobile = useIsMobile();

  // Highlight state from RecordForm return navigation
  const highlightState = location.state as { highlightRecordId?: number; highlightPrescriptionId?: number } | null;
  const highlightRecordId = highlightState?.highlightRecordId;
  const highlightPrescriptionId = highlightState?.highlightPrescriptionId;
  const highlightAppliedRef = useRef(false);

  const [patient, setPatient] = useState<PatientData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedRecords, setExpandedRecords] = useState<Set<number>>(new Set());
  const [editModalVisible, setEditModalVisible] = useState(false);

  // Follow-up state
  const [followUps, setFollowUps] = useState<FollowUpListItem[]>([]);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpModalOpen, setFollowUpModalOpen] = useState(false);
  const [followUpForm] = Form.useForm();
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const [editingFollowUp, setEditingFollowUp] = useState<FollowUpListItem | null>(null);
  const [isOtherMethod, setIsOtherMethod] = useState(false);
  const [lastSavedFollowUpId, setLastSavedFollowUpId] = useState<number | null>(null);

  const fetchFollowUps = useCallback(async () => {
    if (!id) return;
    setFollowUpLoading(true);
    try {
      const res = await listFollowUps({ patient_id: Number(id), size: 100 });
      const body = res as unknown as { data: { list: FollowUpListItem[] } };
      setFollowUps(body.data?.list || []);
    } catch {
      // silent
    } finally {
      setFollowUpLoading(false);
    }
  }, [id]);

  const fetchPatient = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await getPatient(Number(id));
      const body = res as unknown as { data: PatientData };
      setPatient(body.data);
    } catch {
      message.error('加载患者信息失败');
      navigate('/patients');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    fetchPatient();
    fetchFollowUps();
  }, [fetchPatient, fetchFollowUps]);

  // Clear followup highlight after 5s
  useEffect(() => {
    if (!lastSavedFollowUpId) return;
    const timer = setTimeout(() => setLastSavedFollowUpId(null), 5000);
    return () => clearTimeout(timer);
  }, [lastSavedFollowUpId]);

  // Highlight record and prescription when returning from RecordForm (keep collapsed)
  useEffect(() => {
    if (!highlightRecordId || !patient || highlightAppliedRef.current) return;
    highlightAppliedRef.current = true;

    // Scroll + highlight after DOM update
    const timers: ReturnType<typeof setTimeout>[] = [];
    const t1 = setTimeout(() => {
      const recordEl = document.querySelector(`[data-record-id="${highlightRecordId}"]`);
      if (recordEl) {
        recordEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        recordEl.classList.add('record-highlight');

        // Remove highlight after 15s
        const t2 = setTimeout(() => {
          recordEl.classList.remove('record-highlight');
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }, 15000);
        timers.push(t2);
      }
    }, 150);
    timers.push(t1);

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [highlightRecordId, highlightPrescriptionId, patient]);

  const toggleExpand = (recordId: number) => {
    setExpandedRecords((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) {
        next.delete(recordId);
      } else {
        next.add(recordId);
      }
      return next;
    });
  };

  const handleDeleteRecord = async (recordId: number) => {
    try {
      await deleteRecord(recordId);
      message.success('诊疗记录已删除');
      fetchPatient();
    } catch {
      // handled
    }
  };

  const handleEditSuccess = () => {
    fetchPatient();
  };

  // Follow-up handlers
  const handleOpenFollowUpModal = (item?: FollowUpListItem) => {
    if (item) {
      setEditingFollowUp(item);
      const isOther = !['电话', '微信', '到诊'].includes(item.method);
      setIsOtherMethod(isOther);
      followUpForm.setFieldsValue({
        planned_date: dayjs(item.planned_date),
        method: isOther ? '其他' : item.method,
        custom_method: isOther ? item.method : undefined,
        content: item.content,
        actual_date: item.actual_date ? dayjs(item.actual_date) : undefined,
        record_id: item.record_id || undefined,
        is_recovered: item.is_recovered,
      });
    } else {
      setEditingFollowUp(null);
      setIsOtherMethod(false);
      followUpForm.resetFields();
      followUpForm.setFieldsValue({ method: '电话' });
    }
    setFollowUpModalOpen(true);
  };

  const handleFollowUpSave = async () => {
    try {
      const values = await followUpForm.validateFields();
      setFollowUpSaving(true);
      const method = values.method === '其他' ? (values.custom_method || '其他') : values.method;
      if (editingFollowUp) {
        const data: Record<string, unknown> = {
          planned_date: values.planned_date.format('YYYY-MM-DD'),
          actual_date: values.actual_date ? values.actual_date.format('YYYY-MM-DD') : '',
          method,
          content: values.content || '',
          record_id: values.record_id || null,
          is_recovered: values.is_recovered ?? false,
        };
        await updateFollowUp(editingFollowUp.id, data);
        message.success('回访记录已更新');
        setLastSavedFollowUpId(editingFollowUp.id);
      } else {
        const res = await createFollowUp({
          patient_id: Number(id),
          planned_date: values.planned_date.format('YYYY-MM-DD'),
          method,
          content: values.content || '',
          record_id: values.record_id || undefined,
        });
        const body = res as any;
        message.success('回访记录已创建');
        if (body.data?.id) setLastSavedFollowUpId(body.data.id);
      }
      setFollowUpModalOpen(false);
      fetchFollowUps();
    } catch {
      // validation
    } finally {
      setFollowUpSaving(false);
    }
  };

  const handleCompleteFollowUp = async (item: FollowUpListItem) => {
    try {
      await updateFollowUp(item.id, {
        actual_date: dayjs().format('YYYY-MM-DD'),
      });
      message.success('已完成回访');
      fetchFollowUps();
    } catch {
      message.error('操作失败');
    }
  };

  const handleDeleteFollowUp = async (fid: number) => {
    try {
      await deleteFollowUp(fid);
      message.success('回访记录已删除');
      fetchFollowUps();
    } catch {
      message.error('删除失败');
    }
  };

  const statusConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
    overdue: { color: '#ff4d4f', icon: <ExclamationCircleOutlined />, label: '逾期' },
    pending: { color: '#1677ff', icon: <ClockCircleOutlined />, label: '待回访' },
    completed: { color: '#52c41a', icon: <CheckCircleOutlined />, label: '已完成' },
  };

  // Sort follow-ups: overdue first, then pending, then completed
  const sortedFollowUps = [...followUps].sort((a, b) => {
    const order: Record<string, number> = { overdue: 0, pending: 1, completed: 2 };
    return (order[a.status] ?? 1) - (order[b.status] ?? 1);
  });

  const [expandedFollowUps, setExpandedFollowUps] = useState<Set<number>>(new Set());
  const toggleFollowUpExpand = (fid: number) => {
    setExpandedFollowUps((prev) => {
      const next = new Set(prev);
      next.has(fid) ? next.delete(fid) : next.add(fid);
      return next;
    });
  };

  const overdueCount = followUps.filter((f) => f.status === 'overdue').length;
  const pendingCount = followUps.filter((f) => f.status === 'pending').length;

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 300,
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  if (!patient) {
    return <Empty description="患者不存在" />;
  }

  const records = patient.medical_records || [];
  const recordMap = new Map(records.map((r) => [r.id, r]));

  return (
    <>
    {/* 悬浮返回按钮 */}
    <div
      onClick={() => navigate('/patients', { state: { highlightPatientId: Number(id) } })}
      style={{
        position: 'fixed',
        top: isMobile ? 10 : 12,
        left: isMobile ? 60 : undefined,
        right: isMobile ? undefined : 200,
        zIndex: 999,
        background: '#1677ff',
        color: '#fff',
        padding: isMobile ? '6px 16px' : '6px 16px',
        borderRadius: 20,
        fontSize: isMobile ? 14 : 13,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      ← {isMobile ? '患者列表' : '返回患者列表'}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Top section: Patient basic info */}
      <Card
        title="患者信息"
        extra={
          <Space wrap>
            <Button
              icon={<EditOutlined />}
              onClick={() => setEditModalVisible(true)}
            >
              编辑
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate(`/records/new?patient_id=${patient.id}&from=patient`)}
            >
              新增就诊记录
            </Button>
          </Space>
        }
      >
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }}>
          <Descriptions.Item label="姓名">{patient.name}</Descriptions.Item>
          <Descriptions.Item label="性别">
            {patient.gender === 1 ? '男' : patient.gender === 2 ? '女' : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="年龄">
            {patient.age !== undefined ? `${patient.age}岁` : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="出生日期">
            {patient.birthday ? dayjs(patient.birthday).format('YYYY-MM-DD') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="体重(kg)">
            {patient.weight ? `${patient.weight}` : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="联系电话">
            {patient.phone ? <a href={`tel:${patient.phone}`}>{patient.phone}</a> : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="身份证号">
            {patient.id_card || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="现居住地">
            {patient.address || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="籍贯">
            {patient.native_place || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="备注" span={3}>
            {patient.notes || '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* Bottom section: Medical records timeline */}
      <Card title="就诊记录">
        {records.length === 0 ? (
          <Empty description="暂无就诊记录" />
        ) : (
          <Timeline
            mode={isMobile ? undefined : 'left'}
            items={records.map((record) => {
              const isExpanded = expandedRecords.has(record.id);
              const attachments = record.attachments || [];
              const prescriptions = record.prescriptions || [];
              const imageAttachments = attachments.filter(
                (a) => a.file_type === 'image'
              );
              const audioAttachments = attachments.filter(
                (a) => a.file_type === 'audio'
              );
              const videoAttachments = attachments.filter(
                (a) => a.file_type === 'video'
              );

              return {
                key: record.id,
                ...(isMobile ? {} : {
                  label: (
                    <Text type="secondary">
                      {record.visit_date?.slice(0, 10) || '-'}
                    </Text>
                  ),
                }),
                children: (
                  <div data-record-id={record.id}>
                    {/* Mobile: show date at top */}
                    {isMobile && (
                      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                        {record.visit_date?.slice(0, 10) || '-'}
                      </Text>
                    )}
                    {/* Summary line */}
                    <div style={{ marginBottom: 8 }}>
                      {record.diagnosis && (
                        <div>
                          <Text strong>诊断：</Text>
                          <Text>
                            {record.diagnosis.length > 80 && !isExpanded
                              ? `${record.diagnosis.slice(0, 80)}...`
                              : record.diagnosis}
                          </Text>
                        </div>
                      )}
                      {record.treatment && (
                        <div>
                          <Text strong>治疗方案：</Text>
                          <Text>
                            {record.treatment.length > 80 && !isExpanded
                              ? `${record.treatment.slice(0, 80)}...`
                              : record.treatment}
                          </Text>
                        </div>
                      )}
                    </div>

                    {/* Prescription summary - always visible */}
                    {prescriptions.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        {prescriptions.map((rx) => {
                          const isChargeOnly = !rx.items || rx.items.length === 0;
                          return (
                            <Tag key={rx.id} color={isChargeOnly ? 'orange' : 'geekblue'} style={{ marginBottom: 4 }}>
                              {isChargeOnly
                                ? '仅收诊疗费'
                                : <>{rx.formula_name || '自定义处方'} {rx.total_doses}付
                                    <span style={{ marginLeft: 4, fontSize: 12, opacity: 0.8 }}>
                                      ({rx.items.slice(0, 3).map(i => i.herb_name).join('、')}{rx.items.length > 3 ? '...' : ''})
                                    </span>
                                  </>
                              }
                            </Tag>
                          );
                        })}
                      </div>
                    )}

                    {/* Action buttons */}
                    <Space size="small">
                      <Button
                        type="link"
                        size="small"
                        style={{ padding: 0 }}
                        onClick={() => toggleExpand(record.id)}
                        icon={isExpanded ? <UpOutlined /> : <DownOutlined />}
                      >
                        {isExpanded ? '收起' : '展开'}
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={() => navigate(`/records/${record.id}?from=patient&patient_id=${patient.id}`)}
                      >
                        查看
                      </Button>
                      <Popconfirm
                        title="确定删除此诊疗记录？"
                        onConfirm={() => handleDeleteRecord(record.id)}
                        okText="确定"
                        cancelText="取消"
                      >
                        <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                          删除
                        </Button>
                      </Popconfirm>
                    </Space>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div
                        style={{
                          marginTop: 12,
                          padding: 12,
                          background: '#fafafa',
                          borderRadius: 8,
                        }}
                      >
                        {record.diagnosis && (
                          <div style={{ marginBottom: 8 }}>
                            <Text strong>诊断：</Text>
                            <Paragraph
                              style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}
                            >
                              {record.diagnosis}
                            </Paragraph>
                          </div>
                        )}

                        {record.treatment && (
                          <div style={{ marginBottom: 8 }}>
                            <Text strong>治疗方案：</Text>
                            <Paragraph
                              style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}
                            >
                              {record.treatment}
                            </Paragraph>
                          </div>
                        )}

                        {record.notes && (
                          <div style={{ marginBottom: 8 }}>
                            <Text strong>备注：</Text>
                            <Paragraph
                              style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}
                            >
                              {record.notes}
                            </Paragraph>
                          </div>
                        )}

                        {/* Image attachments */}
                        {imageAttachments.length > 0 && (
                          <div style={{ marginBottom: 8 }}>
                            <Text strong>图片：</Text>
                            <div style={{ marginTop: 4 }}>
                              <Image.PreviewGroup>
                                <Space wrap>
                                  {imageAttachments.map((att) => (
                                    <AuthImage
                                      key={att.id}
                                      fileKey={att.file_path}
                                      alt={att.file_name}
                                      width={120}
                                      height={90}
                                      style={{
                                        objectFit: 'cover',
                                        borderRadius: 4,
                                      }}
                                      fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/+F/PQAJpAN42sFkQAAAAABJRU5ErkJggg=="
                                    />
                                  ))}
                                </Space>
                              </Image.PreviewGroup>
                            </div>
                          </div>
                        )}

                        {/* Audio attachments */}
                        {audioAttachments.length > 0 && (
                          <div style={{ marginBottom: 8 }}>
                            <Text strong>音频：</Text>
                            <div
                              style={{
                                marginTop: 4,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                              }}
                            >
                              {audioAttachments.map((att) => (
                                <div key={att.id}>
                                  <Text
                                    type="secondary"
                                    style={{ fontSize: 12, display: 'block', marginBottom: 2 }}
                                  >
                                    {att.file_name}
                                  </Text>
                                  <AuthAudio
                                    key={att.id}
                                    fileKey={att.file_path}
                                    style={{ width: '100%', maxWidth: isMobile ? undefined : 400 }}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Video attachments */}
                        {videoAttachments.length > 0 && (
                          <div style={{ marginBottom: 8 }}>
                            <Text strong>视频：</Text>
                            <div
                              style={{
                                marginTop: 4,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                              }}
                            >
                              {videoAttachments.map((att) => (
                                <div key={att.id}>
                                  <Text
                                    type="secondary"
                                    style={{ fontSize: 12, display: 'block', marginBottom: 2 }}
                                  >
                                    {att.file_name}
                                  </Text>
                                  <AuthVideo
                                    key={att.id}
                                    fileKey={att.file_path}
                                    style={{
                                      width: '100%',
                                      maxWidth: isMobile ? undefined : 480,
                                      borderRadius: 4,
                                    }}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Prescriptions */}
                        {prescriptions.length > 0 && (
                          <div style={{ marginBottom: 8 }}>
                            <Text strong>处方：</Text>
                            <div style={{ marginTop: 4 }}>
                              {prescriptions.map((rx) => {
                                const isChargeOnly = !rx.items || rx.items.length === 0;
                                return (
                                  <div key={rx.id} data-prescription-id={rx.id} style={{ marginBottom: 8, padding: 8, background: '#fff', borderRadius: 4, border: '1px solid #e8e8e8' }}>
                                    {isChargeOnly ? (
                                      <Text type="secondary">仅收诊疗费处方</Text>
                                    ) : (
                                      <>
                                        <Space wrap>
                                          <Text strong>{rx.formula_name || '自定义处方'}</Text>
                                          <Tag color="blue">{rx.total_doses} 付</Tag>
                                        </Space>
                                        <div style={{ marginTop: 4, fontSize: 13 }}>
                                          {(rx.items || []).map((item) => `${item.herb_name} ${item.dosage}`).join('、')}
                                        </div>
                                      </>
                                    )}
                                    {rx.notes && (
                                      <div style={{ marginTop: 4, color: '#666', fontSize: 12 }}>
                                        医嘱：{rx.notes}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ),
              };
            })}
          />
        )}
      </Card>

      {/* Follow-up section */}
      <Card
        title={
          <Space>
            <span>回访记录</span>
            {overdueCount > 0 && <Badge count={overdueCount} style={{ backgroundColor: '#ff4d4f' }} />}
            {pendingCount > 0 && <Badge count={pendingCount} style={{ backgroundColor: '#1677ff' }} />}
          </Space>
        }
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size={isMobile ? 'small' : 'middle'}
            onClick={() => handleOpenFollowUpModal()}
          >
            新增回访
          </Button>
        }
        loading={followUpLoading}
      >
        {sortedFollowUps.length === 0 ? (
          <Empty description="暂无回访记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sortedFollowUps.map((item) => {
              const cfg = statusConfig[item.status] || statusConfig.pending;
              const isOverdue = item.status === 'overdue';
              return (
                <div
                  key={item.id}
                  className={lastSavedFollowUpId === item.id ? 'followup-saved-highlight' : undefined}
                  style={{
                    display: 'flex',
                    alignItems: isMobile ? 'flex-start' : 'center',
                    flexDirection: isMobile ? 'column' : 'row',
                    gap: isMobile ? 6 : 12,
                    padding: isMobile ? '10px 12px' : '10px 16px',
                    borderRadius: 8,
                    border: `1px solid ${isOverdue ? '#ffccc7' : '#f0f0f0'}`,
                    background: isOverdue ? '#fff2f0' : '#fafafa',
                  }}
                >
                  {/* Left: status + date + method */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexShrink: 0,
                    width: isMobile ? '100%' : undefined,
                  }}>
                    <Tag
                      color={cfg.color}
                      icon={cfg.icon}
                      style={{ margin: 0, fontSize: 12 }}
                    >
                      {cfg.label}
                    </Tag>
                    {item.is_recovered
                      ? <span style={recoveredTagStyle}>已康复</span>
                      : <span style={notRecoveredTagStyle}>未康复</span>
                    }
                    <span style={{ fontSize: 13, color: '#333', whiteSpace: 'nowrap' }}>
                      {item.planned_date}
                    </span>
                  </div>

                  {/* Middle: content + related record */}
                  <div style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 13,
                    color: '#666',
                    width: isMobile ? '100%' : undefined,
                  }}>
                    {item.content && !/^已[经]?康复$/.test(item.content.trim()) && (
                      <div style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {item.content}
                      </div>
                    )}
                    {item.status === 'completed' && item.actual_date && (
                      <span style={{ fontSize: 12, color: '#52c41a' }}>
                        完成于 {item.actual_date}
                      </span>
                    )}
                    {/* Related record: abbreviated tag + expand/link */}
                    {item.record_id && item.record_diagnosis && (() => {
                      const isExpanded = expandedFollowUps.has(item.id);
                      const linkedRecord = recordMap.get(item.record_id);
                      return (
                        <div style={{ marginTop: 4 }}>
                          <Space size={4} wrap>
                            <Tag
                              color="default"
                              style={{ fontSize: 11, cursor: 'pointer', margin: 0 }}
                              onClick={() => toggleFollowUpExpand(item.id)}
                            >
                              {isExpanded ? <UpOutlined /> : <DownOutlined />}
                              <span style={{ marginLeft: 4 }}>
                                诊疗 {item.record_visit_date || ''} {item.record_diagnosis.slice(0, 15)}{item.record_diagnosis.length > 15 ? '...' : ''}
                              </span>
                            </Tag>
                            <Button
                              type="link"
                              size="small"
                              style={{ padding: 0, fontSize: 12 }}
                              onClick={() => navigate(`/records/${item.record_id}`)}
                            >
                              查看
                            </Button>
                          </Space>
                          {isExpanded && linkedRecord && (
                            <div style={{
                              marginTop: 6,
                              padding: '8px 10px',
                              background: '#fff',
                              borderRadius: 6,
                              border: '1px solid #e8e8e8',
                              fontSize: 12,
                              color: '#555',
                            }}>
                              {linkedRecord.diagnosis && (
                                <div style={{ marginBottom: 4 }}>
                                  <Text strong style={{ fontSize: 12 }}>诊断：</Text>
                                  <span>{linkedRecord.diagnosis}</span>
                                </div>
                              )}
                              {linkedRecord.treatment && (
                                <div style={{ marginBottom: 4 }}>
                                  <Text strong style={{ fontSize: 12 }}>治疗：</Text>
                                  <span>{linkedRecord.treatment}</span>
                                </div>
                              )}
                              {(linkedRecord.prescriptions || []).length > 0 && (
                                <div>
                                  {linkedRecord.prescriptions.map((rx) => (
                                    <Tag key={rx.id} color="geekblue" style={{ fontSize: 11, marginBottom: 2 }}>
                                      {rx.formula_name || '自定义处方'} {rx.total_doses}付
                                    </Tag>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Right: actions */}
                  <Space size={4} style={{ flexShrink: 0 }}>
                    {item.status !== 'completed' && (
                      <Popconfirm
                        title="确认完成此回访？"
                        onConfirm={() => handleCompleteFollowUp(item)}
                        okText="确认"
                        cancelText="取消"
                      >
                        <Button type="link" size="small" style={{ padding: 0, color: '#52c41a' }}>
                          完成
                        </Button>
                      </Popconfirm>
                    )}
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0 }}
                      onClick={() => handleOpenFollowUpModal(item)}
                    >
                      编辑
                    </Button>
                    <Popconfirm
                      title="确定删除此回访记录？"
                      onConfirm={() => handleDeleteFollowUp(item.id)}
                      okText="确定"
                      cancelText="取消"
                    >
                      <Button type="link" size="small" danger style={{ padding: 0 }}>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Follow-up modal */}
      <Modal
        title={editingFollowUp ? '编辑回访' : '新增回访'}
        open={followUpModalOpen}
        onOk={handleFollowUpSave}
        onCancel={() => setFollowUpModalOpen(false)}
        confirmLoading={followUpSaving}
        width={isMobile ? '95%' : 480}
        destroyOnClose
      >
        <Form form={followUpForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="planned_date"
            label="计划回访日期"
            rules={[{ required: true, message: '请选择日期' }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="method"
            label="回访方式"
            rules={[{ required: true, message: '请选择方式' }]}
          >
            <Select
              onChange={(v: string) => setIsOtherMethod(v === '其他')}
              options={[
                { value: '电话', label: '电话' },
                { value: '微信', label: '微信' },
                { value: '到诊', label: '到诊' },
                { value: '其他', label: '其他' },
              ]}
            />
          </Form.Item>
          {isOtherMethod && (
            <Form.Item name="custom_method" label="自定义方式" rules={[{ required: true, message: '请输入方式' }]}>
              <Input maxLength={50} />
            </Form.Item>
          )}
          {records.length > 0 && (
            <Form.Item name="record_id" label="关联诊疗记录" rules={[{ required: true, message: '请选择关联诊疗记录' }]}>
              <Select
                placeholder="选择关联的诊疗记录"
                options={records.map((r) => ({
                  value: r.id,
                  label: `${r.visit_date?.slice(0, 10)} ${r.diagnosis?.slice(0, 30) || '(无诊断)'}`,
                }))}
              />
            </Form.Item>
          )}
          {editingFollowUp && (
            <Form.Item name="actual_date" label="实际回访日期" extra="清空此日期后，状态将恢复为待回访">
              <DatePicker style={{ width: '100%' }} placeholder="填写后自动标记为已完成" />
            </Form.Item>
          )}
          {editingFollowUp && (
            <Form.Item name="is_recovered" label="是否康复" valuePropName="checked">
              <Switch checkedChildren="已康复" unCheckedChildren="未康复" />
            </Form.Item>
          )}
          <Form.Item name="content" label="回访内容">
            <Input.TextArea rows={3} maxLength={2000} showCount placeholder="记录回访情况..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit patient modal */}
      <PatientFormModal
        visible={editModalVisible}
        onClose={() => setEditModalVisible(false)}
        onSuccess={handleEditSuccess}
        initialData={
          patient
            ? {
                id: patient.id,
                name: patient.name,
                gender: patient.gender,
                age: patient.age,
                birthday: patient.birthday,
                weight: patient.weight,
                phone: patient.phone,
                id_card: patient.id_card,
                address: patient.address,
                native_place: patient.native_place,
                notes: patient.notes,
              }
            : undefined
        }
      />
    </div>
    <style>{`
      @keyframes followup-saved-flash {
        0% { box-shadow: inset 0 0 0 2px #52c41a; background: #f6ffed; }
        100% { box-shadow: none; background: transparent; }
      }
      .followup-saved-highlight {
        box-shadow: inset 0 0 0 2px #52c41a;
        animation: followup-saved-flash 5s ease-in-out forwards;
      }
    `}</style>
    </>
  );
}
