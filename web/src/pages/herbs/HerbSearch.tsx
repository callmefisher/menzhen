import { useState, useEffect } from 'react';
import { Input, Table, Tag, message, Button, Popconfirm, Select, Space, Pagination, Spin, Modal, Form } from 'antd';
import { SearchOutlined, RobotOutlined, DeleteOutlined, EditOutlined, SaveOutlined, CloseOutlined, ThunderboltOutlined, ExperimentOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { listHerbs, deleteHerb, listHerbCategories, updateHerb, aiRefreshHerb, findHerbPage, createHerb } from '../../api/herb';
import type { HerbItem } from '../../api/herb';
import { useAuth } from '../../store/auth';
import useIsMobile from '../../hooks/useIsMobile';
import useRowHighlight from '../../hooks/useRowHighlight';

export default function HerbSearch() {
  const [herbs, setHerbs] = useState<HerbItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [searchName, setSearchName] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(undefined);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingData, setEditingData] = useState<Partial<HerbItem>>({});
  const [expandedRowKeys, setExpandedRowKeys] = useState<number[]>([]);
  const [aiRefreshing, setAiRefreshing] = useState(false);
  const { hasPermission } = useAuth();
  const isMobile = useIsMobile();

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createForm] = Form.useForm();
  const [creating, setCreating] = useState(false);

  const highlight = useRowHighlight({
    data: herbs,
    page,
    pageSize: size,
    loading,
    onPageChange: (p) => { setPage(p); fetchHerbs(searchName, selectedCategory, p, size); },
    findPage: findHerbPage,
    idPrefix: 'herb',
  });

  useEffect(() => {
    listHerbCategories()
      .then((res) => {
        const body = res as unknown as { data: string[] };
        setCategories(body.data || []);
      })
      .catch(() => {
        // ignore
      });
    // Load all herbs on mount
    fetchHerbs('', undefined, 1, size);
  }, []);

  const fetchHerbs = async (name: string, category: string | undefined, p: number, s: number) => {
    setLoading(true);
    try {
      const res = await listHerbs({ name, category, page: p, size: s });
      const body = res as unknown as {
        data: { list: HerbItem[]; total: number };
      };
      setHerbs(body.data.list || []);
      setTotal(body.data.total || 0);
    } catch {
      message.error('查询中药失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearchName(value);
    setPage(1);
    fetchHerbs(value, selectedCategory, 1, size);
  };

  const handleCategoryChange = (value: string | undefined) => {
    setSelectedCategory(value);
    setPage(1);
    fetchHerbs(searchName, value, 1, size);
  };

  const handleTableChange = (pagination: { current?: number; pageSize?: number }) => {
    const newPage = pagination.current || 1;
    const newSize = pagination.pageSize || 20;
    highlight.setHighlightId(null);
    setPage(newPage);
    setSize(newSize);
    fetchHerbs(searchName, selectedCategory, newPage, newSize);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteHerb(id);
      message.success('删除成功');
      // Remove from local state to avoid re-fetching which triggers AI fallback
      // (AI would re-create the just-deleted herb if search name matches)
      const newHerbs = herbs.filter(h => h.id !== id);
      setHerbs(newHerbs);
      setTotal(prev => Math.max(0, prev - 1));
      // If current page is empty and not on first page, go to previous page
      if (newHerbs.length === 0 && page > 1) {
        const newPage = page - 1;
        setPage(newPage);
        fetchHerbs(searchName, selectedCategory, newPage, size);
      }
    } catch {
      // Error handled by interceptor
    }
  };

  const startEdit = (record: HerbItem) => {
    setEditingId(record.id);
    setEditingData({
      name: record.name,
      alias: record.alias,
      category: record.category,
      properties: record.properties,
      effects: record.effects,
      indications: record.indications,
      origin: record.origin,
    });
    setExpandedRowKeys((keys) =>
      keys.includes(record.id) ? keys : [...keys, record.id]
    );
  };

  const handleSave = async () => {
    if (!editingId) return;
    try {
      await updateHerb(editingId, editingData);
      message.success('更新成功');
      const savedId = editingId;
      setEditingId(null);
      fetchHerbs(searchName, selectedCategory, page, size);
      highlight.setHighlightId(savedId);
    } catch {
      // Error handled by interceptor
    }
  };

  const handleAiRefresh = async () => {
    if (!editingId) return;
    setAiRefreshing(true);
    try {
      const res = await aiRefreshHerb(editingId);
      const body = res as unknown as { data: HerbItem };
      const herb = body.data;
      setEditingData({
        name: herb.name,
        alias: herb.alias,
        category: herb.category,
        properties: herb.properties,
        effects: herb.effects,
        indications: herb.indications,
        origin: herb.origin,
      });
      message.success('AI查询完成，数据已填充，请确认后保存');
    } catch {
      message.error('AI查询失败');
    } finally {
      setAiRefreshing(false);
    }
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setCreating(true);
      const res = await createHerb(values) as unknown as { data: HerbItem };
      const newId = res.data?.id;
      message.success('新增中药成功');
      setCreateModalVisible(false);
      createForm.resetFields();
      // Clear search to ensure new record is visible, then navigate to last page
      setSearchName('');
      setSelectedCategory(undefined);
      const newTotal = total + 1;
      const lastPage = Math.ceil(newTotal / size) || 1;
      setPage(lastPage);
      await fetchHerbs('', undefined, lastPage, size);
      if (newId) highlight.setHighlightId(newId);
    } catch {
      // Form validation error shows inline; API errors handled by interceptor
    } finally {
      setCreating(false);
    }
  };

  const columns: ColumnsType<HerbItem> = [
    {
      title: '药名',
      dataIndex: 'name',
      key: 'name',
      width: 100,
    },
    {
      title: '性味归经',
      dataIndex: 'properties',
      key: 'properties',
      width: 160,
      ellipsis: true,
      responsive: ['md'] as any,
    },
    {
      title: '功效',
      dataIndex: 'effects',
      key: 'effects',
      width: 180,
      ellipsis: true,
    },
    {
      title: '主治',
      dataIndex: 'indications',
      key: 'indications',
      width: 280,
      ellipsis: true,
      responsive: ['md'] as any,
    },
    {
      title: '道地产区',
      dataIndex: 'origin',
      key: 'origin',
      width: 120,
      ellipsis: true,
      responsive: ['md'] as any,
    },
    ...(hasPermission('role:manage')
      ? [
          {
            title: '操作',
            key: 'action',
            width: 140,
            render: (_: unknown, record: HerbItem) => (
              <Space size="small">
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => startEdit(record)}
                >
                  编辑
                </Button>
                <Popconfirm
                  title="确定删除此中药？"
                  onConfirm={() => handleDelete(record.id)}
                  okText="删除"
                  cancelText="取消"
                >
                  <Button type="text" danger size="small" icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ];

  // --- Empty state ---
  const renderEmpty = () => (
    <div className="warm-empty">
      <div className="warm-empty-icon">
        <ExperimentOutlined style={{ color: '#52C41A' }} />
      </div>
      <div className="warm-empty-text">暂无中药数据</div>
      <div className="warm-empty-sub">输入药名搜索，支持 AI 智能查询</div>
    </div>
  );

  return (
    <div>
      <div className="warm-search-bar" style={{ display: 'flex', gap: 12, flexDirection: isMobile ? 'column' : 'row' }}>
        <Input.Search
          placeholder="输入中药名称搜索（支持AI查询）"
          allowClear
          enterButton={<><SearchOutlined /> 搜索</>}
          size="large"
          onSearch={handleSearch}
          style={{ maxWidth: isMobile ? '100%' : 500 }}
        />
        <Select
          placeholder="按分类筛选"
          allowClear
          size="large"
          style={{ minWidth: isMobile ? '100%' : 160 }}
          value={selectedCategory}
          onChange={handleCategoryChange}
          options={categories.map((c) => ({ label: c, value: c }))}
        />
        {hasPermission('role:manage') && (
          <Button
            type="primary"
            className="warm-btn-primary"
            icon={<PlusOutlined />}
            size="large"
            onClick={() => setCreateModalVisible(true)}
          >
            新增中药
          </Button>
        )}
      </div>

      {isMobile ? (
        loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : herbs.length === 0 ? (
          renderEmpty()
        ) : (
          <>
            {herbs.map((herb) => {
              const isExpanded = expandedRowKeys.includes(herb.id);
              const isEditing = editingId === herb.id;
              return (
                <div key={herb.id} id={`herb-row-${herb.id}`} className={`warm-list-card${highlight.isHighlighted(herb.id) ? ' row-highlight' : ''}`} style={{ cursor: 'default' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 'bold', fontSize: 16, color: '#5C4A32' }}>{herb.name}</span>
                    <Space size="small">
                      {herb.source === 'deepseek' ? (
                        <Tag className="warm-tag-ai" icon={<RobotOutlined />}>AI</Tag>
                      ) : herb.source === 'manual' ? (
                        <Tag className="warm-tag-local">手动</Tag>
                      ) : (
                        <Tag className="warm-tag-local">本地</Tag>
                      )}
                      {hasPermission('role:manage') && (
                        <>
                          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => startEdit(herb)} />
                          <Popconfirm
                            title="确定删除此中药？"
                            onConfirm={() => handleDelete(herb.id)}
                            okText="删除"
                            cancelText="取消"
                          >
                            <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </>
                      )}
                    </Space>
                  </div>
                  <div style={{ fontSize: 13, color: '#8B7355', marginBottom: 6 }}>
                    {herb.category && <Tag style={{ background: '#F6FFED', border: '1px solid #B7EB8F', color: '#389E0D', fontSize: 12 }}>{herb.category}</Tag>}
                    {herb.properties && <span style={{ marginLeft: herb.category ? 4 : 0 }}>{herb.properties}</span>}
                  </div>
                  <div
                    style={{ fontSize: 13, color: '#52C41A', cursor: 'pointer', userSelect: 'none', fontWeight: 500 }}
                    onClick={() =>
                      setExpandedRowKeys((keys) =>
                        keys.includes(herb.id) ? keys.filter((k) => k !== herb.id) : [...keys, herb.id]
                      )
                    }
                  >
                    {isExpanded ? '收起 ▲' : '展开详情 ▼'}
                  </div>
                  {isExpanded && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #EDE8DC', background: 'linear-gradient(180deg, #FAFAF5, transparent)', borderRadius: 8, padding: 10 }}>
                      {isEditing ? (
                        <>
                          <div style={{ marginBottom: 8 }}>
                            <strong>药名：</strong>
                            <Input size="small" value={editingData.name} onChange={(e) => setEditingData((d) => ({ ...d, name: e.target.value }))} style={{ width: '100%' }} />
                          </div>
                          <div style={{ marginBottom: 8 }}>
                            <strong>别名：</strong>
                            <Input size="small" value={editingData.alias} onChange={(e) => setEditingData((d) => ({ ...d, alias: e.target.value }))} style={{ width: '100%' }} />
                          </div>
                          <div style={{ marginBottom: 8 }}>
                            <strong>分类：</strong>
                            <Input size="small" value={editingData.category} onChange={(e) => setEditingData((d) => ({ ...d, category: e.target.value }))} style={{ width: '100%' }} />
                          </div>
                          <div style={{ marginBottom: 8 }}>
                            <strong>性味归经：</strong>
                            <Input size="small" value={editingData.properties} onChange={(e) => setEditingData((d) => ({ ...d, properties: e.target.value }))} style={{ width: '100%' }} />
                          </div>
                          <div style={{ marginBottom: 8 }}>
                            <strong>功效：</strong>
                            <Input.TextArea rows={2} value={editingData.effects} onChange={(e) => setEditingData((d) => ({ ...d, effects: e.target.value }))} style={{ width: '100%' }} />
                          </div>
                          <div style={{ marginBottom: 8 }}>
                            <strong>主治：</strong>
                            <Input.TextArea rows={2} value={editingData.indications} onChange={(e) => setEditingData((d) => ({ ...d, indications: e.target.value }))} style={{ width: '100%' }} />
                          </div>
                          <div style={{ marginBottom: 8 }}>
                            <strong>道地产区：</strong>
                            <Input size="small" value={editingData.origin} onChange={(e) => setEditingData((d) => ({ ...d, origin: e.target.value }))} style={{ width: '100%' }} />
                          </div>
                          <Space>
                            <Button type="primary" size="small" icon={<SaveOutlined />} onClick={handleSave}>保存</Button>
                            <Button size="small" icon={<ThunderboltOutlined />} loading={aiRefreshing} onClick={handleAiRefresh}>AI查询</Button>
                            <Button size="small" icon={<CloseOutlined />} onClick={() => setEditingId(null)}>取消</Button>
                          </Space>
                        </>
                      ) : (
                        <>
                          <p style={{ margin: '4px 0' }}><strong>别名：</strong>{herb.alias || '无'}</p>
                          <p style={{ margin: '4px 0' }}><strong>功效：</strong>{herb.effects || '无'}</p>
                          <p style={{ margin: '4px 0' }}><strong>主治：</strong>{herb.indications || '无'}</p>
                          <p style={{ margin: '4px 0' }}><strong>道地产区：</strong>{herb.origin || '无'}</p>
                          {herb.source === 'deepseek' ? (
                            <Tag className="warm-tag-ai" icon={<RobotOutlined />} style={{ marginTop: 4 }}>
                              数据来源：DeepSeek AI（仅供参考，请结合临床经验）
                            </Tag>
                          ) : herb.source === 'manual' ? (
                            <Tag className="warm-tag-local" style={{ marginTop: 4 }}>数据来源：手动录入</Tag>
                          ) : (
                            <Tag className="warm-tag-local" style={{ marginTop: 4 }}>数据来源：本地数据</Tag>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <Pagination
              current={page}
              pageSize={size}
              total={total}
              onChange={(p, s) => handleTableChange({ current: p, pageSize: s })}
              size="small"
              simple
              style={{ textAlign: 'center', marginTop: 16 }}
            />
          </>
        )
      ) : (
        <Table<HerbItem>
          columns={columns}
          dataSource={herbs}
          rowKey="id"
          loading={loading}
          rowClassName={highlight.rowClassName}
          onRow={highlight.onRow}
          pagination={{
            current: page,
            pageSize: size,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
          }}
          onChange={handleTableChange}
          expandable={{
            expandedRowKeys,
            onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as number[]),
            expandedRowRender: (record) => (
              <div style={{ padding: '8px 0' }}>
                {editingId === record.id ? (
                  <>
                    <div style={{ marginBottom: 8 }}>
                      <strong>药名：</strong>
                      <Input size="small" value={editingData.name} onChange={(e) => setEditingData((d) => ({ ...d, name: e.target.value }))} style={{ width: isMobile ? '100%' : 200 }} />
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <strong>别名：</strong>
                      <Input size="small" value={editingData.alias} onChange={(e) => setEditingData((d) => ({ ...d, alias: e.target.value }))} />
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <strong>分类：</strong>
                      <Input size="small" value={editingData.category} onChange={(e) => setEditingData((d) => ({ ...d, category: e.target.value }))} style={{ width: isMobile ? '100%' : 200 }} />
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <strong>性味归经：</strong>
                      <Input size="small" value={editingData.properties} onChange={(e) => setEditingData((d) => ({ ...d, properties: e.target.value }))} />
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <strong>功效：</strong>
                      <Input.TextArea rows={2} value={editingData.effects} onChange={(e) => setEditingData((d) => ({ ...d, effects: e.target.value }))} />
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <strong>主治：</strong>
                      <Input.TextArea rows={2} value={editingData.indications} onChange={(e) => setEditingData((d) => ({ ...d, indications: e.target.value }))} />
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <strong>道地产区：</strong>
                      <Input size="small" value={editingData.origin} onChange={(e) => setEditingData((d) => ({ ...d, origin: e.target.value }))} />
                    </div>
                    <Space>
                      <Button type="primary" size="small" icon={<SaveOutlined />} onClick={handleSave}>保存</Button>
                      <Button size="small" icon={<ThunderboltOutlined />} loading={aiRefreshing} onClick={handleAiRefresh}>AI查询</Button>
                      <Button size="small" icon={<CloseOutlined />} onClick={() => setEditingId(null)}>取消</Button>
                    </Space>
                  </>
                ) : (
                  <>
                    <p><strong>别名：</strong>{record.alias || '无'}</p>
                    <p><strong>性味归经：</strong>{record.properties || '无'}</p>
                    <p><strong>功效：</strong>{record.effects || '无'}</p>
                    <p><strong>主治：</strong>{record.indications || '无'}</p>
                    <p><strong>道地产区：</strong>{record.origin || '无'}</p>
                    {record.source === 'deepseek' ? (
                      <Tag className="warm-tag-ai" icon={<RobotOutlined />}>
                        数据来源：DeepSeek AI（仅供参考，请结合临床经验）
                      </Tag>
                    ) : record.source === 'manual' ? (
                      <Tag className="warm-tag-local">数据来源：手动录入</Tag>
                    ) : (
                      <Tag className="warm-tag-local">数据来源：本地数据</Tag>
                    )}
                  </>
                )}
              </div>
            ),
          }}
        />
      )}

      <Modal
        title="新增中药"
        open={createModalVisible}
        onOk={handleCreate}
        onCancel={() => { setCreateModalVisible(false); createForm.resetFields(); }}
        confirmLoading={creating}
        okText="保存"
        cancelText="取消"
        destroyOnClose
        width={isMobile ? 'calc(100vw - 32px)' : 520}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item label="药名" name="name" rules={[{ required: true, message: '请输入药名' }]}>
            <Input placeholder="请输入药名" />
          </Form.Item>
          <Form.Item label="别名" name="alias">
            <Input placeholder="请输入别名" />
          </Form.Item>
          <Form.Item label="分类" name="category">
            <Input placeholder="请输入分类（如：补气药、补血药）" />
          </Form.Item>
          <Form.Item label="性味归经" name="properties">
            <Input placeholder="请输入性味归经" />
          </Form.Item>
          <Form.Item label="功效" name="effects">
            <Input.TextArea rows={2} placeholder="请输入功效" />
          </Form.Item>
          <Form.Item label="主治" name="indications">
            <Input.TextArea rows={2} placeholder="请输入主治" />
          </Form.Item>
          <Form.Item label="道地产区" name="origin">
            <Input placeholder="请输入道地产区" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
