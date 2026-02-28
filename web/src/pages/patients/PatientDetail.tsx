import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
} from 'antd';
import {
  EditOutlined,
  PlusOutlined,
  DownOutlined,
  UpOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { getPatient } from '../../api/patient';
import { deleteRecord } from '../../api/record';
import type { PrescriptionData } from '../../api/prescription';
import { getFileUrl } from '../../api/upload';
import dayjs from 'dayjs';
import { PatientFormModal } from './PatientForm';

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
  const { id } = useParams<{ id: string }>();

  const [patient, setPatient] = useState<PatientData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedRecords, setExpandedRecords] = useState<Set<number>>(new Set());
  const [editModalVisible, setEditModalVisible] = useState(false);

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
  }, [fetchPatient]);

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

  return (
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
              onClick={() => navigate(`/records/new?patient_id=${patient.id}`)}
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
            {patient.phone || '-'}
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
            mode="left"
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
                label: (
                  <Text type="secondary">
                    {record.visit_date?.slice(0, 10) || '-'}
                  </Text>
                ),
                children: (
                  <div>
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
                        {prescriptions.map((rx) => (
                          <Tag key={rx.id} color="geekblue" style={{ marginBottom: 4 }}>
                            {rx.formula_name || '自定义处方'} {rx.total_doses}付
                            {rx.items && rx.items.length > 0 && (
                              <span style={{ marginLeft: 4, fontSize: 12, opacity: 0.8 }}>
                                ({rx.items.slice(0, 3).map(i => i.herb_name).join('、')}{rx.items.length > 3 ? '...' : ''})
                              </span>
                            )}
                          </Tag>
                        ))}
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
                        icon={<EditOutlined />}
                        onClick={() => navigate(`/records/${record.id}`)}
                      >
                        编辑
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
                                    <Image
                                      key={att.id}
                                      src={getFileUrl(att.file_path)}
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
                                  <audio
                                    controls
                                    src={getFileUrl(att.file_path)}
                                    style={{ width: '100%', maxWidth: 400 }}
                                  >
                                    您的浏览器不支持音频播放
                                  </audio>
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
                                  <video
                                    controls
                                    src={getFileUrl(att.file_path)}
                                    style={{
                                      width: '100%',
                                      maxWidth: 480,
                                      borderRadius: 4,
                                    }}
                                  >
                                    您的浏览器不支持视频播放
                                  </video>
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
                              {prescriptions.map((rx) => (
                                <div key={rx.id} style={{ marginBottom: 8, padding: 8, background: '#fff', borderRadius: 4, border: '1px solid #e8e8e8' }}>
                                  <Space>
                                    <Text strong>{rx.formula_name || '自定义处方'}</Text>
                                    <Tag color="blue">{rx.total_doses} 付</Tag>
                                  </Space>
                                  <div style={{ marginTop: 4, fontSize: 13 }}>
                                    {(rx.items || []).map((item) => `${item.herb_name} ${item.dosage}`).join('、')}
                                  </div>
                                  {rx.notes && (
                                    <div style={{ marginTop: 4, color: '#666', fontSize: 12 }}>
                                      医嘱：{rx.notes}
                                    </div>
                                  )}
                                </div>
                              ))}
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
  );
}
