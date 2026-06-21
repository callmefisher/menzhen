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
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, RobotOutlined, ReloadOutlined, MedicineBoxOutlined, InboxOutlined, SearchOutlined, DownOutlined, RightOutlined, DollarOutlined, CheckOutlined, PrinterOutlined, LeftOutlined, HistoryOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { getRecord, createRecord, updateRecord, getCachedAiAnalysis, saveAiAnalysis } from '../../api/record';
// Legacy non-streaming import kept for potential switch-back:
// import { aiAnalyzeDiagnosis } from '../../api/record';
import { streamAiAnalysis, streamTongueAnalysis } from '../../utils/sse';
import { listPatients, createPatient, getPatient } from '../../api/patient';
import {
  listPrescriptionsByRecord,
  deletePrescription,
  createPrescription,
} from '../../api/prescription';
import type { PrescriptionData } from '../../api/prescription';
import FileUpload from '../../components/FileUpload';
import type { AttachmentInfo } from '../../components/FileUpload';
import PrescriptionModal from '../../components/PrescriptionModal';
import PrescriptionPrint from '../../components/PrescriptionPrint';
import BillingDrawer from '../../components/BillingDrawer';
import PrintCenterDrawer from '../../components/PrintCenterDrawer';
import FollowUpPanel from '../../components/FollowUpPanel';
import HistoryRecordSelectModal from '../../components/HistoryRecordSelectModal';
import DiagnosisPreview from '../../components/DiagnosisPreview';
import { listRecordBillings, getPrescriptionBilling } from '../../api/billing';
import type { BillingRecord, BillingDetail } from '../../api/billing';
import { useAuth } from '../../store/auth';
import useIsMobile from '../../hooks/useIsMobile';
import { listPulses } from '../../api/pulse';
import type { PulseItem } from '../../api/pulse';
import { uploadFile, fetchFileBlob } from '../../api/upload';

interface PatientOption {
  id: number;
  name: string;
  gender: number;
  age: number;
  phone: string;
  birthday?: string;
}

interface RecordFormValues {
  patient_id: number;
  visit_date: Dayjs;
  chief_complaint: string;
  pulse_id?: number;
  pulse_name?: string;
  tongue_image?: string;
  tongue_description?: string;
  tongue_analysis?: string;
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
  const { hasPermission, user } = useAuth();
  const isMobile = useIsMobile();

  const [form] = Form.useForm<RecordFormValues>();
  const [patientForm] = Form.useForm<NewPatientFormValues>();

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [returnSaving, setReturnSaving] = useState(false);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [patientLoading, setPatientLoading] = useState(false);
  const [patientModalOpen, setPatientModalOpen] = useState(false);
  const [patientCreating, setPatientCreating] = useState(false);

  // Prescription state
  const [prescriptions, setPrescriptions] = useState<PrescriptionData[]>([]);
  const [prescriptionModalOpen, setPrescriptionModalOpen] = useState(false);
  const [editingPrescription, setEditingPrescription] = useState<PrescriptionData | null>(null);

  // Billing state
  const [billingDrawerOpen, setBillingDrawerOpen] = useState(false);
  const [billingPrintOnly, setBillingPrintOnly] = useState(false);
  const [billingPrescriptionId, setBillingPrescriptionId] = useState<number>(0);
  const [billingMap, setBillingMap] = useState<Record<number, BillingRecord>>({});
  // Shelf number maps: prescriptionId → { herbName → shelfNo }
  const [shelfMaps, setShelfMaps] = useState<Record<number, Record<string, string>>>({});

  // Follow-up panel: read highlight ID from URL
  const followUpIdParam = searchParams.get('followup_id');
  const highlightFollowUpId = followUpIdParam ? Number(followUpIdParam) : undefined;

  // Print center (mobile combined print+billing)
  const [printCenterOpen, setPrintCenterOpen] = useState(false);
  const [printCenterPrescription, setPrintCenterPrescription] = useState<PrescriptionData | null>(null);

  // Record data for prescription print
  const [recordPatient, setRecordPatient] = useState<PatientOption | null>(null);

  // Return-to-patient navigation state
  const fromPatient = searchParams.get('from') === 'patient';
  const [lastSavedPrescriptionId, setLastSavedPrescriptionId] = useState<number | null>(null);

  // Build edit URL preserving from=patient params
  const buildEditUrl = (recordId: number) => {
    const patientId = searchParams.get('patient_id');
    if (fromPatient && patientId) {
      return `/records/${recordId}?from=patient&patient_id=${patientId}`;
    }
    return `/records/${recordId}`;
  };

  // Debounce timer ref for patient search
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounce timer ref for pulse search

