import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
  Tag,
  Drawer,
  Tooltip,
  Dropdown,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, RobotOutlined, ReloadOutlined, MoreOutlined, MedicineBoxOutlined, InboxOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getRecord, createRecord, updateRecord, aiAnalyzeDiagnosis, getCachedAiAnalysis, saveAiAnalysis } from '../../api/record';
import { listPatients, createPatient, getPatient } from '../../api/patient';
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
  address?: string;
  native_place?: string;
  notes?: string;
}

export default function RecordForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
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

  // Debounce timer ref for patient search
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // AI analysis state
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<string>('');
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [aiCached, setAiCached] = useState(false);

  // Search patients by name
  const searchPatients = useCallback(async (name?: string) => {
    setPatientLoading(true);
    try {
      const res = await listPatients({ name, page: 1, size: 10 });
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

  // Auto-fill patient from URL query param (e.g., ?patient_id=123)
  useEffect(() => {
    if (isEdit) return; // Only for new records
    const patientIdParam = searchParams.get('patient_id');
    if (!patientIdParam) return;
    const patientId = Number(patientIdParam);
    if (!patientId) return;

    // Check if patient is already in the loaded list
    const found = patients.find((p) => p.id === patientId);
    if (found) {
      form.setFieldValue('patient_id', patientId);
    } else {
      // Fetch the specific patient and add to options
      getPatient(patientId)
        .then((res) => {
          const body = res as unknown as { data: PatientOption };
          const p = body.data;
          if (p) {
            setPatients((prev) => {
              const exists = prev.some((item) => item.id === p.id);
              if (!exists) return [p, ...prev];
              return prev;
            });
            form.setFieldValue('patient_id', p.id);
          }
        })
        .catch(() => {
          // Patient not found or no access — ignore
        });
    }
    // Only run when patients list is first loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patients.length]);

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

    // Load cached AI analysis
    const loadCachedAnalysis = async () => {
      try {
        const res = await getCachedAiAnalysis(Number(id));
        const body = res as unknown as { data: { analysis: string | null; diagnosis: string; cached: boolean } };
        if (body.data.analysis) {
          setAiResult(body.data.analysis);
          setAiCached(true);
        }
      } catch {
        // No cached analysis — ignore
      }
    };
    loadCachedAnalysis();
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
        navigate('/records');
      } else {
        const res = await createRecord(payload);
        const body = res as unknown as { data: { id: number } };
        message.success('诊疗记录创建成功');
        // If AI analysis was done before save, persist it to the new record
        if (body.data?.id && aiResult) {
          try {
            await saveAiAnalysis(body.data.id, payload.diagnosis, aiResult);
          } catch {
            // Non-critical, ignore
          }
        }
        // Redirect to edit page so user can immediately add prescriptions
        if (body.data?.id) {
          navigate(`/records/${body.data.id}`);
        } else {
          navigate('/records');
        }
      }
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

  const handleAiAnalysis = async (force = false) => {
    const diagnosis = form.getFieldValue('diagnosis');
    if (!diagnosis?.trim()) {
      message.warning('请先输入诊断内容');
      return;
    }
    setAiAnalyzing(true);
    setAiDrawerOpen(true);
    setAiResult('');
    setAiCached(false);
    try {
      const recordId = id ? Number(id) : undefined;
      const res = await aiAnalyzeDiagnosis(diagnosis.trim(), recordId, force);
      const body = res as unknown as { data: { analysis: string; cached: boolean } };
      setAiResult(body.data.analysis || '未获取到分析结果');
      setAiCached(body.data.cached);
    } catch {
      setAiResult('AI 分析请求失败，请稍后重试');
    } finally {
      setAiAnalyzing(false);
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
        initialValues={{
          attachments: [],
          visit_date: isEdit ? undefined : dayjs(),
          diagnosis: isEdit ? undefined : `1. 大便：
2. 小便：
3. 胃口：
4. 腹泻，腹胀，腹痛：
5. 年龄，体重，心率，血压，正在服用的降压药降糖药等：
6. 口干舌燥，反酸口臭，口苦，烧心，呕吐：
7. 头痛，头晕，腰膝酸软，水肿情况：
8. 四肢凉热，出汗，手心脚心发烫情况：
9. 寒热往来，发热出汗情况等：
10. 饮食喜好习惯，饮酒吸烟等：
11. 脾气：
12. 睡眠：
13. 胆结石，肾结石等手术史：
14. 耳鸣/耳聋：
15. 面色：
16. 口渴情况：
17. 肝脏类诊断情况：
18. 感冒情况等：
19. 压力和生活工作环境：
20. 舌苔，舌体情况：`,
        }}
      >
        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item
            label="患者"
            name="patient_id"
            rules={[{ required: true, message: '请选择患者' }]}
            style={{ flex: 1 }}
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

          <Form.Item
            label="就诊日期"
            name="visit_date"
            rules={[{ required: true, message: '请选择就诊日期' }]}
            style={{ width: 200 }}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </div>

        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item
            label={
              <Space>
                <span>诊断</span>
                <Button
                  type="primary"
                  ghost
                  size="small"
                  icon={<RobotOutlined />}
                  loading={aiAnalyzing}
                  onClick={() => handleAiAnalysis()}
                >
                  AI辅助分析
                </Button>
                {aiResult && !aiDrawerOpen && (
                  <Tooltip title="已有分析结果，点击查看">
                    <Tag
                      color="green"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setAiDrawerOpen(true)}
                    >
                      已有分析
                    </Tag>
                  </Tooltip>
                )}
              </Space>
            }
            name="diagnosis"
            style={{ flex: 1 }}
          >
            <Input.TextArea rows={22} placeholder="请输入诊断内容" />
          </Form.Item>

          <Form.Item label="治疗方案" name="treatment" style={{ flex: 1 }}>
            <Input.TextArea rows={22} placeholder="请输入治疗方案" />
          </Form.Item>
        </div>

        <Divider style={{ margin: '8px 0 16px' }} />

        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <Form.Item label="备注" name="notes" style={{ flex: 1, marginBottom: 0 }}>
            <Input.TextArea
              rows={6}
              placeholder="请输入备注"
              style={{ resize: 'none', minHeight: 160 }}
            />
          </Form.Item>

          <Form.Item label="附件上传" name="attachments" style={{ flex: 1, marginBottom: 0 }}>
            <FileUpload />
          </Form.Item>
        </div>

        <div style={{ height: 24 }} />

        {/* 按钮 */}
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={submitting}>
              保存
            </Button>
            {hasPermission('prescription:create') && (
              <Button
                type="primary"
                ghost
                icon={<PlusOutlined />}
                onClick={async () => {
                  if (!isEdit) {
                    // For new records, save first, then open prescription modal
                    try {
                      const values = await form.validateFields();
                      setSubmitting(true);
                      const payload = {
                        patient_id: values.patient_id,
                        visit_date: values.visit_date.format('YYYY-MM-DD'),
                        diagnosis: values.diagnosis || '',
                        treatment: values.treatment || '',
                        notes: values.notes || '',
                        attachments: values.attachments || [],
                      };
                      const res = await createRecord(payload);
                      const body = res as unknown as { data: { id: number } };
                      message.success('诊疗记录已保存');
                      if (body.data?.id && aiResult) {
                        try {
                          await saveAiAnalysis(body.data.id, payload.diagnosis, aiResult);
                        } catch {
                          // Non-critical
                        }
                      }
                      if (body.data?.id) {
                        navigate(`/records/${body.data.id}`);
                      }
                    } catch {
                      // validation error
                    } finally {
                      setSubmitting(false);
                    }
                  } else {
                    handleOpenPrescriptionModal();
                  }
                }}
                loading={submitting}
              >
                开方
              </Button>
            )}
            <Button onClick={() => navigate('/records')}>取消</Button>
          </Space>
        </Form.Item>
      </Form>

      {/* 处方区域 - 编辑模式下显示处方列表 */}
      {isEdit && hasPermission('prescription:read') && (
        <>
          <Divider />
          <div style={{
            background: '#fafafa',
            borderRadius: 8,
            padding: '20px 24px',
            border: '1px solid #f0f0f0',
          }}>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {prescriptions.map((item) => (
                  <Card
                    key={item.id}
                    size="small"
                    style={{ borderRadius: 8 }}
                    title={
                      <Space size={8}>
                        <MedicineBoxOutlined style={{ color: '#1677ff' }} />
                        <span style={{ fontWeight: 500 }}>{item.formula_name || '自定义处方'}</span>
                        <Tag color="blue" style={{ marginLeft: 4 }}>{item.total_doses} 付</Tag>
                      </Space>
                    }
                    extra={
                      <Space size={4}>
                        <PrescriptionPrint
                          key="print"
                          prescription={item}
                          patientName={recordPatient?.name}
                          patientAge={recordPatient?.age}
                        />
                        {hasPermission('prescription:create') && (
                          <Dropdown
                            menu={{
                              items: [
                                {
                                  key: 'edit',
                                  icon: <EditOutlined />,
                                  label: '编辑',
                                  onClick: () => handleOpenPrescriptionModal(item),
                                },
                                { type: 'divider' },
                                {
                                  key: 'delete',
                                  icon: <DeleteOutlined />,
                                  label: '删除',
                                  danger: true,
                                  onClick: () => {
                                    Modal.confirm({
                                      title: '确定删除此处方？',
                                      content: '删除后不可恢复',
                                      okText: '删除',
                                      okButtonProps: { danger: true },
                                      cancelText: '取消',
                                      onOk: () => handleDeletePrescription(item.id),
                                    });
                                  },
                                },
                              ],
                            }}
                            trigger={['click']}
                          >
                            <Button type="text" size="small" icon={<MoreOutlined />} />
                          </Dropdown>
                        )}
                      </Space>
                    }
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', lineHeight: '26px' }}>
                      {(item.items || []).map((herb) => (
                        <span key={herb.id} style={{ whiteSpace: 'nowrap' }}>
                          <span>{herb.herb_name}</span>
                          <span style={{ color: '#1677ff', marginLeft: 4 }}>{herb.dosage}g</span>
                          {herb.notes && <span style={{ color: '#999', marginLeft: 2 }}>({herb.notes})</span>}
                        </span>
                      ))}
                    </div>
                    {item.notes && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #f0f0f0', color: '#666', fontSize: 13 }}>
                        <div style={{ marginBottom: 2 }}>医嘱：</div>
                        {item.notes.split('\n').map((line, idx) => (
                          <div key={idx}>{line}</div>
                        ))}
                      </div>
                    )}
                    {item.creator?.real_name && (
                      <div style={{ marginTop: 6, fontSize: 12, color: '#999', textAlign: 'right' }}>
                        开方医师：{item.creator.real_name}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            ) : (
              <div style={{
                color: '#999',
                textAlign: 'center',
                padding: '32px 24px',
                border: '1px dashed #d9d9d9',
                borderRadius: 8,
                background: '#fff',
              }}>
                <InboxOutlined style={{ fontSize: 32, color: '#bfbfbf', display: 'block', marginBottom: 8 }} />
                暂无处方，点击上方「开方」添加
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

          <Form.Item label="现居住地" name="address">
            <Input placeholder="请输入现居住地" />
          </Form.Item>

          <Form.Item label="籍贯" name="native_place">
            <Input placeholder="请输入籍贯" />
          </Form.Item>

          <Form.Item label="备注" name="notes">
            <Input.TextArea rows={3} placeholder="请输入备注" />
          </Form.Item>
        </Form>
      </Modal>

      {/* AI辅助分析抽屉 */}
      <Drawer
        title={
          <Space>
            <RobotOutlined style={{ color: '#1677ff' }} />
            <span>AI 辅助辩证论治分析</span>
            {aiCached && !aiAnalyzing && (
              <Tag color="green">缓存</Tag>
            )}
          </Space>
        }
        placement="right"
        width={720}
        open={aiDrawerOpen}
        onClose={() => setAiDrawerOpen(false)}
        styles={{
          body: { padding: 0 },
        }}
        extra={
          aiResult && !aiAnalyzing ? (
            <Tooltip title="忽略缓存，重新调用 AI 分析">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => handleAiAnalysis(true)}
              >
                重新分析
              </Button>
            </Tooltip>
          ) : undefined
        }
      >
        {aiAnalyzing ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 400,
            gap: 24,
          }}>
            <Spin size="large" />
            <div style={{ color: '#666', fontSize: 15 }}>
              AI 正在从中医学、现代医学等多维度进行辩证论治分析...
            </div>
            <div style={{ color: '#999', fontSize: 13 }}>
              分析较为详尽，请耐心等候（约 30-60 秒）
            </div>
          </div>
        ) : (
          <div style={{ padding: '24px 32px' }}>
            <div style={{
              background: 'linear-gradient(135deg, #e8f4fd 0%, #f0e6ff 100%)',
              borderRadius: 12,
              padding: '16px 20px',
              marginBottom: 24,
              border: '1px solid #d4e8f7',
            }}>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>分析依据 — 诊断内容</div>
              <div style={{ fontSize: 14, color: '#333', fontWeight: 500 }}>
                {form.getFieldValue('diagnosis') || '—'}
              </div>
            </div>
            <div
              className="ai-analysis-content"
              style={{
                fontSize: 14,
                lineHeight: 1.8,
                color: '#333',
              }}
            >
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => (
                    <h2 style={{
                      fontSize: 20,
                      fontWeight: 600,
                      color: '#1a1a1a',
                      borderBottom: '2px solid #1677ff',
                      paddingBottom: 8,
                      marginTop: 28,
                      marginBottom: 16,
                    }}>{children}</h2>
                  ),
                  h2: ({ children }) => (
                    <h3 style={{
                      fontSize: 17,
                      fontWeight: 600,
                      color: '#262626',
                      borderLeft: '3px solid #1677ff',
                      paddingLeft: 12,
                      marginTop: 24,
                      marginBottom: 12,
                    }}>{children}</h3>
                  ),
                  h3: ({ children }) => (
                    <h4 style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: '#434343',
                      marginTop: 20,
                      marginBottom: 8,
                    }}>{children}</h4>
                  ),
                  p: ({ children }) => (
                    <p style={{ margin: '8px 0', lineHeight: 1.8 }}>{children}</p>
                  ),
                  ul: ({ children }) => (
                    <ul style={{ paddingLeft: 20, margin: '8px 0' }}>{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol style={{ paddingLeft: 20, margin: '8px 0' }}>{children}</ol>
                  ),
                  li: ({ children }) => (
                    <li style={{ marginBottom: 4, lineHeight: 1.8 }}>{children}</li>
                  ),
                  strong: ({ children }) => (
                    <strong style={{ color: '#1a1a1a' }}>{children}</strong>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote style={{
                      borderLeft: '4px solid #d9d9d9',
                      paddingLeft: 16,
                      margin: '12px 0',
                      color: '#595959',
                      fontStyle: 'italic',
                      background: '#fafafa',
                      padding: '8px 16px',
                      borderRadius: '0 4px 4px 0',
                    }}>{children}</blockquote>
                  ),
                  hr: () => (
                    <hr style={{
                      border: 'none',
                      borderTop: '1px solid #f0f0f0',
                      margin: '20px 0',
                    }} />
                  ),
                  table: ({ children }) => (
                    <div style={{ overflowX: 'auto', margin: '16px 0' }}>
                      <table style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: 14,
                        lineHeight: 1.6,
                      }}>{children}</table>
                    </div>
                  ),
                  thead: ({ children }) => (
                    <thead style={{
                      background: '#fafafa',
                    }}>{children}</thead>
                  ),
                  tbody: ({ children }) => (
                    <tbody>{children}</tbody>
                  ),
                  tr: ({ children }) => (
                    <tr style={{
                      borderBottom: '1px solid #f0f0f0',
                    }}>{children}</tr>
                  ),
                  th: ({ children }) => (
                    <th style={{
                      padding: '10px 12px',
                      textAlign: 'left',
                      fontWeight: 600,
                      color: '#262626',
                      borderBottom: '2px solid #e8e8e8',
                      whiteSpace: 'nowrap',
                    }}>{children}</th>
                  ),
                  td: ({ children }) => (
                    <td style={{
                      padding: '10px 12px',
                      color: '#434343',
                      borderBottom: '1px solid #f5f5f5',
                    }}>{children}</td>
                  ),
                }}
              >
                {aiResult}
              </Markdown>
            </div>
            <Divider />
            <div style={{
              fontSize: 12,
              color: '#999',
              textAlign: 'center',
              padding: '8px 0',
            }}>
              以上分析由 AI 生成，仅供参考，请结合临床经验综合判断
            </div>
          </div>
        )}
      </Drawer>
    </Card>
  );
}
