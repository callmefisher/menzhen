import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Form,
  Input,
  Button,
  Select,
  DatePicker,
  Card,
  Space,
  message,
  Spin,
  Modal,
  InputNumber,
  Radio,
  Divider,
  List,
  Tag,
  Popconfirm,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { getRecord, createRecord, updateRecord } from '../../api/record';
import { listPatients, createPatient } from '../../api/patient';
import {
  listPrescriptionsByRecord,
  deletePrescription,
} from '../../api/prescription';
import type { PrescriptionData } from '../../api/prescription';
import FileUpload from '../../components/FileUpload';
import type { AttachmentInfo } from '../../components/FileUpload';
import PrescriptionModal from '../../components/PrescriptionModal';
import PrescriptionPrint from '../../components/PrescriptionPrint';
import { useAuth } from '../../store/auth';

interface PatientOption {
  id: number;
  name: string;
  gender: number;
  age: number;
  phone: string;
}

interface RecordFormValues {
  patient_id: number;
  visit_date: Dayjs;
  diagnosis: string;
  treatment: string;
  notes: string;
  attachments: AttachmentInfo[];
}

interface NewPatientFormValues {
  name: string;
  gender: number;
  age: number;
  weight?: number;
  phone?: string;
  id_card?: string;
}

export default function RecordForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const { hasPermission } = useAuth();

  const [form] = Form.useForm<RecordFormValues>();
  const [patientForm] = Form.useForm<NewPatientFormValues>();

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [patientLoading, setPatientLoading] = useState(false);
  const [patientModalOpen, setPatientModalOpen] = useState(false);
  const [patientCreating, setPatientCreating] = useState(false);

  // Prescription state
  const [prescriptions, setPrescriptions] = useState<PrescriptionData[]>([]);
  const [prescriptionModalOpen, setPrescriptionModalOpen] = useState(false);
  const [editingPrescription, setEditingPrescription] = useState<PrescriptionData | null>(null);

  // Record data for prescription print
  const [recordPatient, setRecordPatient] = useState<PatientOption | null>(null);
  const [recordVisitDate, setRecordVisitDate] = useState<string>('');

  // Debounce timer ref for patient search
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search patients by name
  const searchPatients = useCallback(async (name?: string) => {
    setPatientLoading(true);
    try {
      const res = await listPatients({ name, page: 1, size: 50 });
      const body = res as unknown as {
        data: { list: PatientOption[]; total: number };
      };
      setPatients(body.data.list || []);
    } catch {
      // Error already handled by request interceptor
    } finally {
      setPatientLoading(false);
    }
  }, []);

  // Load prescriptions for this record
  const loadPrescriptions = useCallback(async () => {
    if (!id) return;
    try {
      const res = await listPrescriptionsByRecord(Number(id));
      const body = res as unknown as { data: PrescriptionData[] };
      setPrescriptions(body.data || []);
    } catch {
      // handled
    }
  }, [id]);

  // Initial load of patients
  useEffect(() => {
    searchPatients();
  }, [searchPatients]);

  // Load record data in edit mode
  useEffect(() => {
    if (!id) return;

    const loadRecord = async () => {
      setLoading(true);
      try {
        const res = await getRecord(Number(id));
        const body = res as unknown as {
          data: {
            id: number;
            patient_id: number;
            diagnosis: string;
            treatment: string;
            notes: string;
            visit_date: string;
            attachments: AttachmentInfo[];
            patient: PatientOption;
          };
        };

        const record = body.data;

        // Store patient & visit date for prescription print
        if (record.patient) {
          setRecordPatient(record.patient);
          setPatients((prev) => {
            const exists = prev.some((p) => p.id === record.patient.id);
            if (!exists) {
              return [...prev, record.patient];
            }
            return prev;
          });
        }
        setRecordVisitDate(record.visit_date);

        form.setFieldsValue({
          patient_id: record.patient_id,
          visit_date: dayjs(record.visit_date),
          diagnosis: record.diagnosis || '',
          treatment: record.treatment || '',
          notes: record.notes || '',
          attachments: record.attachments || [],
        });
      } catch {
        message.error('加载诊疗记录失败');
        navigate('/records');
      } finally {
        setLoading(false);
      }
    };

    loadRecord();
    loadPrescriptions();
  }, [id, form, navigate, loadPrescriptions]);

  const handlePatientSearch = (value: string) => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = setTimeout(() => {
      searchPatients(value || undefined);
    }, 300);
  };

  const handleCreatePatient = async () => {
    try {
      const values = await patientForm.validateFields();
      setPatientCreating(true);

      const res = await createPatient(values);
      const body = res as unknown as {
        data: PatientOption;
      };

      const newPatient = body.data;
      setPatients((prev) => [newPatient, ...prev]);
      form.setFieldValue('patient_id', newPatient.id);

      message.success('患者创建成功');
      setPatientModalOpen(false);
      patientForm.resetFields();
    } catch {
      // Validation or API error
    } finally {
      setPatientCreating(false);
    }
  };

  const handleSubmit = async (values: RecordFormValues) => {
    setSubmitting(true);
    try {
      const payload = {
        patient_id: values.patient_id,
        visit_date: values.visit_date.format('YYYY-MM-DD'),
        diagnosis: values.diagnosis || '',
        treatment: values.treatment || '',
        notes: values.notes || '',
        attachments: values.attachments || [],
      };

      if (isEdit) {
        await updateRecord(Number(id), {
          diagnosis: payload.diagnosis,
          treatment: payload.treatment,
          notes: payload.notes,
          visit_date: payload.visit_date,
          attachments: payload.attachments,
        });
        message.success('诊疗记录更新成功');
      } else {
        await createRecord(payload);
        message.success('诊疗记录创建成功');
      }
      navigate('/records');
    } catch {
      // Error already handled by request interceptor
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeletePrescription = async (prescriptionId: number) => {
    try {
      await deletePrescription(prescriptionId);
      message.success('处方已删除');
      loadPrescriptions();
    } catch {
      // handled
    }
  };

  const handleOpenPrescriptionModal = (prescription?: PrescriptionData) => {
    setEditingPrescription(prescription || null);
    setPrescriptionModalOpen(true);
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

  return (
    <Card title={isEdit ? '编辑诊疗记录' : '新增诊疗记录'}>
      <Form<RecordFormValues>
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        style={{ maxWidth: 720 }}
        initialValues={{
          attachments: [],
        }}
      >
        {/* 患者选择 */}
        <Form.Item
          label="患者"
          name="patient_id"
          rules={[{ required: true, message: '请选择患者' }]}
        >
          <Select
            showSearch
            placeholder="搜索患者姓名"
            filterOption={false}
            onSearch={handlePatientSearch}
            loading={patientLoading}
            notFoundContent={patientLoading ? <Spin size="small" /> : '无匹配患者'}
            options={patients.map((p) => ({
              value: p.id,
              label: `${p.name}${p.gender === 1 ? '(男)' : p.gender === 2 ? '(女)' : ''} ${p.age ? p.age + '岁' : ''}`,
            }))}
            dropdownRender={(menu) => (
              <>
                {menu}
                <div
                  style={{
                    padding: '8px 12px',
                    borderTop: '1px solid #f0f0f0',
                  }}
                >
                  <Button
                    type="link"
                    icon={<PlusOutlined />}
                    onClick={() => setPatientModalOpen(true)}
                    style={{ padding: 0 }}
                  >
                    新建患者
                  </Button>
                </div>
              </>
            )}
          />
        </Form.Item>

        {/* 就诊日期 */}
        <Form.Item
          label="就诊日期"
          name="visit_date"
          rules={[{ required: true, message: '请选择就诊日期' }]}
        >
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>

        {/* 诊断 */}
        <Form.Item label="诊断" name="diagnosis">
          <Input.TextArea rows={4} placeholder="请输入诊断内容" />
        </Form.Item>

        {/* 治疗方案 */}
        <Form.Item label="治疗方案" name="treatment">
          <Input.TextArea rows={4} placeholder="请输入治疗方案" />
        </Form.Item>

        {/* 备注 */}
        <Form.Item label="备注" name="notes">
          <Input.TextArea rows={2} placeholder="请输入备注" />
        </Form.Item>

        {/* 附件上传 */}
        <Form.Item label="附件上传" name="attachments">
          <FileUpload />
        </Form.Item>

        {/* 按钮 */}
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={submitting}>
              保存
            </Button>
            <Button onClick={() => navigate('/records')}>取消</Button>
          </Space>
        </Form.Item>
      </Form>

      {/* 处方区域 - 仅在编辑模式下显示 */}
      {isEdit && hasPermission('prescription:read') && (
        <>
          <Divider />
          <div style={{ maxWidth: 720 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <h3 style={{ margin: 0 }}>处方</h3>
              {hasPermission('prescription:create') && (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => handleOpenPrescriptionModal()}
                >
                  开方
                </Button>
              )}
            </div>

            {prescriptions.length > 0 ? (
              <List
                dataSource={prescriptions}
                renderItem={(item) => (
                  <List.Item
                    actions={[
                      <PrescriptionPrint
                        key="print"
                        prescription={item}
                        patientName={recordPatient?.name}
                        patientAge={recordPatient?.age}
                        visitDate={recordVisitDate}
                      />,
                      ...(hasPermission('prescription:create')
                        ? [
                            <Button
                              key="edit"
                              type="text"
                              size="small"
                              icon={<EditOutlined />}
                              onClick={() => handleOpenPrescriptionModal(item)}
                            >
                              编辑
                            </Button>,
                            <Popconfirm
                              key="delete"
                              title="确定删除此处方？"
                              onConfirm={() => handleDeletePrescription(item.id)}
                              okText="删除"
                              cancelText="取消"
                            >
                              <Button type="text" size="small" danger icon={<DeleteOutlined />}>
                                删除
                              </Button>
                            </Popconfirm>,
                          ]
                        : []),
                    ]}
                  >
                    <List.Item.Meta
                      title={
                        <Space>
                          <span>{item.formula_name || '自定义处方'}</span>
                          <Tag color="blue">{item.total_doses} 付</Tag>
                          {item.creator?.real_name && (
                            <Tag>{item.creator.real_name}</Tag>
                          )}
                        </Space>
                      }
                      description={
                        <div>
                          <div>
                            {(item.items || [])
                              .map((herb) => `${herb.herb_name} ${herb.dosage}${herb.notes ? '(' + herb.notes + ')' : ''}`)
                              .join('、')}
                          </div>
                          {item.notes && (
                            <div style={{ marginTop: 4, color: '#666' }}>
                              医嘱：{item.notes}
                            </div>
                          )}
                        </div>
                      }
                    />
                  </List.Item>
                )}
              />
            ) : (
              <div style={{ color: '#999', textAlign: 'center', padding: 24 }}>
                暂无处方
              </div>
            )}
          </div>
        </>
      )}

      {/* 开方弹窗 */}
      {prescriptionModalOpen && (
        <PrescriptionModal
          open={prescriptionModalOpen}
          recordId={Number(id)}
          editData={editingPrescription}
          onClose={() => {
            setPrescriptionModalOpen(false);
            setEditingPrescription(null);
          }}
          onSuccess={loadPrescriptions}
        />
      )}

      {/* 新建患者弹窗 */}
      <Modal
        title="新建患者"
        open={patientModalOpen}
        onOk={handleCreatePatient}
        onCancel={() => {
          setPatientModalOpen(false);
          patientForm.resetFields();
        }}
        confirmLoading={patientCreating}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Form<NewPatientFormValues>
          form={patientForm}
          layout="vertical"
          initialValues={{ gender: 1 }}
        >
          <Form.Item
            label="姓名"
            name="name"
            rules={[{ required: true, message: '请输入患者姓名' }]}
          >
            <Input placeholder="请输入患者姓名" />
          </Form.Item>

          <Form.Item
            label="性别"
            name="gender"
            rules={[{ required: true, message: '请选择性别' }]}
          >
            <Radio.Group>
              <Radio value={1}>男</Radio>
              <Radio value={2}>女</Radio>
            </Radio.Group>
          </Form.Item>

          <Form.Item
            label="年龄"
            name="age"
            rules={[{ required: true, message: '请输入年龄' }]}
          >
            <InputNumber min={0} max={200} style={{ width: '100%' }} placeholder="请输入年龄" />
          </Form.Item>

          <Form.Item label="体重 (kg)" name="weight">
            <InputNumber min={0} max={500} step={0.1} style={{ width: '100%' }} placeholder="请输入体重" />
          </Form.Item>

          <Form.Item label="手机号" name="phone">
            <Input placeholder="请输入手机号" />
          </Form.Item>

          <Form.Item label="身份证号" name="id_card">
            <Input placeholder="请输入身份证号" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
