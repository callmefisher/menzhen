import { useState, useEffect } from 'react';
import {
  Drawer,
  Form,
  Input,
  DatePicker,
  Select,
  Button,
  message,
  Descriptions,
} from 'antd';
import { ScheduleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { createFollowUp } from '../api/followUp';
import useIsMobile from '../hooks/useIsMobile';

interface FollowUpDrawerProps {
  open: boolean;
  recordId: number;
  patientId: number;
  patientName: string;
  visitDate: string; // YYYY-MM-DD
  diagnosis?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const METHOD_OPTIONS = [
  { label: '电话', value: '电话' },
  { label: '微信', value: '微信' },
  { label: '到诊', value: '到诊' },
  { label: '其他', value: '其他' },
];

export default function FollowUpDrawer({
  open,
  recordId,
  patientId,
  patientName,
  visitDate,
  diagnosis,
  onClose,
  onSuccess,
}: FollowUpDrawerProps) {
  const isMobile = useIsMobile();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        planned_date: dayjs().add(15, 'day'),
        method: '电话',
        content: '',
      });
    }
  }, [open, visitDate, form]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await createFollowUp({
        patient_id: patientId,
        record_id: recordId,
        planned_date: values.planned_date.format('YYYY-MM-DD'),
        method: values.method,
        content: values.content || '',
      });
      message.success('回访计划已创建');
      form.resetFields();
      onSuccess?.();
      onClose();
    } catch (err) {
      // Form validation errors are handled by antd
      if ((err as { errorFields?: unknown })?.errorFields) return;
      message.error('创建回访失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ScheduleOutlined style={{ color: '#1677ff', fontSize: 18 }} />
          <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 600 }}>创建回访计划</span>
        </div>
      }
      open={open}
      onClose={onClose}
      destroyOnClose
      width={isMobile ? '100%' : 480}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={submitting} onClick={handleSubmit}>
            创建回访
          </Button>
        </div>
      }
    >
      <Descriptions column={1} size="small" style={{ marginBottom: 20 }}>
        <Descriptions.Item label="患者">{patientName}</Descriptions.Item>
        <Descriptions.Item label="就诊日期">{visitDate}</Descriptions.Item>
        {diagnosis && (
          <Descriptions.Item label="诊断">
            <span style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              color: '#666',
            }}>
              {diagnosis}
            </span>
          </Descriptions.Item>
        )}
      </Descriptions>

      <Form form={form} layout="vertical">
        <Form.Item
          label="计划回访日期"
          name="planned_date"
          rules={[{ required: true, message: '请选择回访日期' }]}
        >
          <DatePicker
            style={{ width: '100%' }}
            disabledDate={(current) => current && current.isBefore(dayjs(), 'day')}
          />
        </Form.Item>

        <Form.Item
          label="回访方式"
          name="method"
          rules={[{ required: true, message: '请选择回访方式' }]}
        >
          <Select options={METHOD_OPTIONS} />
        </Form.Item>

        <Form.Item label="回访内容" name="content">
          <Input.TextArea
            rows={4}
            maxLength={500}
            showCount
            placeholder="请输入回访时需要询问/提醒的内容"
          />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
