import { useState } from 'react';
import { Input, Table, Tag, message, Button, Popconfirm, Modal, Space } from 'antd';
import { SearchOutlined, RobotOutlined, DeleteOutlined, EditOutlined, PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { listFormulas, deleteFormula, updateFormulaComposition } from '../../api/formula';
import type { FormulaItem, FormulaCompositionItem } from '../../api/formula';
import { useAuth } from '../../store/auth';

export default function FormulaSearch() {
  const [formulas, setFormulas] = useState<FormulaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [searchName, setSearchName] = useState('');
  const { hasPermission } = useAuth();

  // Composition edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editFormulaId, setEditFormulaId] = useState<number | null>(null);
  const [editFormulaName, setEditFormulaName] = useState('');
  const [editComposition, setEditComposition] = useState<FormulaCompositionItem[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchFormulas = async (name: string, p: number, s: number) => {
    setLoading(true);
    try {
      const res = await listFormulas({ name, page: p, size: s });
      const body = res as unknown as {
        data: { list: FormulaItem[]; total: number };
      };
      setFormulas(body.data.list || []);
      setTotal(body.data.total || 0);
    } catch {
      message.error('查询方剂失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearchName(value);
    setPage(1);
    fetchFormulas(value, 1, size);
  };

  const handleTableChange = (pagination: { current?: number; pageSize?: number }) => {
    const newPage = pagination.current || 1;
    const newSize = pagination.pageSize || 20;
    setPage(newPage);
    setSize(newSize);
    fetchFormulas(searchName, newPage, newSize);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteFormula(id);
      message.success('删除成功');
      fetchFormulas(searchName, page, size);
    } catch {
      // Error handled by interceptor
    }
  };

  const openEditModal = (record: FormulaItem) => {
    setEditFormulaId(record.id);
    setEditFormulaName(record.name);
    setEditComposition(
      (record.composition || []).map((c) => ({ ...c }))
    );
    setEditModalOpen(true);
  };

  const addRow = () => {
    setEditComposition([...editComposition, { herb_name: '', default_dosage: '' }]);
  };

  const removeRow = (index: number) => {
    setEditComposition(editComposition.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: keyof FormulaCompositionItem, value: string) => {
    const updated = editComposition.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    );
    setEditComposition(updated);
  };

  const handleSaveComposition = async () => {
    if (editFormulaId === null) return;

    // Validate: filter out empty rows, require at least herb_name
    const valid = editComposition.filter((c) => c.herb_name.trim() !== '');
    if (valid.length === 0) {
      message.warning('请至少添加一味药物');
      return;
    }

    setSaving(true);
    try {
      await updateFormulaComposition(editFormulaId, valid);
      message.success('组成更新成功');
      setEditModalOpen(false);
      fetchFormulas(searchName, page, size);
    } catch {
      // Error handled by interceptor
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<FormulaItem> = [
    {
      title: '方剂名',
      dataIndex: 'name',
      key: 'name',
      width: 150,
    },
    {
      title: '功效',
      dataIndex: 'effects',
      key: 'effects',
      ellipsis: true,
    },
    {
      title: '主治',
      dataIndex: 'indications',
      key: 'indications',
      ellipsis: true,
    },
    {
      title: '组成',
      key: 'composition',
      width: 300,
      render: (_: unknown, record: FormulaItem) => {
        const comp = record.composition || [];
        if (comp.length === 0) return '无';
        return comp.map((c: FormulaCompositionItem) => `${c.herb_name} ${c.default_dosage}`).join('、');
      },
      ellipsis: true,
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 100,
      render: (source: string) =>
        source === 'deepseek' ? (
          <Tag icon={<RobotOutlined />} color="blue">
            AI
          </Tag>
        ) : (
          <Tag color="green">本地</Tag>
        ),
    },
    ...(hasPermission('role:manage')
      ? [
          {
            title: '操作',
            key: 'action',
            width: 80,
            render: (_: unknown, record: FormulaItem) => (
              <Popconfirm
                title="确定删除此方剂？"
                onConfirm={() => handleDelete(record.id)}
                okText="删除"
                cancelText="取消"
              >
                <Button type="text" danger size="small" icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            ),
          },
        ]
      : []),
  ];

  const editColumns: ColumnsType<FormulaCompositionItem & { key: number }> = [
    {
      title: '药物',
      dataIndex: 'herb_name',
      key: 'herb_name',
      render: (_: unknown, _record: FormulaCompositionItem & { key: number }, index: number) => (
        <Input
          value={editComposition[index]?.herb_name}
          onChange={(e) => updateRow(index, 'herb_name', e.target.value)}
          placeholder="药名"
        />
      ),
    },
    {
      title: '用量',
      dataIndex: 'default_dosage',
      key: 'default_dosage',
      width: 150,
      render: (_: unknown, _record: FormulaCompositionItem & { key: number }, index: number) => (
        <Input
          value={editComposition[index]?.default_dosage}
          onChange={(e) => updateRow(index, 'default_dosage', e.target.value)}
          placeholder="如 10g"
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 60,
      render: (_: unknown, _record: FormulaCompositionItem & { key: number }, index: number) => (
        <Button
          type="text"
          danger
          icon={<MinusCircleOutlined />}
          onClick={() => removeRow(index)}
        />
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="输入方剂名称搜索（支持AI查询）"
          allowClear
          enterButton={<><SearchOutlined /> 搜索</>}
          size="large"
          onSearch={handleSearch}
          style={{ maxWidth: 500 }}
        />
      </div>

      <Table<FormulaItem>
        columns={columns}
        dataSource={formulas}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          pageSize: size,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
        }}
        onChange={handleTableChange}
        expandable={{
          expandedRowRender: (record) => {
            const comp = record.composition || [];
            return (
              <div style={{ padding: '8px 0' }}>
                <p><strong>功效：</strong>{record.effects || '无'}</p>
                <p><strong>主治：</strong>{record.indications || '无'}</p>
                <p><strong>组成：</strong></p>
                {comp.length > 0 ? (
                  <Table
                    dataSource={comp.map((c: FormulaCompositionItem, idx: number) => ({ ...c, key: idx }))}
                    columns={[
                      { title: '药物', dataIndex: 'herb_name', key: 'herb_name' },
                      { title: '用量', dataIndex: 'default_dosage', key: 'default_dosage' },
                    ]}
                    pagination={false}
                    size="small"
                    bordered
                  />
                ) : (
                  <span>无组成信息</span>
                )}
                <Space style={{ marginTop: 8 }}>
                  {record.source === 'deepseek' && (
                    <Tag icon={<RobotOutlined />} color="blue">
                      数据来源：DeepSeek AI（仅供参考，请结合临床经验）
                    </Tag>
                  )}
                  {hasPermission('role:manage') && (
                    <Button
                      type="primary"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => openEditModal(record)}
                    >
                      编辑组成
                    </Button>
                  )}
                </Space>
              </div>
            );
          },
        }}
      />

      <Modal
        title={`编辑组成 - ${editFormulaName}`}
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={handleSaveComposition}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={600}
        destroyOnClose
      >
        <Table
          dataSource={editComposition.map((c, idx) => ({ ...c, key: idx }))}
          columns={editColumns}
          pagination={false}
          size="small"
          bordered
        />
        <Button
          type="dashed"
          onClick={addRow}
          icon={<PlusOutlined />}
          style={{ width: '100%', marginTop: 8 }}
        >
          添加药物
        </Button>
      </Modal>
    </div>
  );
}
