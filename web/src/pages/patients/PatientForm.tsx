import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Form,
  Input,
  InputNumber,
  Radio,
  Button,
  Card,
  Space,
  Modal,
  DatePicker,
  message,
} from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { createPatient, updatePatient } from '../../api/patient';

interface PatientFormValues {
  name: string;
  gender: number;
  age: number;
  birthday?: Dayjs | null;
  weight?: number;
  phone?: string;
  id_card?: string;
  address?: string;
  native_place?: string;
  notes?: string;
}

interface PatientFormModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: Omit<PatientFormValues, 'birthday'> & { id: number; birthday?: string };
}

/**
 * PatientForm can be used in two modes:
 * 1. As a standalone page (for /patients/new route)
 * 2. As a Modal (when editing from list or detail page)
 *
 * For Modal mode, pass: visible, onClose, onSuccess, initialData
 */

/* ---- Internal form content (shared between page and modal) ---- */
function PatientFormFields({ form }: { form: ReturnType<typeof Form.useForm<PatientFormValues>>[0] }) {
  return (
    <Form<PatientFormValues>
      form={form}
      layout="vertical"
      style={{ maxWidth: 520 }}
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

      <Form.Item label="出生日期" name="birthday">
        <DatePicker
          style={{ width: '100%' }}
          placeholder="选择出生日期（可选）"
          onChange={(date: Dayjs | null) => {
            if (date) {
              const age = dayjs().diff(date, 'year');
              form.setFieldsValue({ age });
            }
          }}
        />
      </Form.Item>

      <Form.Item
        label="年龄"
        name="age"
        rules={[{ required: true, message: '请输入年龄' }]}
      >
        <InputNumber min={0} max={200} style={{ width: '100%' }} placeholder="请输入年龄" />
      </Form.Item>

      <Form.Item label="体重" name="weight">
        <InputNumber
          min={0}
          max={500}
          step={0.1}
          style={{ width: '100%' }}
          placeholder="请输入体重"
          addonAfter="kg"
        />
      </Form.Item>

      <Form.Item label="联系电话" name="phone">
        <Input placeholder="请输入联系电话" />
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
  );
}

/* ---- Modal mode ---- */
export function PatientFormModal({
  visible,
  onClose,
  onSuccess,
  initialData,
}: PatientFormModalProps) {
  const [form] = Form.useForm<PatientFormValues>();
  const [submitting, setSubmitting] = useState(false);

  const isEdit = Boolean(initialData?.id);

  useEffect(() => {
    if (visible && initialData) {
      form.setFieldsValue({
        name: initialData.name,
        gender: initialData.gender,
        age: initialData.age,
        birthday: initialData.birthday ? dayjs(initialData.birthday) : null,
        weight: initialData.weight,
        phone: initialData.phone,
        id_card: initialData.id_card,
        address: initialData.address,
        native_place: initialData.native_place,
        notes: initialData.notes,
      });
    } else if (visible) {
      form.resetFields();
    }
  }, [visible, initialData, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      const submitData = {
        ...values,
        birthday: values.birthday ? dayjs(values.birthday).format('YYYY-MM-DD') : undefined,
      };

      if (isEdit && initialData) {
        await updatePatient(initialData.id, submitData);
        message.success('患者信息更新成功');
      } else {
        await createPatient(submitData);
        message.success('患者创建成功');
      }

      onSuccess();
      onClose();
    } catch {
      // Validation or API error
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={isEdit ? '编辑患者' : '新增患者'}
      open={visible}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={submitting}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <PatientFormFields form={form} />
    </Modal>
  );
}

/* ---- Standalone page mode (default export for /patients/new route) ---- */
export default function PatientForm() {
  const navigate = useNavigate();
  const [form] = Form.useForm<PatientFormValues>();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      const submitData = {
        ...values,
        birthday: values.birthday ? dayjs(values.birthday).format('YYYY-MM-DD') : undefined,
      };

      await createPatient(submitData);
      message.success('患者创建成功');
      navigate('/patients');
    } catch {
      // Validation or API error
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card title="新增患者">
      <PatientFormFields form={form} />
      <Form.Item style={{ maxWidth: 520 }}>
        <Space>
          <Button type="primary" loading={submitting} onClick={handleSubmit}>
            保存
          </Button>
          <Button onClick={() => navigate('/patients')}>取消</Button>
        </Space>
      </Form.Item>
    </Card>
  );
}
