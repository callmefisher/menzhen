import { useState, useEffect } from 'react';
import { Input, Table, Tag, message, Button, Popconfirm, Select, Space } from 'antd';
import { SearchOutlined, RobotOutlined, DeleteOutlined, EditOutlined, SaveOutlined, CloseOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { listHerbs, deleteHerb, listHerbCategories, updateHerb, aiRefreshHerb } from '../../api/herb';
import type { HerbItem } from '../../api/herb';
import { useAuth } from '../../store/auth';
import useIsMobile from '../../hooks/useIsMobile';

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
    setPage(newPage);
    setSize(newSize);
    fetchHerbs(searchName, selectedCategory, newPage, newSize);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteHerb(id);
      message.success('删除成功');
      fetchHerbs(searchName, selectedCategory, page, size);
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
      setEditingId(null);
      fetchHerbs(searchName, selectedCategory, page, size);
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

  const columns: ColumnsType<HerbItem> = [
    {
      title: '药名',
      dataIndex: 'name',
      key: 'name',
      width: 160,
    },
    {
      title: '别名',
      dataIndex: 'alias',
      key: 'alias',
      width: 200,
      ellipsis: true,
      responsive: ['md'] as any,
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      responsive: ['md'] as any,
    },
    {
      title: '性味归经',
      dataIndex: 'properties',
      key: 'properties',
      width: 200,
      ellipsis: true,
      responsive: ['md'] as any,
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
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 100,
      responsive: ['md'] as any,
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

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexDirection: isMobile ? 'column' : 'row' }}>
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
          style={{ minWidth: 160 }}
          value={selectedCategory}
          onChange={handleCategoryChange}
          options={categories.map((c) => ({ label: c, value: c }))}
        />
      </div>

      <Table<HerbItem>
        columns={columns}
        dataSource={herbs}
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
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as number[]),
          expandedRowRender: (record) => (
            <div style={{ padding: '8px 0' }}>
              {editingId === record.id ? (
                <>
                  <div style={{ marginBottom: 8 }}>
                    <strong>药名：</strong>
                    <Input size="small" value={editingData.name} onChange={(e) => setEditingData((d) => ({ ...d, name: e.target.value }))} style={{ width: 200 }} />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <strong>别名：</strong>
                    <Input size="small" value={editingData.alias} onChange={(e) => setEditingData((d) => ({ ...d, alias: e.target.value }))} />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <strong>分类：</strong>
                    <Input size="small" value={editingData.category} onChange={(e) => setEditingData((d) => ({ ...d, category: e.target.value }))} style={{ width: 200 }} />
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
                  {record.source === 'deepseek' && (
                    <Tag icon={<RobotOutlined />} color="blue">
                      数据来源：DeepSeek AI（仅供参考，请结合临床经验）
                    </Tag>
                  )}
                </>
              )}
            </div>
          ),
        }}
      />
    </div>
  );
}
