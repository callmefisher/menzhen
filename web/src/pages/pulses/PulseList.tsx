import { useState, useEffect } from 'react';
import { Input, Table, message, Button, Popconfirm, Select, Space, Modal, Form } from 'antd';
import { SearchOutlined, DeleteOutlined, EditOutlined, SaveOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { listPulses, deletePulse, listPulseCategories, updatePulse, createPulse } from '../../api/pulse';
import type { PulseItem } from '../../api/pulse';
import { useAuth } from '../../store/auth';
import useIsMobile from '../../hooks/useIsMobile';

export default function PulseList() {
  const [pulses, setPulses] = useState<PulseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [searchName, setSearchName] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(undefined);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingData, setEditingData] = useState<Partial<PulseItem>>({});
  const [expandedRowKeys, setExpandedRowKeys] = useState<number[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const { hasPermission } = useAuth();
  const isMobile = useIsMobile();
  const [createForm] = Form.useForm();

  useEffect(() => {
    listPulseCategories()
      .then((res) => {
        const body = res as unknown as { data: string[] };
        setCategories(body.data || []);
      })
      .catch(() => {
        // ignore
      });
    // Load all pulses on mount
    fetchPulses('', undefined, 1, size);
  }, []);

  const fetchPulses = async (name: string, category: string | undefined, p: number, s: number) => {
    setLoading(true);
    try {
      const res = await listPulses({ name, category, page: p, size: s });
      const body = res as unknown as { data: { list: PulseItem[]; total: number } };
      setPulses(body.data.list || []);
      setTotal(body.data.total || 0);
    } catch {
      message.error('查询脉象失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearchName(value);
    setPage(1);
    fetchPulses(value, selectedCategory, 1, size);
  };

  const handleCategoryChange = (value: string | undefined) => {
    setSelectedCategory(value);
    setPage(1);
    fetchPulses(searchName, value, 1, size);
  };

  const handleTableChange = (pagination: { current?: number; pageSize?: number }) => {
    const newPage = pagination.current || 1;
    const newSize = pagination.pageSize || 20;
    setPage(newPage);
    setSize(newSize);
    fetchPulses(searchName, selectedCategory, newPage, newSize);
  };

  const handleDelete = async (id: number) => {
    try {
      await deletePulse(id);
      message.success('删除成功');
      fetchPulses(searchName, selectedCategory, page, size);
    } catch {
      // Error handled by interceptor
    }
  };

  const startEdit = (record: PulseItem) => {
    setEditingId(record.id);
    setEditingData({
      name: record.name,
      category: record.category,
      description: record.description,
      clinical_meaning: record.clinical_meaning,
      common_conditions: record.common_conditions,
    });
    setExpandedRowKeys((keys) =>
      keys.includes(record.id) ? keys : [...keys, record.id]
    );
  };

  const handleSave = async () => {
    if (!editingId) return;
    try {
      await updatePulse(editingId, editingData);
      message.success('更新成功');
      setEditingId(null);
      fetchPulses(searchName, selectedCategory, page, size);
    } catch {
      // Error handled by interceptor
    }
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setCreateLoading(true);
      await createPulse(values);
      message.success('新增脉象成功');
      setCreateModalOpen(false);
      createForm.resetFields();
      fetchPulses(searchName, selectedCategory, page, size);
      // Refresh categories in case a new one was added
      listPulseCategories()
        .then((res) => {
          const body = res as unknown as { data: string[] };
          setCategories(body.data || []);
        })
        .catch(() => {});
    } catch {
      // Validation or API error
    } finally {
      setCreateLoading(false);
    }
  };

  const columns: ColumnsType<PulseItem> = [
    {
      title: '脉名',
      dataIndex: 'name',
      key: 'name',
      width: 120,
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 120,
      responsive: ['md'] as any,
    },
    {
      title: '特征描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    ...(hasPermission('role:manage')
      ? [
          {
            title: '操作',
            key: 'action',
            width: 140,
            render: (_: unknown, record: PulseItem) => (
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
                  title="确定删除此脉象？"
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
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexDirection: isMobile ? 'column' : 'row', flexWrap: 'wrap' }}>
        <Input.Search
          placeholder="输入脉象名称搜索"
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
        {hasPermission('role:manage') && (
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalOpen(true)}
          >
            新增脉象
          </Button>
        )}
      </div>

      <Table<PulseItem>
        columns={columns}
        dataSource={pulses}
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
                    <strong>脉名：</strong>
                    <Input size="small" value={editingData.name} onChange={(e) => setEditingData((d) => ({ ...d, name: e.target.value }))} style={{ width: 200 }} />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <strong>分类：</strong>
                    <Input size="small" value={editingData.category} onChange={(e) => setEditingData((d) => ({ ...d, category: e.target.value }))} style={{ width: 200 }} />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <strong>特征描述：</strong>
                    <Input.TextArea rows={2} value={editingData.description} onChange={(e) => setEditingData((d) => ({ ...d, description: e.target.value }))} />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <strong>临床意义：</strong>
                    <Input.TextArea rows={2} value={editingData.clinical_meaning} onChange={(e) => setEditingData((d) => ({ ...d, clinical_meaning: e.target.value }))} />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <strong>常见病证：</strong>
                    <Input.TextArea rows={2} value={editingData.common_conditions} onChange={(e) => setEditingData((d) => ({ ...d, common_conditions: e.target.value }))} />
                  </div>
                  <Space>
                    <Button type="primary" size="small" icon={<SaveOutlined />} onClick={handleSave}>保存</Button>
                    <Button size="small" icon={<CloseOutlined />} onClick={() => setEditingId(null)}>取消</Button>
                  </Space>
                </>
              ) : (
                <>
                  <p><strong>分类：</strong>{record.category || '无'}</p>
                  <p><strong>特征描述：</strong>{record.description || '无'}</p>
                  <p><strong>临床意义：</strong>{record.clinical_meaning || '无'}</p>
                  <p><strong>常见病证：</strong>{record.common_conditions || '无'}</p>
                </>
              )}
            </div>
          ),
        }}
      />

      {/* Create pulse modal */}
      <Modal
        title="新增脉象"
        open={createModalOpen}
        onOk={handleCreate}
        onCancel={() => {
          setCreateModalOpen(false);
          createForm.resetFields();
        }}
        confirmLoading={createLoading}
        okText="确认"
        cancelText="取消"
        destroyOnClose
      >
        <Form
          form={createForm}
          layout="vertical"
          autoComplete="off"
        >
          <Form.Item
            label="脉名"
            name="name"
            rules={[{ required: true, message: '请输入脉名' }]}
          >
            <Input placeholder="请输入脉名" />
          </Form.Item>
          <Form.Item
            label="分类"
            name="category"
          >
            <Input placeholder="请输入分类" />
          </Form.Item>
          <Form.Item
            label="特征描述"
            name="description"
          >
            <Input.TextArea rows={3} placeholder="请输入特征描述" />
          </Form.Item>
          <Form.Item
            label="临床意义"
            name="clinical_meaning"
          >
            <Input.TextArea rows={3} placeholder="请输入临床意义" />
          </Form.Item>
          <Form.Item
            label="常见病证"
            name="common_conditions"
          >
            <Input.TextArea rows={3} placeholder="请输入常见病证" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
