import { useState, useEffect } from 'react';
import { Input, Table, Tag, message, Button, Popconfirm, Space } from 'antd';
import { SearchOutlined, RobotOutlined, DeleteOutlined, EditOutlined, PlusOutlined, MinusCircleOutlined, InfoCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { listFormulas, deleteFormula, updateFormulaComposition, updateFormulaName } from '../../api/formula';
import type { FormulaItem, FormulaCompositionItem } from '../../api/formula';
import { useAuth } from '../../store/auth';
import HerbDetailModal from '../../components/HerbDetailModal';

export default function FormulaSearch() {
  const [formulas, setFormulas] = useState<FormulaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [searchName, setSearchName] = useState('');
  const { hasPermission } = useAuth();

  // Editable formula name state
  const [editingNameId, setEditingNameId] = useState<number | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');

  // Herb detail modal state
  const [herbDetailOpen, setHerbDetailOpen] = useState(false);
  const [herbDetailName, setHerbDetailName] = useState('');

  // Inline composition edit state
  const [inlineEditId, setInlineEditId] = useState<number | null>(null);
  const [inlineComposition, setInlineComposition] = useState<FormulaCompositionItem[]>([]);
  const [inlineSaving, setInlineSaving] = useState(false);

  // Load all formulas on mount
  useEffect(() => {
    fetchFormulas('', 1, size);
  }, []);

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

  // --- Formula name editing ---
  const handleSaveName = async (id: number) => {
    const trimmed = editingNameValue.trim();
    if (!trimmed) {
      message.warning('方剂名不能为空');
      return;
    }
    try {
      await updateFormulaName(id, trimmed);
      message.success('方剂名更新成功');
      fetchFormulas(searchName, page, size);
    } catch {
      // Error handled by interceptor
    } finally {
      setEditingNameId(null);
    }
  };

  // --- Inline composition editing ---
  const startInlineEdit = (record: FormulaItem) => {
    setInlineEditId(record.id);
    setInlineComposition((record.composition || []).map((c) => ({ ...c })));
  };

  const updateInlineRow = (index: number, field: keyof FormulaCompositionItem, value: string) => {
    setInlineComposition(
      inlineComposition.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  const addInlineRow = () => {
    setInlineComposition([...inlineComposition, { herb_name: '', default_dosage: '' }]);
  };

  const removeInlineRow = (index: number) => {
    setInlineComposition(inlineComposition.filter((_, i) => i !== index));
  };

  const handleSaveInline = async () => {
    if (inlineEditId === null) return;
    const valid = inlineComposition.filter((c) => c.herb_name.trim() !== '');
    if (valid.length === 0) {
      message.warning('请至少添加一味药物');
      return;
    }
    setInlineSaving(true);
    try {
      await updateFormulaComposition(inlineEditId, valid);
      message.success('组成更新成功');
      setInlineEditId(null);
      fetchFormulas(searchName, page, size);
    } catch {
      // Error handled by interceptor
    } finally {
      setInlineSaving(false);
    }
  };

  const openHerbDetail = (herbName: string) => {
    if (!herbName.trim()) return;
    setHerbDetailName(herbName.trim());
    setHerbDetailOpen(true);
  };

  const columns: ColumnsType<FormulaItem> = [
    {
      title: '方剂名',
      dataIndex: 'name',
      key: 'name',
      width: 150,
      render: (name: string, record: FormulaItem) => {
        if (hasPermission('role:manage') && editingNameId === record.id) {
          return (
            <Input
              size="small"
              value={editingNameValue}
              onChange={(e) => setEditingNameValue(e.target.value)}
              onBlur={() => handleSaveName(record.id)}
              onPressEnter={() => handleSaveName(record.id)}
              autoFocus
            />
          );
        }
        return hasPermission('role:manage') ? (
          <a onClick={() => { setEditingNameId(record.id); setEditingNameValue(name); }}>
            {name}
          </a>
        ) : (
          name
        );
      },
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
            const isEditing = hasPermission('role:manage') && inlineEditId === record.id;
            const comp = isEditing ? inlineComposition : (record.composition || []);

            return (
              <div style={{ padding: '8px 0' }}>
                <p><strong>功效：</strong>{record.effects || '无'}</p>
                <p><strong>主治：</strong>{record.indications || '无'}</p>
                <p><strong>组成：</strong></p>
                {comp.length > 0 || isEditing ? (
                  <Table
                    dataSource={comp.map((c: FormulaCompositionItem, idx: number) => ({ ...c, key: idx }))}
                    columns={[
                      {
                        title: '药物',
                        dataIndex: 'herb_name',
                        key: 'herb_name',
                        render: (_: unknown, _rec: FormulaCompositionItem & { key: number }, index: number) => (
                          <Space>
                            {isEditing ? (
                              <Input
                                size="small"
                                value={inlineComposition[index]?.herb_name}
                                onChange={(e) => updateInlineRow(index, 'herb_name', e.target.value)}
                                placeholder="药名"
                              />
                            ) : (
                              <span>{(record.composition || [])[index]?.herb_name}</span>
                            )}
                            <Button
                              type="text"
                              size="small"
                              icon={<InfoCircleOutlined />}
                              onClick={() => openHerbDetail(
                                isEditing
                                  ? (inlineComposition[index]?.herb_name || '')
                                  : ((record.composition || [])[index]?.herb_name || '')
                              )}
                            />
                          </Space>
                        ),
                      },
                      {
                        title: '用量',
                        dataIndex: 'default_dosage',
                        key: 'default_dosage',
                        width: 150,
                        render: isEditing
                          ? (_: unknown, _rec: FormulaCompositionItem & { key: number }, index: number) => (
                              <Input
                                size="small"
                                value={inlineComposition[index]?.default_dosage}
                                onChange={(e) => updateInlineRow(index, 'default_dosage', e.target.value)}
                                placeholder="如 10g"
                              />
                            )
                          : undefined,
                      },
                      ...(isEditing
                        ? [
                            {
                              title: '操作',
                              key: 'action',
                              width: 60,
                              render: (_: unknown, _rec: FormulaCompositionItem & { key: number }, index: number) => (
                                <Button
                                  type="text"
                                  danger
                                  icon={<MinusCircleOutlined />}
                                  onClick={() => removeInlineRow(index)}
                                  size="small"
                                />
                              ),
                            },
                          ]
                        : []),
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
                  {hasPermission('role:manage') && !isEditing && (
                    <Button
                      type="primary"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => startInlineEdit(record)}
                    >
                      编辑组成
                    </Button>
                  )}
                  {isEditing && (
                    <>
                      <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addInlineRow}>
                        添加药物
                      </Button>
                      <Button type="primary" size="small" loading={inlineSaving} onClick={handleSaveInline}>
                        保存
                      </Button>
                      <Button size="small" onClick={() => setInlineEditId(null)}>
                        取消
                      </Button>
                    </>
                  )}
                </Space>
              </div>
            );
          },
        }}
      />

      <HerbDetailModal
        open={herbDetailOpen}
        herbName={herbDetailName}
        onClose={() => setHerbDetailOpen(false)}
      />
    </div>
  );
}
