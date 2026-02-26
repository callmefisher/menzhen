import { useState, useCallback, useRef } from 'react';
import {
  Modal,
  Tabs,
  Form,
  Input,
  InputNumber,
  Button,
  Table,
  Space,
  Select,
  message,
} from 'antd';
import { PlusOutlined, DeleteOutlined, SearchOutlined, InfoCircleOutlined } from '@ant-design/icons';
import HerbDetailModal from './HerbDetailModal';
import { listFormulas } from '../api/formula';
import type { FormulaItem, FormulaCompositionItem } from '../api/formula';
import {
  createPrescription,
  updatePrescription,
} from '../api/prescription';
import type {
  PrescriptionItemReq,
  PrescriptionData,
} from '../api/prescription';

interface PrescriptionModalProps {
  open: boolean;
  recordId: number;
  editData?: PrescriptionData | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface HerbRow {
  key: number;
  herb_name: string;
  dosage: string;
  notes: string;
}

const DEFAULT_PRESCRIPTION_NOTES = '注意事项1.每副药用【不锈钢】的汤锅，放9碗水，共约1800毫升水,中大火煮50分钟左右，一次性煮成两份药，两份药共约400毫升，每份200毫升。2.每天早晚饭前30分钟，分别温服一份，3.要用明火，不能用电煮药,4 如果不小心熬干了,中间加开水，后续适当调节加水量 5.服药期间，忌酒，烟，饮食上减少过于油腻食物';

export default function PrescriptionModal({
  open,
  recordId,
  editData,
  onClose,
  onSuccess,
}: PrescriptionModalProps) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [herbRows, setHerbRows] = useState<HerbRow[]>(
    editData?.items?.map((item, idx) => ({
      key: idx,
      herb_name: item.herb_name,
      dosage: item.dosage ? item.dosage.replace(/[^\d.]/g, '') : '',
      notes: item.notes || '',
    })) || [{ key: 0, herb_name: '', dosage: '', notes: '' }]
  );
  const [nextKey, setNextKey] = useState(
    editData?.items ? editData.items.length : 1
  );
  const [herbDetailOpen, setHerbDetailOpen] = useState(false);
  const [herbDetailName, setHerbDetailName] = useState('');

