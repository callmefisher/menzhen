import { useState, useEffect } from 'react';
import { Input, Table, message, Button, Popconfirm, Select, Space, Modal, Form, AutoComplete } from 'antd';
import { SearchOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  listClinicalExperiences,
  deleteClinicalExperience,
  listClinicalExperienceCategories,
  createClinicalExperience,
  updateClinicalExperience,
} from '../../api/clinicalExperience';
import type { ClinicalExperienceItem } from '../../api/clinicalExperience';
import { useAuth } from '../../store/auth';
import useIsMobile from '../../hooks/useIsMobile';

export default function ClinicalExperienceList() {
  const [items, setItems] = useState<ClinicalExperienceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [editingItem, setEditingItem] = useState<ClinicalExperienceItem | null>(null);
  const { hasPermission } = useAuth();
  const isMobile = useIsMobile();
  const [form] = Form.useForm();

  useEffect(() => {
    loadCategories();
    fetchItems('', undefined, 1, size);
  }, []);

  const loadCategories = () => {
    listClinicalExperienceCategories()
      .then((res) => {
        const body = res as unknown as { data: string[] };
        setCategories(body.data || []);
      })
      .catch(() => {});
  };

  const fetchItems = async (keyword: string, category: string | undefined, p: number, s: number) => {
    setLoading(true);
    try {
      const res = await listClinicalExperiences({ keyword, category, page: p, size: s });
      const body = res as unknown as { data: { list: ClinicalExperienceItem[]; total: number } };
      setItems(body.data.list || []);
      setTotal(body.data.total || 0);
    } catch {
      message.error('查询临床经验失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearchKeyword(value);
    setPage(1);
    fetchItems(value, selectedCategory, 1, size);
  };

  const handleCategoryChange = (value: string | undefined) => {
    setSelectedCategory(value);
    setPage(1);
    fetchItems(searchKeyword, value, 1, size);
  };

  const handleTableChange = (pagination: { current?: number; pageSize?: number }) => {
    const newPage = pagination.current || 1;
    const newSize = pagination.pageSize || 20;
    setPage(newPage);
    setSize(newSize);
    fetchItems(searchKeyword, selectedCategory, newPage, newSize);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteClinicalExperience(id);
      message.success('删除成功');
      fetchItems(searchKeyword, selectedCategory, page, size);
      loadCategories();
    } catch {
      // Error handled by interceptor
    }
  };

  const openCreateModal = () => {
    setEditingItem(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEditModal = (record: ClinicalExperienceItem) => {
    setEditingItem(record);
    form.setFieldsValue({
      source: record.source,
      category: record.category,
      herbs: record.herbs,
      formula: record.formula,
      experience: record.experience,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setModalLoading(true);
      if (editingItem) {
        await updateClinicalExperience(editingItem.id, values);
        message.success('更新成功');
      } else {
        await createClinicalExperience(values);
        message.success('新增成功');
      }
      setModalOpen(false);
      form.resetFields();
      setEditingItem(null);
      fetchItems(searchKeyword, selectedCategory, page, size);
      loadCategories();
    } catch {
      // Validation or API error
    } finally {
      setModalLoading(false);
    }
  };

  const columns: ColumnsType<ClinicalExperienceItem> = [
    {
      title: '出处',
      dataIndex: 'source',
      key: 'source',
      width: 150,
      ellipsis: true,
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      responsive: ['md'] as any,
    },
    {
      title: '药物',
      dataIndex: 'herbs',
      key: 'herbs',
      width: 150,
      ellipsis: true,
      responsive: ['lg'] as any,
    },
    {
      title: '方剂',
      dataIndex: 'formula',
      key: 'formula',
      width: 150,
      ellipsis: true,
      responsive: ['lg'] as any,
    },
    {
      title: '使用经验',
      dataIndex: 'experience',
      key: 'experience',
      ellipsis: true,
    },
    ...(hasPermission('role:manage')
      ? [
          {
            title: '操作',
            key: 'action',
            width: 140,
            render: (_: unknown, record: ClinicalExperienceItem) => (
              <Space size="small">
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => openEditModal(record)}
                >
                  编辑
                </Button>
                <Popconfirm
                  title="确定删除此条经验？"
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
          placeholder="搜索出处、药物、方剂、经验"
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
            onClick={openCreateModal}
          >
            新增经验
          </Button>
        )}
      </div>

      <Table<ClinicalExperienceItem>
        columns={columns}
        dataSource={items}
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
          expandedRowRender: (record) => (
            <div style={{ padding: '8px 0' }}>
              <p><strong>出处：</strong>{record.source || '无'}</p>
              <p><strong>分类：</strong>{record.category || '无'}</p>
              <p><strong>药物：</strong>{record.herbs || '无'}</p>
              <p><strong>方剂：</strong>{record.formula || '无'}</p>
              <p><strong>使用经验：</strong>{record.experience || '无'}</p>
            </div>
          ),
        }}
      />

      <Modal
        title={editingItem ? '编辑临床经验' : '新增临床经验'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
          setEditingItem(null);
        }}
        confirmLoading={modalLoading}
        okText="确认"
        cancelText="取消"
        destroyOnClose
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          autoComplete="off"
        >
          <Form.Item
            label="出处"
            name="source"
          >
            <Input placeholder="如：伤寒论、张锡纯经验" />
          </Form.Item>
          <Form.Item
            label="分类"
            name="category"
          >
            <AutoComplete
              placeholder="选择或输入分类"
              options={categories.map((c) => ({ value: c }))}
              filterOption={(inputValue, option) =>
                (option?.value as string).toLowerCase().includes(inputValue.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item
            label="药物"
            name="herbs"
          >
            <Input.TextArea rows={2} placeholder="相关药物" />
          </Form.Item>
          <Form.Item
            label="方剂"
            name="formula"
          >
            <Input.TextArea rows={2} placeholder="相关方剂" />
          </Form.Item>
          <Form.Item
            label="使用经验"
            name="experience"
            rules={[{ required: true, message: '请输入使用经验' }]}
          >
            <Input.TextArea rows={4} placeholder="临床使用经验描述" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