  // AI analysis state
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<string>('');
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [aiCached, setAiCached] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);
  const tongueAbortRef = useRef<AbortController | null>(null);

  // Pulse search state
  const [pulseOptions, setPulseOptions] = useState<PulseItem[]>([]);
  const [pulseLoading, setPulseLoading] = useState(false);
  const [selectedPulse, setSelectedPulse] = useState<PulseItem | null>(null);
  const [pulseAiQuerying, setPulseAiQuerying] = useState(false);
  const [pulseSearchText, setPulseSearchText] = useState('');
  const [pulseSearched, setPulseSearched] = useState(false);

  // Tongue analysis state
  const [tongueAnalyzing, setTongueAnalyzing] = useState(false);
  const [tongueResult, setTongueResult] = useState<string>('');
  const [tongueDrawerOpen, setTongueDrawerOpen] = useState(false);  const [tongueImageUrl, setTongueImageUrl] = useState<string>('');
  const [tongueUploading, setTongueUploading] = useState(false);
  const [tongueDeleting, setTongueDeleting] = useState(false);

  // Card 4 collapsible state (notes & attachments)
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [attachmentsExpanded, setAttachmentsExpanded] = useState(false);

  // History records selection modal
  const [historyModalOpen, setHistoryModalOpen] = useState(false);

  // Watch form fields for template sync
  const watchedPatientId = Form.useWatch('patient_id', form);
  const watchedChiefComplaint = Form.useWatch('chief_complaint', form);
  const watchedPulseName = Form.useWatch('pulse_name', form);
  const watchedTongueDescription = Form.useWatch('tongue_description', form);
  const watchedNotes = Form.useWatch('notes', form);
  const watchedAttachments = Form.useWatch('attachments', form);

  // Cleanup timers and SSE streams on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      aiAbortRef.current?.abort();
      tongueAbortRef.current?.abort();
    };
  }, []);

  const autoSaveIfTouched = async () => {
    if (!isEdit || !form.isFieldsTouched()) return;
    try {
      const values = form.getFieldsValue();
      await updateRecord(Number(id), {
        chief_complaint: values.chief_complaint || '',
        pulse_id: values.pulse_id || null,
        pulse_name: values.pulse_name || '',
        tongue_image: values.tongue_image || '',
        tongue_description: values.tongue_description || '',
        tongue_analysis: values.tongue_analysis || '',
        diagnosis: values.diagnosis || '',
        treatment: values.treatment || '',
        notes: values.notes || '',
        visit_date: values.visit_date ? values.visit_date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        attachments: values.attachments || [],
      });
      message.success('诊疗记录已自动保存');
    } catch {
      // Non-blocking
    }
  };

  // Warn on browser close/refresh when form has unsaved changes
  useEffect(() => {
    if (!isEdit) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (form.isFieldsTouched()) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isEdit]);

  // Auto-expand notes/attachments when they have content
  useEffect(() => {
    if (watchedNotes) setNotesExpanded(true);
  }, [watchedNotes]);
  useEffect(() => {
    if (watchedAttachments?.length) setAttachmentsExpanded(true);
  }, [watchedAttachments]);

  // Sync patient info + chief complaint + pulse to diagnosis template
  useEffect(() => {
    const diagnosis = form.getFieldValue('diagnosis') as string;
    if (!diagnosis || !diagnosis.includes('主诉：')) return;

    const patient = patients.find(p => p.id === watchedPatientId);
    const genderText = patient ? (patient.gender === 1 ? '男' : patient.gender === 2 ? '女' : '') : '';
    const ageText = patient?.age ? `${patient.age}岁` : '';
    const birthdayText = patient?.birthday ? dayjs(patient.birthday).format('YYYY年MM月') : '';

    let updated = diagnosis;
    updated = updated.replace(/^性别：.*$/m, `性别：${genderText}`);
    updated = updated.replace(/^年龄：.*$/m, `年龄：${ageText}`);
    updated = updated.replace(/^出生年月：.*$/m, `出生年月：${birthdayText}`);
    updated = updated.replace(/^主诉：.*$/m, `主诉：${watchedChiefComplaint || ''}`);
    updated = updated.replace(/^脉象：.*$/m, `脉象：${watchedPulseName || ''}`);
    updated = updated.replace(/^舌象：.*$/m, `舌象：${watchedTongueDescription || ''}`);

    if (updated !== diagnosis) {
      form.setFieldValue('diagnosis', updated);
    }
  }, [form, patients, watchedPatientId, watchedChiefComplaint, watchedPulseName, watchedTongueDescription]);

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

  // Load shelf maps for prescriptions with items (separate from loadPrescriptions to avoid N+1 on every edit)
  const loadShelfMaps = useCallback(async (list: PrescriptionData[]) => {
    const withItems = list.filter((p) => p.items?.length > 0);
    if (withItems.length === 0) { setShelfMaps({}); return; }
    const maps: Record<number, Record<string, string>> = {};
    await Promise.all(withItems.map(async (p) => {
      try {
        const bRes = await getPrescriptionBilling(p.id);
        const bBody = bRes as unknown as { data: BillingDetail };
        const m: Record<string, string> = {};
        for (const item of bBody.data?.items ?? []) {
          if (item.shelf_no) m[item.herb_name] = item.shelf_no;
        }
        if (Object.keys(m).length > 0) maps[p.id] = m;
      } catch { /* skip */ }
    }));
    setShelfMaps(maps);
  }, []);

  // Scroll to and highlight the newly saved prescription
  useEffect(() => {
    if (!lastSavedPrescriptionId || prescriptions.length === 0) return;
    if (!prescriptions.some((p) => p.id === lastSavedPrescriptionId)) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const el = document.querySelector(`[data-prescription-id="${lastSavedPrescriptionId}"]`);
    if (el) {
      timers.push(setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100));
    }
    timers.push(setTimeout(() => {
      setLastSavedPrescriptionId(null);
    }, 5000));
    return () => timers.forEach(clearTimeout);
  }, [lastSavedPrescriptionId, prescriptions]);

  // Highlight prescription from URL query param (e.g. ?highlight=123), once only
  const highlightAppliedRef = useRef(false);
  useEffect(() => {
    if (highlightAppliedRef.current) return;
    const highlightId = searchParams.get('highlight');
    if (highlightId && prescriptions.length > 0) {
      highlightAppliedRef.current = true;
      setLastSavedPrescriptionId(Number(highlightId));
    }
  }, [searchParams, prescriptions]);

  // Load shelf maps once when prescriptions first load
  const shelfMapsLoadedRef = useRef(false);
  useEffect(() => {
    if (prescriptions.length > 0 && !shelfMapsLoadedRef.current) {
      shelfMapsLoadedRef.current = true;
      loadShelfMaps(prescriptions);
    }
  }, [prescriptions, loadShelfMaps]);

  const loadBillings = useCallback(async () => {
    if (!id) return;
    try {
      const res = await listRecordBillings(Number(id));
      const body = res as unknown as { data: BillingRecord[] };
      const list = (body.data || []) as BillingRecord[];
      const map: Record<number, BillingRecord> = {};
      for (const b of list) {
        map[b.prescription_id] = b;
      }
      setBillingMap(map);
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
            chief_complaint: string;
            pulse_id: number;
            pulse_name: string;
            tongue_image: string;
            tongue_description: string;
            tongue_analysis: string;
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
          chief_complaint: record.chief_complaint || '',
          pulse_id: record.pulse_id || undefined,
          pulse_name: record.pulse_name || '',
          tongue_image: record.tongue_image || '',
          tongue_description: record.tongue_description || '',
          tongue_analysis: record.tongue_analysis || '',
          diagnosis: record.diagnosis || '',
          treatment: record.treatment || '',
          notes: record.notes || '',
          attachments: record.attachments || [],
        });

        // Load associated pulse details
        if (record.pulse_name) {
          try {
            const pulseRes = await listPulses({ name: record.pulse_name, page: 1, size: 10 });
            const pulseBody = pulseRes as unknown as { data: { list: PulseItem[] } };
            const pList = pulseBody.data.list || [];
            setPulseOptions(pList);
            const found = pList.find((p: PulseItem) => p.id === record.pulse_id);
            if (found) {
              setSelectedPulse(found);
            } else {
              // Free-text pulse name not in DB — show as directly saved
              setSelectedPulse({ id: 0, name: record.pulse_name, category: '', description: '', clinical_meaning: '', common_conditions: '', created_at: '' });
              setPulseSearchText(record.pulse_name);
            }
          } catch { /* ignore */ }
        }
        if (record.tongue_image) {
          fetchFileBlob(record.tongue_image).then(url => setTongueImageUrl(url)).catch(() => {});
        }
        if (record.tongue_analysis) {
          setTongueResult(record.tongue_analysis);
        }
      } catch {
        message.error('加载诊疗记录失败');
        navigate('/records');
      } finally {
        setLoading(false);
      }
    };

    loadRecord();
    loadPrescriptions();
    loadBillings();

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
  }, [id, form, navigate, loadPrescriptions, loadBillings]);

  const handlePatientSearch = (value: string) => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = setTimeout(() => {
      searchPatients(value || undefined);
    }, 300);
  };

  // Pulse search
  const dedupPulses = (list: PulseItem[]) => {
    const seen = new Set<string>();
    return list.filter(p => {
      if (!p.name?.trim()) return false;
      const key = p.name.trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const searchPulses = useCallback(async (name: string) => {
    if (!name.trim()) {
      setPulseOptions([]);
      setPulseSearched(false);
      return;
    }
    setPulseLoading(true);
    setPulseSearched(false);
    try {
      const res = await listPulses({ name, page: 1, size: 10 });
      const body = res as unknown as { data: { list: PulseItem[]; total: number } };
      setPulseOptions(dedupPulses(body.data.list || []));
    } catch {
      // handled
    } finally {
      setPulseLoading(false);
      setPulseSearched(true);
    }
  }, []);

  const handlePulseAiQuery = async () => {
    if (!pulseSearchText.trim()) return;
    setPulseAiQuerying(true);
    try {
      const res = await listPulses({ name: pulseSearchText, page: 1, size: 10, ai: true });
      const body = res as unknown as { data: { list: PulseItem[]; total: number } };
      const list = dedupPulses(body.data.list || []);
      setPulseOptions(list);
      if (list.length > 0) {
        const pulse = list[0];
        setSelectedPulse(pulse);
        form.setFieldsValue({ pulse_id: pulse.id, pulse_name: pulse.name });
        message.success(`已从 AI 获取脉象「${pulse.name}」并自动入库`);
      } else {
        message.warning('AI 未能识别该脉象');
      }
    } catch {
      message.error('AI 查询失败');
    } finally {
      setPulseAiQuerying(false);
    }
  };

  // Tongue upload & analysis
  const handleTongueUpload = async (file: File) => {
    setTongueUploading(true);
    try {
      const res = await uploadFile(file);
      const body = res as unknown as { data: { file_path: string } };
      const filePath = body.data.file_path;
      form.setFieldValue('tongue_image', filePath);
      fetchFileBlob(filePath).then(url => setTongueImageUrl(url)).catch(() => {});
      // 编辑模式下立即同步到后端，防止孤立文件
      if (isEdit) {
        try {
          await updateRecord(Number(id), { tongue_image: filePath });
          message.success('舌象图片上传成功');
        } catch {
          message.error('同步舌象图片失败，请手动保存');
        }
      } else {
        message.success('舌象图片上传成功');
      }
    } catch {
      message.error('上传失败');
    } finally {
      setTongueUploading(false);
    }
  };

  const handleTongueAnalysis = async (force = false) => {
    const description = form.getFieldValue('tongue_description');
    if (!description?.trim()) {
      message.warning('请先输入舌象描述');
      return;
    }

    let recordId = id ? Number(id) : undefined;

    // Auto-save form data before starting analysis
    const patientId = form.getFieldValue('patient_id');
    const visitDate = form.getFieldValue('visit_date');
    if (!patientId || !visitDate) {
      message.warning('请先选择患者和就诊日期，以便自动保存记录');
      return;
    }
    try {
      const savePayload = {
        patient_id: patientId,
        visit_date: visitDate.format('YYYY-MM-DD'),
        chief_complaint: form.getFieldValue('chief_complaint') || '',
        pulse_id: form.getFieldValue('pulse_id') || null,
        pulse_name: form.getFieldValue('pulse_name') || '',
        tongue_image: form.getFieldValue('tongue_image') || '',
        tongue_description: description.trim(),
        tongue_analysis: form.getFieldValue('tongue_analysis') || '',
        diagnosis: form.getFieldValue('diagnosis') || '',
        treatment: form.getFieldValue('treatment') || '',
        notes: form.getFieldValue('notes') || '',
        attachments: form.getFieldValue('attachments') || [],
      };
      if (recordId) {
        // Existing record: update
        await updateRecord(recordId, {
          chief_complaint: savePayload.chief_complaint,
          pulse_id: savePayload.pulse_id,
          pulse_name: savePayload.pulse_name,
          tongue_image: savePayload.tongue_image,
          tongue_description: savePayload.tongue_description,
          tongue_analysis: savePayload.tongue_analysis,
          diagnosis: savePayload.diagnosis,
          treatment: savePayload.treatment,
          notes: savePayload.notes,
          visit_date: savePayload.visit_date,
          attachments: savePayload.attachments,
        });
      } else {
        // New record: create to get ID
        const res = await createRecord(savePayload);
        const body = res as unknown as { data: { id: number } };
        if (body.data?.id) {
          recordId = body.data.id;
          navigate(buildEditUrl(recordId), { replace: true });
        }
      }
      message.success('诊疗记录已自动保存');
    } catch {
      message.error('自动保存失败，请先手动保存记录');
      return;
    }

    tongueAbortRef.current?.abort();
    setTongueAnalyzing(true);
    setTongueDrawerOpen(true);
    setTongueResult('');

    let accumulated = '';

    const controller = streamTongueAnalysis(description.trim(), recordId, force, {
      onChunk: (text) => {
        accumulated += text;
        setTongueResult(accumulated);
      },
      onDone: () => {
        setTongueAnalyzing(false);
        form.setFieldValue('tongue_analysis', accumulated);
      },
      onCached: (evt) => {
        const e = evt as Record<string, unknown>;
        const analysis = (e.analysis as string) || '未获取到分析结果';
        setTongueResult(analysis);
        form.setFieldValue('tongue_analysis', analysis);
        setTongueAnalyzing(false);
      },
      onError: (error) => {
        setTongueResult(error || '舌象分析失败，请稍后重试');
        setTongueAnalyzing(false);
      },
    });

    tongueAbortRef.current = controller;
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
        chief_complaint: values.chief_complaint || '',
        pulse_id: values.pulse_id || null,
        pulse_name: values.pulse_name || '',
        tongue_image: values.tongue_image || '',
        tongue_description: values.tongue_description || '',
        tongue_analysis: values.tongue_analysis || '',
        diagnosis: values.diagnosis || '',
        treatment: values.treatment || '',
        notes: values.notes || '',
        attachments: values.attachments || [],
      };

      if (isEdit) {
        await updateRecord(Number(id), {
          chief_complaint: payload.chief_complaint,
          pulse_id: payload.pulse_id,
          pulse_name: payload.pulse_name,
          tongue_image: payload.tongue_image,
          tongue_description: payload.tongue_description,
          tongue_analysis: payload.tongue_analysis,
          diagnosis: payload.diagnosis,
          treatment: payload.treatment,
          notes: payload.notes,
          visit_date: payload.visit_date,
          attachments: payload.attachments,
        });
        message.success('诊疗记录更新成功');
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
          navigate(buildEditUrl(body.data.id));
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
      loadBillings();
    } catch {
      message.error('删除处方失败');
    }
  };

  // --- Streaming AI analysis (current implementation) ---
  const handleAiAnalysis = async (force = false) => {
    const diagnosis = form.getFieldValue('diagnosis');
    if (!diagnosis?.trim()) {
      message.warning('请先输入诊断内容');
      return;
    }

    let recordId = id ? Number(id) : undefined;

    // For new records, auto-save first to get a record_id so backend can persist the analysis
    if (!recordId) {
      const patientId = form.getFieldValue('patient_id');
      const visitDate = form.getFieldValue('visit_date');
      if (!patientId || !visitDate) {
        message.warning('请先选择患者和就诊日期，以便自动保存记录');
        return;
      }
      try {
        const payload = {
          patient_id: patientId,
          visit_date: visitDate.format('YYYY-MM-DD'),
          chief_complaint: form.getFieldValue('chief_complaint') || '',
          pulse_id: form.getFieldValue('pulse_id') || null,
          pulse_name: form.getFieldValue('pulse_name') || '',
          tongue_image: form.getFieldValue('tongue_image') || '',
          tongue_description: form.getFieldValue('tongue_description') || '',
          tongue_analysis: form.getFieldValue('tongue_analysis') || '',
          diagnosis: diagnosis.trim(),
          treatment: form.getFieldValue('treatment') || '',
          notes: form.getFieldValue('notes') || '',
          attachments: form.getFieldValue('attachments') || [],
        };
        const res = await createRecord(payload);
        const body = res as unknown as { data: { id: number } };
        if (body.data?.id) {
          recordId = body.data.id;
          message.success('诊疗记录已自动保存');
          navigate(`/records/${recordId}`, { replace: true });
        }
      } catch {
        message.error('自动保存失败，请先手动保存记录');
        return;
      }
    }

    // Cancel any previous stream
    aiAbortRef.current?.abort();

    setAiAnalyzing(true);
    setAiDrawerOpen(true);
    setAiResult('');
    setAiCached(false);

    let accumulated = '';

    const controller = streamAiAnalysis(diagnosis.trim(), recordId, force, {
      onChunk: (text) => {
        accumulated += text;
        setAiResult(accumulated);
      },
      onDone: () => {
        setAiAnalyzing(false);
      },
      onCached: (evt) => {
        const e = evt as Record<string, unknown>;
        setAiResult((e.analysis as string) || '未获取到分析结果');
        setAiCached(true);
        setAiAnalyzing(false);
      },
      onError: (error) => {
        setAiResult(error || 'AI 分析请求失败，请稍后重试');
        setAiAnalyzing(false);
      },
    });

    aiAbortRef.current = controller;
  };

  // --- Non-streaming AI analysis (legacy, switch back if needed) ---
  // const handleAiAnalysisLegacy = async (force = false) => {
  //   const diagnosis = form.getFieldValue('diagnosis');
  //   if (!diagnosis?.trim()) {
  //     message.warning('请先输入诊断内容');
  //     return;
  //   }
  //   setAiAnalyzing(true);
  //   setAiDrawerOpen(true);
  //   setAiResult('');
  //   setAiCached(false);
  //   try {
  //     const recordId = id ? Number(id) : undefined;
  //     const res = await aiAnalyzeDiagnosis(diagnosis.trim(), recordId, force);
  //     const body = res as unknown as { data: { analysis: string; cached: boolean } };
  //     setAiResult(body.data.analysis || '未获取到分析结果');
  //     setAiCached(body.data.cached);
  //   } catch {
  //     setAiResult('AI 分析请求失败，请稍后重试');
  //   } finally {
  //     setAiAnalyzing(false);
  //   }
  // };

  const handleOpenPrescriptionModal = (prescription?: PrescriptionData) => {
    setEditingPrescription(prescription || null);
    setPrescriptionModalOpen(true);
  };

  // 快速创建仅诊疗费空处方并打开收费
  const handleQuickConsultationFee = async () => {
    if (!id) return;
    await autoSaveIfTouched();
    try {
      const res = await createPrescription({ record_id: Number(id), items: [] });
      const body = res as unknown as { code: number; data: { id: number } };
      await loadPrescriptions();
      setBillingPrescriptionId(body.data.id);
      setBillingDrawerOpen(true);
    } catch {
      message.error('创建失败');
    }
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

  // Compute patient info for return bar
  const returnPatientId = recordPatient?.id || Number(searchParams.get('patient_id')) || null;
  const returnPatientName = recordPatient?.name || patients.find(p => p.id === returnPatientId)?.name || '';

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100%' }}>
      {/* Return-to-patient navigation bar – sticky on scroll */}
      {returnPatientId && (isEdit || fromPatient) && (
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 100,
            background: 'linear-gradient(90deg, #e6f4ff 0%, #f0f5ff 100%)',
            border: '1px solid #69b1ff',
            borderRadius: 8,
            padding: isMobile ? '8px 12px' : '10px 16px',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            boxShadow: '0 2px 8px rgba(22, 119, 255, 0.18)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <div style={{
              width: isMobile ? 24 : 28,
              height: isMobile ? 24 : 28,
              borderRadius: '50%',
              background: '#1677ff',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: isMobile ? 11 : 12,
              fontWeight: 700,
              flexShrink: 0,
            }}>
              {returnPatientName?.charAt(0) || '?'}
            </div>
            <span style={{ fontSize: isMobile ? 12 : 13, color: '#1677ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              患者 <span style={{ fontWeight: 600, color: '#1a1a2e' }}>{returnPatientName}</span>
            </span>
          </div>
          <Button
            type={lastSavedPrescriptionId ? 'primary' : 'default'}
            icon={<LeftOutlined />}
            size={isMobile ? 'small' : 'middle'}
            loading={returnSaving}
            className={lastSavedPrescriptionId ? 'return-btn-pulse' : ''}
            style={lastSavedPrescriptionId ? undefined : { borderColor: '#1677ff', color: '#1677ff', fontWeight: 500 }}
            onClick={async () => {
              try {
                const values = await form.validateFields();
                setReturnSaving(true);
                const payload = {
                  chief_complaint: values.chief_complaint || '',
                  pulse_id: values.pulse_id || null,
                  pulse_name: values.pulse_name || '',
                  tongue_image: values.tongue_image || '',
                  tongue_description: values.tongue_description || '',
                  tongue_analysis: values.tongue_analysis || '',
                  diagnosis: values.diagnosis || '',
                  treatment: values.treatment || '',
                  notes: values.notes || '',
                  visit_date: values.visit_date.format('YYYY-MM-DD'),
                  attachments: values.attachments || [],
                };
                let navRecordId = id ? Number(id) : undefined;
                if (isEdit) {
                  await updateRecord(Number(id), payload);
                } else {
                  const res = await createRecord({ ...payload, patient_id: values.patient_id });
                  const body = res as unknown as { data: { id: number } };
                  navRecordId = body.data?.id;
                  if (navRecordId && aiResult) {
                    try { await saveAiAnalysis(navRecordId, values.diagnosis || '', aiResult); } catch { /* ignore */ }
                  }
                }
                message.success('诊疗记录已保存');
                navigate(`/patients/${returnPatientId}`, {
                  state: {
                    highlightRecordId: navRecordId,
                    highlightPrescriptionId: lastSavedPrescriptionId || undefined,
                  },
                });
              } catch {
                // Validation failed or save error – stay on page
              } finally {
                setReturnSaving(false);
              }
            }}
          >
            {isMobile ? '返回' : '返回患者详情'}
          </Button>
        </div>
      )}
      <div style={{
        background: '#fff',
        borderRadius: 8,
        padding: '16px 24px',
        marginBottom: 12,
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        fontSize: 18,
        fontWeight: 600,
      }}>
        {isEdit ? '编辑诊疗记录' : '新增诊疗记录'}
      </div>
      <Form<RecordFormValues>
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{
          attachments: [],
          visit_date: isEdit ? undefined : dayjs(),
          diagnosis: isEdit ? undefined : `性别：
年龄：
出生年月：
主诉：
脉象：
舌象：
---
1. 大便：
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
        {/* Card 1: 基本信息 */}
        <div className="section-card">
          <div className="section-card-title">
            <div className="section-card-icon" style={{ background: '#1677ff' }}>i</div>
            基本信息
          </div>
          <div className="form-row" style={isMobile ? undefined : { flexDirection: 'row' }}>
            <Form.Item
              label="患者"
              name="patient_id"
              rules={[{ required: true, message: '请选择患者' }]}
              style={{ flex: 1, marginBottom: 0 }}
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
                    <div style={{ padding: '8px 12px', borderTop: '1px solid #f0f0f0' }}>
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
              style={{ width: isMobile ? '100%' : 200, marginBottom: 0 }}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <div style={{ marginTop: 16 }}>
            <Form.Item label="主诉" name="chief_complaint" style={{ marginBottom: 0 }}>
              <Input.TextArea rows={2} placeholder="请输入主诉（主要症状和持续时间）" />
            </Form.Item>
          </div>
        </div>

        {/* Card 2: 四诊采集 */}
        <div className="section-card">
          <div className="section-card-title">
            <div className="section-card-icon" style={{ background: '#52c41a' }}>四</div>
            四诊采集
          </div>

        <Form.Item label="脉象" style={{ marginBottom: selectedPulse ? 8 : 16 }}>
          {selectedPulse ? (
            /* 状态3: 已选中 — 显示选中标签 */
            <Tag
              closable
              onClose={() => {
                const prevName = selectedPulse?.name || '';
                setSelectedPulse(null);
                setPulseSearchText(prevName);
                setPulseOptions([]);
                setPulseSearched(false);
                form.setFieldsValue({ pulse_id: undefined, pulse_name: '' });
              }}
              color="blue"
              style={{ fontSize: 14, padding: '4px 10px', lineHeight: '22px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {selectedPulse.name}
              {selectedPulse.category && ` (${selectedPulse.category})`}
            </Tag>
          ) : pulseOptions.length > 0 ? (
            /* 状态2: 有搜索结果 — 只显示结果标签，隐藏输入框 */
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {pulseOptions.map(p => (
                  <Tag
                    key={p.id}
                    color="processing"
                    style={{ cursor: 'pointer', fontSize: 13, padding: '2px 10px', maxWidth: isMobile ? 'calc(100% - 80px)' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    onClick={() => {
                      setSelectedPulse(p);
                      setPulseSearchText(p.name);
                      form.setFieldsValue({ pulse_id: p.id, pulse_name: p.name });
                      setPulseOptions([]);
                    }}
                  >
                    {p.name}{p.category ? ` (${p.category})` : ''}
                  </Tag>
                ))}
                <Button
                  type="default"
                  size="small"
                  icon={<SearchOutlined />}
                  onClick={() => { setPulseOptions([]); setPulseSearchText(''); setPulseSearched(false); }}
                  style={{ fontSize: 14, marginLeft: 8, borderStyle: 'dashed', color: '#fa8c16', borderColor: '#fa8c16' }}
                >
                  重新搜索
                </Button>
              </div>
            </div>
          ) : (
            /* 状态1: 初始/无结果 — 显示搜索输入框 */
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
                <Input
                  value={pulseSearchText}
                  onChange={(e) => setPulseSearchText(e.target.value)}
                  onPressEnter={() => pulseSearchText.trim() && searchPulses(pulseSearchText)}
                  placeholder={isMobile ? '输入脉象名称' : '输入脉象名称，可查询或直接保存'}
                  allowClear
                  style={{ flex: 1, minWidth: 0 }}
                />
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <Button
                    icon={<SearchOutlined />}
                    loading={pulseLoading}
                    onClick={() => searchPulses(pulseSearchText)}
                    disabled={!pulseSearchText.trim()}
                  >
                    查询
                  </Button>
                  <Button
                    icon={<CheckOutlined />}
                    type="primary"
                    ghost
                    onClick={() => {
                      const text = pulseSearchText.trim();
                      if (!text) return;
                      setSelectedPulse({ id: 0, name: text, category: '', description: '', clinical_meaning: '', common_conditions: '', created_at: '' });
                      form.setFieldsValue({ pulse_id: undefined, pulse_name: text });
                      setPulseOptions([]);
                      setPulseSearched(false);
                    }}
                    disabled={!pulseSearchText.trim()}
                  >
                    保存
                  </Button>
                </div>
              </div>
              {pulseSearched && pulseOptions.length === 0 && pulseSearchText && !pulseLoading && (
                <div style={{ textAlign: 'center', padding: '8px 0' }}>
                  <div style={{ color: '#999', fontSize: isMobile ? 12 : 14, marginBottom: 4 }}>未找到匹配，可直接保存或从 AI 查询</div>
                  <Button
                    type="link"
                    icon={<RobotOutlined />}
                    loading={pulseAiQuerying}
                    onClick={handlePulseAiQuery}
                  >
                    从 AI 查询
                  </Button>
                </div>
              )}
            </>
          )}
        </Form.Item>
        <Form.Item name="pulse_id" hidden><Input /></Form.Item>
        <Form.Item name="pulse_name" hidden>
          <Input />
        </Form.Item>
        {selectedPulse && (selectedPulse.description || selectedPulse.clinical_meaning || selectedPulse.common_conditions) && (
          <div style={{
            marginTop: -8,
            marginBottom: 16,
            padding: isMobile ? '8px 12px' : '12px 16px',
            background: '#f6f8fa',
            borderRadius: 8,
            border: '1px solid #e8e8e8',
            fontSize: isMobile ? 12 : 13,
            lineHeight: 1.8,
            color: '#555',
            wordBreak: 'break-word',
          }}>
            {selectedPulse.description && <div><span style={{ color: '#888' }}>特征：</span>{selectedPulse.description}</div>}
            {selectedPulse.clinical_meaning && <div><span style={{ color: '#888' }}>临床意义：</span>{selectedPulse.clinical_meaning}</div>}
            {selectedPulse.common_conditions && <div><span style={{ color: '#888' }}>常见病症：</span>{selectedPulse.common_conditions}</div>}
          </div>
        )}

        {/* 舌象 */}
        <Form.Item label="舌象图片" name="tongue_image" style={{ marginBottom: 12 }}>
          <div>
            {tongueImageUrl ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img src={tongueImageUrl} alt="舌象" style={{ maxWidth: 200, maxHeight: 150, borderRadius: 8, border: '1px solid #d9d9d9' }} />
                <Button
                  size="small"
                  danger
                  loading={tongueDeleting}
                  style={{ position: 'absolute', top: 4, right: 4 }}
                  onClick={async () => {
                    form.setFieldValue('tongue_image', '');
                    setTongueImageUrl('');
                    setTongueResult('');
                    setTongueDrawerOpen(false);
                    // 编辑模式下立即同步到后端，清除关联防止孤立数据
                    if (isEdit) {
                      setTongueDeleting(true);
                      try {
                        await updateRecord(Number(id), { tongue_image: '' });
                      } catch {
                        message.error('同步删除舌象图片失败，请手动保存');
                      } finally {
                        setTongueDeleting(false);
                      }
                    }
                  }}
                >
                  删除
                </Button>
              </div>
            ) : (
              <Button
                loading={tongueUploading}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/*';
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) handleTongueUpload(file);
                  };
                  input.click();
                }}
              >
                上传舌象图片
              </Button>
            )}
          </div>
        </Form.Item>
        <Form.Item label={
          <Space>
            <span>舌象描述</span>
            <Button
              type="primary"
              ghost
              size="small"
              icon={<RobotOutlined />}
              loading={tongueAnalyzing}
              onClick={() => {
              if (tongueResult) {
                setTongueDrawerOpen(true);
              } else {
                handleTongueAnalysis();
              }
            }}
            >
              分析舌象
            </Button>
            {tongueResult && !tongueAnalyzing && !tongueDrawerOpen && (
              <Tooltip title="已有分析结果，点击查看">
                <Tag
                  color="green"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setTongueDrawerOpen(true)}
                >
                  已有分析
                </Tag>
              </Tooltip>
            )}
          </Space>
        } name="tongue_description">
          <Input.TextArea rows={3} placeholder="描述舌象（如：舌质淡红，舌苔薄白，舌体胖大有齿痕）" />
        </Form.Item>
        <Form.Item name="tongue_analysis" hidden>
          <Input />
        </Form.Item>

        </div>

        {/* Card 3: 诊断治疗 */}
        <div className="section-card">
          <div className="section-card-title">
            <div className="section-card-icon" style={{ background: '#fa8c16' }}>诊</div>
            诊断治疗
          </div>

          <Form.Item
            label={
              <Space wrap>
                <span>诊断</span>
                <Button
                  type="primary"
                  ghost
                  size="small"
                  icon={<RobotOutlined />}
                  loading={aiAnalyzing}
                  onClick={() => {
                    if (aiResult) {
                      setAiDrawerOpen(true);
                    } else {
                      handleAiAnalysis();
                    }
                  }}
                >
                  AI辅助分析
                </Button>
                <Button
                  size="small"
                  icon={<HistoryOutlined />}
                  disabled={!watchedPatientId}
                  onClick={() => setHistoryModalOpen(true)}
                  style={{ borderColor: '#fa8c16', color: '#fa8c16' }}
                >
                  引用历史诊疗
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
          >
            <Input.TextArea rows={isMobile ? 12 : 20} placeholder="请输入诊断内容" />
          </Form.Item>
          <DiagnosisPreview diagnosis={form.getFieldValue('diagnosis') || ''} />

          <Form.Item label="治疗方案" name="treatment" style={{ marginBottom: 0 }}>
            <Input.TextArea rows={isMobile ? 4 : 6} placeholder="请输入治疗方案" />
          </Form.Item>
        </div>

        {/* Card 4: 备注附件 */}
        <div className="section-card">
          <div className="section-card-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
            <div className="section-card-icon" style={{ background: '#8c8c8c' }}>附</div>
            备注附件
          </div>

          {/* 备注 - 可折叠 */}
          <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 12, paddingTop: 12 }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', marginBottom: notesExpanded ? 12 : 0 }}
              onClick={() => setNotesExpanded(!notesExpanded)}
            >
              {notesExpanded ? <DownOutlined style={{ fontSize: 11, color: '#8c8c8c' }} /> : <RightOutlined style={{ fontSize: 11, color: '#8c8c8c' }} />}
              <span style={{ fontSize: 14, fontWeight: 500 }}>备注</span>
              {!notesExpanded && watchedNotes && (
                <span style={{ fontSize: 12, color: '#666', marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: isMobile ? 200 : 400, display: 'inline-block', verticalAlign: 'middle' }}>
                  {watchedNotes}
                </span>
              )}
            </div>
            <div style={{ display: notesExpanded ? 'block' : 'none' }}>
              <Form.Item name="notes" style={{ marginBottom: 0 }}>
                <Input.TextArea rows={4} placeholder="请输入备注" style={{ resize: 'none' }} />
              </Form.Item>
            </div>
          </div>

          {/* 附件 - 可折叠 */}
          <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 12, paddingTop: 12 }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', marginBottom: attachmentsExpanded ? 12 : 0 }}
              onClick={() => setAttachmentsExpanded(!attachmentsExpanded)}
            >
              {attachmentsExpanded ? <DownOutlined style={{ fontSize: 11, color: '#8c8c8c' }} /> : <RightOutlined style={{ fontSize: 11, color: '#8c8c8c' }} />}
              <span style={{ fontSize: 14, fontWeight: 500 }}>附件上传</span>
              {!attachmentsExpanded && watchedAttachments?.length > 0 && (
                <span style={{ fontSize: 12, color: '#1677ff', marginLeft: 4 }}>
                  {watchedAttachments.length} 个文件
                </span>
              )}
            </div>
            <div style={{ display: attachmentsExpanded ? 'block' : 'none' }}>
              <Form.Item name="attachments" style={{ marginBottom: 0 }}>
                <FileUpload onSync={isEdit ? async (updatedAttachments) => {
                  try {
                    await updateRecord(Number(id), { attachments: updatedAttachments });
                  } catch {
                    message.error('同步附件失败，请手动保存');
                  }
                } : undefined} />
              </Form.Item>
            </div>
          </div>
        </div>

        {/* 按钮 */}
        <Form.Item style={{ marginTop: 8 }}>
          <div className={isMobile ? 'record-form-actions' : undefined}>
            <Space>
              <Button type="primary" htmlType="submit" loading={submitting} disabled={tongueUploading || tongueDeleting}>
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
                        chief_complaint: values.chief_complaint || '',
                        pulse_id: values.pulse_id || null,
                        pulse_name: values.pulse_name || '',
                        tongue_image: values.tongue_image || '',
                        tongue_description: values.tongue_description || '',
                        tongue_analysis: values.tongue_analysis || '',
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
                        navigate(buildEditUrl(body.data.id));
                      }
                    } catch {
                      // validation error
                    } finally {
                      setSubmitting(false);
                    }
                  } else {
                    await autoSaveIfTouched();
                    handleOpenPrescriptionModal();
                  }
                }}
                loading={submitting}
              >
                开方
              </Button>
            )}
            {!isMobile && <Button onClick={() => navigate('/records')}>取消</Button>}
            </Space>
          </div>
        </Form.Item>
      </Form>

      {/* 处方区域 - 编辑模式下显示处方列表 */}
      {isEdit && hasPermission('prescription:read') && (
        <>
          <Divider />
          <div style={{
            background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f5 100%)',
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
              <Space>
                <Button
                  icon={<DollarOutlined />}
                  size={isMobile ? 'small' : 'middle'}
                  onClick={handleQuickConsultationFee}
                  style={{
                    background: '#fffbe6',
                    color: '#d48806',
                    borderColor: '#ffe58f',
                    fontWeight: 500,
                  }}
                >
                  {isMobile ? '诊疗费' : '仅收诊疗费'}
                </Button>
                {hasPermission('prescription:create') && (
                  <Button
                    type="primary"
                    size={isMobile ? 'small' : 'middle'}
                    icon={<PlusOutlined />}
                    onClick={async () => { await autoSaveIfTouched(); handleOpenPrescriptionModal(); }}
                  >
                    开方
                  </Button>
                )}
              </Space>
            </div>

            {prescriptions.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {prescriptions.map((item) => {
                  const isEmpty = (item.items || []).length === 0;
                  const isHighlighted = item.id === lastSavedPrescriptionId;
                  return (
                  <div key={item.id} data-prescription-id={item.id} style={{ position: 'relative' }}>
                    {isHighlighted && (
                      <span className="prescription-saved-badge">&#10003; 已保存</span>
                    )}
                  <Card
                    size="small"
                    className={isHighlighted ? 'prescription-saved-highlight' : undefined}
                    style={isEmpty
                      ? { borderRadius: 8, borderColor: '#ffe58f', background: '#fffbe6' }
                      : { borderRadius: 8, background: 'linear-gradient(135deg, #ffffff 0%, #f8fbff 100%)', borderColor: '#d6e4ff' }
                    }
                    title={
                      <Space size={8}>
                        {isEmpty
                          ? <DollarOutlined style={{ color: '#faad14' }} />
                          : <MedicineBoxOutlined style={{ color: '#1677ff' }} />
                        }
                        <span style={{ fontWeight: 500 }}>{isEmpty ? '仅诊疗费' : (item.formula_name || '自定义处方')}</span>
                        {!isEmpty && <Tag color="blue" style={{ marginLeft: 4 }}>{item.total_doses} 付</Tag>}
                        {item.created_at && <span style={{ fontSize: 12, color: '#999', marginLeft: 8 }}>{dayjs(item.created_at).format('YYYY-MM-DD HH:mm')}</span>}
                      </Space>
                    }
                  >
                    {isEmpty ? (
                      <>
                        <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#888', flexWrap: 'wrap' }}>
                          {billingMap[item.id] ? (() => {
                            const b = billingMap[item.id];
                            return (
                              <>
                                <span>诊疗费 <span style={{ color: '#333' }}>¥{(b.consultation_fee ?? 0).toFixed(2)}</span></span>
                                <span>实收 <span style={{ color: '#389e0d', fontWeight: 600 }}>¥{(b.actual_paid ?? 0).toFixed(2)}</span></span>
                              </>
                            );
                          })() : (
                            <span style={{ color: '#999' }}>仅收取诊疗费（无药品）</span>
                          )}
                        </div>
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                          <Button
                            size="small"
                            icon={<PrinterOutlined />}
                            onClick={() => {
                              setBillingPrescriptionId(item.id);
                              setBillingPrintOnly(true);
                              setBillingDrawerOpen(true);
                            }}
                            style={{ background: '#fff7e6', color: '#d48806', borderColor: '#ffd591', fontWeight: 500 }}
                          >
                            {isMobile ? '打印' : '打印收费'}
                          </Button>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <Button
                              type="link"
                              size="small"
                              icon={<DollarOutlined />}
                              onClick={async () => {
                                await autoSaveIfTouched();
                                setBillingPrescriptionId(item.id);
                                setBillingPrintOnly(false);
                                setBillingDrawerOpen(true);
                              }}
                              style={{ color: '#faad14', padding: 0 }}
                            >
                              收费
                            </Button>
                            {hasPermission('prescription:create') && (
                              <>
                                <span style={{ color: '#e0e0e0' }}>|</span>
                                <Button type="link" size="small" icon={<EditOutlined />} onClick={async () => { await autoSaveIfTouched(); handleOpenPrescriptionModal(item); }} style={{ padding: 0 }}>编辑</Button>
                                <Button
                                  type="link"
                                  size="small"
                                  icon={<DeleteOutlined />}
                                  danger
                                  style={{ padding: 0 }}
                                  onClick={async () => {
                                    await autoSaveIfTouched();
                                    Modal.confirm({
                                      title: '确定删除此处方？',
                                      content: '删除后不可恢复',
                                      okText: '删除',
                                      okButtonProps: { danger: true },
                                      cancelText: '取消',
                                      onOk: () => handleDeletePrescription(item.id),
                                    });
                                  }}
                                >
                                  删除
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </>
                    ) : (
                    <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', lineHeight: '26px' }}>
                      {(item.items || []).filter((h) => !h.category || h.category === 'herb').map((herb) => (
                        <span key={herb.id} style={{ whiteSpace: 'nowrap' }}>
                          <span>{herb.herb_name}</span>
                          <span style={{ color: '#1677ff', marginLeft: 4 }}>{herb.dosage}g</span>
                          {herb.notes && <span style={{ color: '#999', marginLeft: 2 }}>({herb.notes})</span>}
                        </span>
                      ))}
                    </div>
                    {(item.items || []).some((h) => h.category === 'patent') && (
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed #e8e8e8' }}>
                        <span style={{ fontSize: 12, color: '#888', marginRight: 8 }}>中成药：</span>
                        {(item.items || []).filter((h) => h.category === 'patent').map((patent) => (
                          <span key={patent.id} style={{ whiteSpace: 'nowrap', marginRight: 12 }}>
                            <span style={{ color: '#722ed1' }}>[成药]</span>
                            <span style={{ marginLeft: 2 }}>{patent.herb_name}</span>
                            <span style={{ color: '#1677ff', marginLeft: 4 }}>{patent.dosage}盒</span>
                            {patent.notes && <span style={{ color: '#999', marginLeft: 2 }}>({patent.notes})</span>}
                          </span>
                        ))}
                      </div>
                    )}
                    </>
                    )}
                    {!isEmpty && item.notes && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #f0f0f0', color: '#666', fontSize: 13 }}>
                        <div style={{ marginBottom: 2 }}>医嘱：</div>
                        {item.notes.split('\n').map((line, idx) => (
                          <div key={idx}>{line}</div>
                        ))}
                      </div>
                    )}
                    {!isEmpty && item.creator?.real_name && (
                      <div style={{ marginTop: 6, fontSize: 12, color: '#999', textAlign: 'right' }}>
                        开方医师：{item.creator.real_name}
                      </div>
                    )}
                    {!isEmpty && billingMap[item.id] && (() => {
                      const b = billingMap[item.id];
                      return (
                        <div style={{
                          marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e8e8e8',
                          display: 'flex', gap: 16, fontSize: 12, color: '#888', flexWrap: 'wrap', alignItems: 'center',
                        }}>
                          <span>诊疗费 <span style={{ color: '#333' }}>¥{(b.consultation_fee ?? 0).toFixed(2)}</span></span>
                          {b.drug_cost_total > 0 && <span>药费 <span style={{ color: '#333' }}>¥{(b.drug_cost_total ?? 0).toFixed(2)}</span></span>}
                          <span>应收 <span style={{ color: '#cf1322', fontWeight: 600 }}>¥{(b.total_amount ?? 0).toFixed(2)}</span></span>
                          <span>实收 <span style={{ color: '#389e0d', fontWeight: 600 }}>¥{(b.actual_paid ?? 0).toFixed(2)}</span></span>
                          {b.stock_deducted && <Tag color="green" style={{ fontSize: 11 }}>已扣库存</Tag>}
                        </div>
                      );
                    })()}
                    {/* 操作栏 — 仅非空处方 */}
                    {!isEmpty && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {isMobile ? (
                          /* 移动端：合并入口 */
                          <Button
                            size="small"
                            type="primary"
                            icon={<PrinterOutlined />}
                            onClick={() => {
                              setPrintCenterPrescription(item);
                              setPrintCenterOpen(true);
                            }}
                            style={{
                              background: 'linear-gradient(135deg, #1677ff 0%, #0958d9 100%)',
                              fontWeight: 500,
                            }}
                          >
                            打印
                          </Button>
                        ) : (
                          /* 桌面端：保持分开的按钮 */
                          <>
                            <Button
                              size="small"
                              icon={<PrinterOutlined />}
                              onClick={() => {
                                setBillingPrescriptionId(item.id);
                                setBillingPrintOnly(true);
                                setBillingDrawerOpen(true);
                              }}
                              style={{ background: '#fff7e6', color: '#d48806', borderColor: '#ffd591', fontWeight: 500 }}
                            >
                              打印收费
                            </Button>
                            <PrescriptionPrint
                              prescription={item}
                              patientName={recordPatient?.name}
                              patientAge={recordPatient?.age}
                              chiefComplaint={form.getFieldValue('chief_complaint')}
                              treatment={form.getFieldValue('treatment')}
                              shelfMap={shelfMaps[item.id]}
                              clinicName={user?.tenant_name}
                              iconOnly
                            />
                          </>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <Button
                          type="link"
                          size="small"
                          icon={<DollarOutlined />}
                          onClick={async () => {
                            await autoSaveIfTouched();
                            setBillingPrescriptionId(item.id);
                            setBillingPrintOnly(false);
                            setBillingDrawerOpen(true);
                          }}
                          style={{ color: '#faad14', padding: 0 }}
                        >
                          收费
                        </Button>
                        {hasPermission('prescription:create') && (
                          <>
                            <span style={{ color: '#e0e0e0' }}>|</span>
                            <Button type="link" size="small" icon={<EditOutlined />} onClick={async () => { await autoSaveIfTouched(); handleOpenPrescriptionModal(item); }} style={{ padding: 0 }}>编辑</Button>
                            <Button
                              type="link"
                              size="small"
                              icon={<DeleteOutlined />}
                              danger
                              style={{ padding: 0 }}
                              onClick={async () => {
                                await autoSaveIfTouched();
                                Modal.confirm({
                                  title: '确定删除此处方？',
                                  content: '删除后不可恢复',
                                  okText: '删除',
                                  okButtonProps: { danger: true },
                                  cancelText: '取消',
                                  onOk: () => handleDeletePrescription(item.id),
                                });
                              }}
                            >
                              删除
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    )}
                  </Card>
                  </div>
                  );
                })}
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
                <div style={{ marginTop: 16 }}>
                  <Button
                    type="primary"
                    icon={<DollarOutlined />}
                    onClick={handleQuickConsultationFee}
                    style={{
                      background: 'linear-gradient(135deg, #faad14 0%, #d48806 100%)',
                      borderColor: '#d48806',
                      fontWeight: 600,
                      boxShadow: '0 2px 6px rgba(250, 173, 20, 0.4)',
                    }}
                  >
                    仅收诊疗费
                  </Button>
                </div>
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
          onSuccess={(rxId: number) => {
            setLastSavedPrescriptionId(rxId);
            loadPrescriptions();
          }}
        />
      )}

      {/* 收费抽屉 */}
      <BillingDrawer
        open={billingDrawerOpen}
        prescriptionId={billingPrescriptionId || undefined}
        recordId={Number(id)}
        patientName={recordPatient?.name}
        patientAge={recordPatient?.age}
        doctorName={user?.real_name || user?.username}
        printOnly={billingPrintOnly}
        onSuccess={(rxId) => {
          if (rxId > 0) setLastSavedPrescriptionId(rxId);
          loadShelfMaps(prescriptions);
        }}
        onClose={() => {
          setBillingDrawerOpen(false);
          setBillingPrintOnly(false);
          setBillingPrescriptionId(0);
          loadBillings();
        }}
      />

      {/* 移动端打印中心 */}
      {printCenterPrescription && (
        <PrintCenterDrawer
          open={printCenterOpen}
          prescription={printCenterPrescription}
          prescriptionId={printCenterPrescription.id}
          recordId={Number(id)}
          patientName={recordPatient?.name}
          patientAge={recordPatient?.age}
          chiefComplaint={form.getFieldValue('chief_complaint')}
          treatment={form.getFieldValue('treatment')}
          doctorName={user?.real_name || user?.username}
          clinicName={user?.tenant_name}
          onClose={() => {
            setPrintCenterOpen(false);
            setPrintCenterPrescription(null);
            loadBillings();
          }}
        />
      )}

      {/* 回访折叠面板 */}
      {isEdit && hasPermission('followup:read') && recordPatient && (
        <FollowUpPanel
          recordId={Number(id)}
          patientId={recordPatient.id}
          patientName={recordPatient.name}
          patientPhone={recordPatient.phone}
          highlightFollowUpId={highlightFollowUpId}
        />
      )}

      {/* 历史诊疗记录选择弹窗 */}
      <HistoryRecordSelectModal
        open={historyModalOpen}
        patientId={watchedPatientId}
        patientName={patients.find((p) => p.id === watchedPatientId)?.name}
        currentDiagnosis={form.getFieldValue('diagnosis') || ''}
        currentTreatment={form.getFieldValue('treatment') || ''}
        currentDate={form.getFieldValue('visit_date')?.format('YYYY-MM-DD') || ''}
        onClose={() => setHistoryModalOpen(false)}
        onConfirm={(assembled) => {
          form.setFieldValue('diagnosis', assembled);
          message.success('已引用历史诊疗记录');
        }}
      />

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

      {/* 舌象AI分析抽屉 */}
      <Drawer
        title={
          <Space>
            <RobotOutlined style={{ color: '#1677ff' }} />
            <span>舌象 AI 分析</span>
          </Space>
        }
        placement="right"
        width={isMobile ? '100%' : 720}
        open={tongueDrawerOpen}
        onClose={() => {
          tongueAbortRef.current?.abort();
          setTongueAnalyzing(false);
          setTongueDrawerOpen(false);
        }}
        styles={{ body: { padding: 0 } }}
        extra={
          tongueResult && !tongueAnalyzing ? (
            <Tooltip title="忽略缓存，重新调用 AI 分析">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => handleTongueAnalysis(true)}
              >
                重新分析
              </Button>
            </Tooltip>
          ) : undefined
        }
      >
        {tongueAnalyzing && !tongueResult && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 24 }}>
            <Spin size="large" />
            <div style={{ color: '#666', fontSize: 15 }}>AI 正在分析舌象...</div>
          </div>
        )}
        {tongueResult && (
          <div style={{ padding: '24px 32px' }}>
            <div style={{
              background: 'linear-gradient(135deg, #e8f4fd 0%, #f0e6ff 100%)',
              borderRadius: 12,
              padding: '16px 20px',
              marginBottom: 24,
              border: '1px solid #d4e8f7',
            }}>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>分析依据 — 舌象描述</div>
              <div style={{ fontSize: 14, color: '#333', fontWeight: 500 }}>
                {form.getFieldValue('tongue_description') || '—'}
              </div>
            </div>
            <div className="ai-analysis-content" style={{ fontSize: 14, lineHeight: 1.8, color: '#333' }}>
              <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                {tongueResult}
              </Markdown>
              {tongueAnalyzing && <Spin size="small" style={{ marginLeft: 8, marginTop: 8 }} />}
            </div>
            {!tongueAnalyzing && (
              <>
                <Divider />
                <div style={{ fontSize: 12, color: '#999', textAlign: 'center', padding: '8px 0' }}>
                  以上分析由 AI 生成，仅供参考
                </div>
              </>
            )}
          </div>
        )}
      </Drawer>

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
        width={isMobile ? '100%' : 720}
        open={aiDrawerOpen}
        onClose={() => {
          aiAbortRef.current?.abort();
          setAiAnalyzing(false);
          setAiDrawerOpen(false);
        }}
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
        {/* Loading state: only show full spinner when no content yet */}
        {aiAnalyzing && !aiResult && (
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
              分析内容将实时显示
            </div>
          </div>
        )}

        {/* Content area: shown when there's any result (streaming or complete) */}
        {aiResult && (
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
                rehypePlugins={[rehypeRaw]}
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
              {aiAnalyzing && <Spin size="small" style={{ marginLeft: 8, marginTop: 8 }} />}
            </div>
            {!aiAnalyzing && (
              <>
                <Divider />
                <div style={{
                  fontSize: 12,
                  color: '#999',
                  textAlign: 'center',
                  padding: '8px 0',
                }}>
                  以上分析由 AI 生成，仅供参考，请结合临床经验综合判断
                </div>
              </>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