  // Formula search state
  const [formulaOptions, setFormulaOptions] = useState<FormulaItem[]>([]);
  const [formulaLoading, setFormulaLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchFormulas = useCallback(async (name: string) => {
    if (!name) return;
    setFormulaLoading(true);
    try {
      const res = await listFormulas({ name, page: 1, size: 10 });
      const body = res as unknown as {
        data: { list: FormulaItem[]; total: number };
      };
      setFormulaOptions(body.data.list || []);
    } catch {
      // handled by interceptor
    } finally {
      setFormulaLoading(false);
    }
  }, []);

  const handleFormulaSearch = (value: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      searchFormulas(value);
    }, 300);
  };

  const handleFormulaSelect = (formulaId: number) => {
    const formula = formulaOptions.find((f) => f.id === formulaId);
    if (!formula) return;

    form.setFieldValue('formula_name', formula.name);

    const newRows: HerbRow[] = (formula.composition || []).map(
      (c: FormulaCompositionItem, idx: number) => ({
        key: idx,
        herb_name: c.herb_name,
        dosage: c.default_dosage ? c.default_dosage.replace(/[^\d.]/g, '') : '',
        notes: '',
      })
    );
    setHerbRows(newRows.length > 0 ? newRows : [{ key: 0, herb_name: '', dosage: '', notes: '' }]);
    setNextKey(newRows.length > 0 ? newRows.length : 1);
  };

  const addHerbRow = () => {
    setHerbRows([...herbRows, { key: nextKey, herb_name: '', dosage: '', notes: '' }]);
    setNextKey(nextKey + 1);
  };

  const removeHerbRow = (key: number) => {
    const updated = herbRows.filter((r) => r.key !== key);
    setHerbRows(updated.length > 0 ? updated : [{ key: nextKey, herb_name: '', dosage: '', notes: '' }]);
    if (updated.length === 0) setNextKey(nextKey + 1);
  };

  const updateHerbRow = (key: number, field: keyof HerbRow, value: string) => {
    setHerbRows(
      herbRows.map((r) => (r.key === key ? { ...r, [field]: value } : r))
    );
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const validItems = herbRows.filter((r) => r.herb_name.trim());

      if (validItems.length === 0) {
        message.warning('请至少添加一味药物');
        return;
      }

      setSubmitting(true);

      const items: PrescriptionItemReq[] = validItems.map((r, idx) => ({
        herb_name: r.herb_name.trim(),
        dosage: r.dosage.trim(),
        sort_order: idx,
        notes: r.notes.trim(),
      }));

      if (editData) {
        await updatePrescription(editData.id, {
          formula_name: values.formula_name || '',
          total_doses: values.total_doses || 7,
          notes: values.notes || '',
          items,
        });
        message.success('处方更新成功');
      } else {
        await createPrescription({
          record_id: recordId,
          formula_name: values.formula_name || '',
          total_doses: values.total_doses || 7,
          notes: values.notes || '',
          items,
        });
        message.success('处方创建成功');
      }

      onSuccess();
      onClose();
    } catch {
      // validation error
    } finally {
      setSubmitting(false);
    }
  };

  const herbColumns = [
    {
      title: '药名',
      dataIndex: 'herb_name',
      key: 'herb_name',
      render: (_: string, record: HerbRow) => (
        <Space>
          <Input
            value={record.herb_name}
            onChange={(e) => updateHerbRow(record.key, 'herb_name', e.target.value)}
            placeholder="药名"
          />
          <Button
            type="text"
            size="small"
            icon={<InfoCircleOutlined />}
            onClick={() => {
              if (record.herb_name.trim()) {
                setHerbDetailName(record.herb_name.trim());
                setHerbDetailOpen(true);
              }
            }}
            disabled={!record.herb_name.trim()}
          />
        </Space>
      ),
    },
    {
      title: '用量',
      dataIndex: 'dosage',
      key: 'dosage',
      width: 140,
      render: (_: string, record: HerbRow) => (
        <Space.Compact>
          <InputNumber
            value={record.dosage ? Number(record.dosage) || undefined : undefined}
            onChange={(val) => updateHerbRow(record.key, 'dosage', val != null ? String(val) : '')}
            placeholder="用量"
            min={0}
            max={999}
            style={{ width: 80 }}
          />
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 8px', background: '#fafafa', border: '1px solid #d9d9d9', borderLeft: 'none', borderRadius: '0 6px 6px 0', color: '#666', fontSize: 14 }}>克</span>
        </Space.Compact>
      ),
    },
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      width: 150,
      render: (_: string, record: HerbRow) => (
        <Input
          value={record.notes}
          onChange={(e) => updateHerbRow(record.key, 'notes', e.target.value)}
          placeholder="先煎/后下等"
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 60,
      render: (_: unknown, record: HerbRow) => (
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => removeHerbRow(record.key)}
        />
      ),
    },
  ];

  return (
    <Modal
      title={editData ? '编辑处方' : '开方'}
      open={open}
      onOk={handleSubmit}
      onCancel={onClose}
      confirmLoading={submitting}
      okText="保存"
      cancelText="取消"
      width={700}
      destroyOnClose
    >
      <Tabs
        defaultActiveKey="formula"
        items={[
          {
            key: 'formula',
            label: '按方开药',
            children: (
              <div style={{ marginBottom: 16 }}>
                <Space.Compact style={{ width: '100%' }}>
                  <Select
                    showSearch
                    placeholder="搜索方剂名称"
                    filterOption={false}
                    onSearch={handleFormulaSearch}
                    loading={formulaLoading}
                    style={{ width: '100%' }}
                    onSelect={handleFormulaSelect}
                    options={formulaOptions.map((f) => ({
                      value: f.id,
                      label: `${f.name}${f.effects ? ' — ' + f.effects.substring(0, 30) : ''}`,
                    }))}
                    notFoundContent={formulaLoading ? '搜索中...' : '输入方剂名搜索'}
                    suffixIcon={<SearchOutlined />}
                  />
                </Space.Compact>
                <p style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
                  选择方剂后将自动填充药物列表，您可以调整剂量
                </p>
              </div>
            ),
          },
          {
            key: 'free',
            label: '自由开方',
            children: (
              <p style={{ color: '#888', fontSize: 12 }}>
                在下方药物列表中直接添加药物和剂量
              </p>
            ),
          },
        ]}
      />

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          formula_name: editData?.formula_name || '',
          total_doses: editData?.total_doses || 7,
          notes: editData?.notes ?? DEFAULT_PRESCRIPTION_NOTES,
        }}
      >
        <Form.Item label="方剂名" name="formula_name">
          <Input placeholder="方剂名称（可选）" />
        </Form.Item>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong>药物列表</strong>
            <Button type="dashed" icon={<PlusOutlined />} onClick={addHerbRow} size="small">
              添加药物
            </Button>
          </div>
          <Table
            dataSource={herbRows}
            columns={herbColumns}
            rowKey="key"
            pagination={false}
            size="small"
            bordered
          />
        </div>

        <Form.Item label="总付数" name="total_doses">
          <InputNumber min={1} max={99} style={{ width: 120 }} />
        </Form.Item>

        <Form.Item label="注意事项/医嘱" name="notes">
          <Input.TextArea rows={2} placeholder="如：饭后服用、忌辛辣等" />
        </Form.Item>
      </Form>
      <HerbDetailModal
        open={herbDetailOpen}
        herbName={herbDetailName}
        onClose={() => setHerbDetailOpen(false)}
      />
    </Modal>
  );
}
