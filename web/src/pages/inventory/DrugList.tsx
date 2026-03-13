import { useState, useCallback, useEffect } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Input,
  Select,
  Modal,
  Form,
  InputNumber,
  Popconfirm,
  message,
  Tag,
} from 'antd';
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  listInventoryDrugs,
  createInventoryDrug,
  updateInventoryDrug,
  deleteInventoryDrug,
} from '../../api/inventory';
import type { InventoryDrug, CreateInventoryDrugReq } from '../../api/inventory';
import useIsMobile from '../../hooks/useIsMobile';

const getDefaultThreshold = (category: string): number => {
  const config = JSON.parse(localStorage.getItem('inventory-alert-config') || '{}');
  return category === 'herb' ? (config.herbThreshold ?? 500) : (config.patentThreshold ?? 10);
};

const isLowStock = (drug: InventoryDrug): boolean => {
  const threshold = drug.alert_threshold ?? getDefaultThreshold(drug.category);
  return drug.stock < threshold;
};

export default function DrugList() {
  const isMobile = useIsMobile();
  const [drugs, setDrugs] = useState<InventoryDrug[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [params, setParams] = useState({ page: 1, size: 20, name: '', category: '' });
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDrug, setEditingDrug] = useState<InventoryDrug | null>(null);
  const [modalCategory, setModalCategory] = useState<'herb' | 'patent'>('herb');
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [form] = Form.useForm();

  // Search local state
  const [searchName, setSearchName] = useState('');
  const [searchCategory, setSearchCategory] = useState('');

  const fetchDrugs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listInventoryDrugs(params);
      const body = res as any;
      setDrugs(body.data?.list || []);
      setTotal(body.data?.total || 0);
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    fetchDrugs();
  }, [fetchDrugs]);

  const handleSearch = () => {
    setParams((prev) => ({
      ...prev,
      page: 1,
      name: searchName,
      category: searchCategory,
    }));
  };

  const handleReset = () => {
    setSearchName('');
    setSearchCategory('');
    setParams({ page: 1, size: 20, name: '', category: '' });
  };

  const handleAdd = () => {
    setEditingDrug(null);
    setModalCategory('herb');
    form.resetFields();
    form.setFieldsValue({ category: 'herb' });
    setModalOpen(true);
  };

  const handleEdit = (record: InventoryDrug) => {
    setEditingDrug(record);
    setModalCategory(record.category);
    form.setFieldsValue({
      name: record.name,
      category: record.category,
      stock: record.stock,
      purchase_price: record.purchase_price,
      selling_price: record.selling_price,
      alert_threshold: record.alert_threshold,
      remark: record.remark,
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteInventoryDrug(id);
      message.success('删除成功');
      fetchDrugs();
    } catch {
      // handled by interceptor
    }
  };

  const handleModalOk = async () => {
    try {
      const values = await form.validateFields();
      setConfirmLoading(true);
      const payload: CreateInventoryDrugReq = {
        name: values.name,
        category: values.category,
        stock: values.stock,
        purchase_price: values.purchase_price,
        selling_price: values.selling_price,
        alert_threshold: values.alert_threshold ?? null,
        remark: values.remark || '',
      };
      if (editingDrug) {
        await updateInventoryDrug(editingDrug.id, payload);
        message.success('更新成功');
      } else {
        await createInventoryDrug(payload);
        message.success('新增成功');
      }
      setModalOpen(false);
      fetchDrugs();
    } catch {
      // Validation error or API error handled by interceptor
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleModalCancel = () => {
    setModalOpen(false);
    setEditingDrug(null);
    form.resetFields();
  };

  const unitLabel = modalCategory === 'herb' ? '克' : '盒';
  const priceUnit = modalCategory === 'herb' ? '元/500克' : '元/盒';

  const columns: ColumnsType<InventoryDrug> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 120,
    },
    {
      title: '种类',
      dataIndex: 'category',
      key: 'category',
      width: 80,
      render: (val: string) =>
        val === 'herb' ? (
          <Tag color="green">本草</Tag>
        ) : (
          <Tag color="blue">成药</Tag>
        ),
    },
    {
      title: '库存量',
      dataIndex: 'stock',
      key: 'stock',
      width: 100,
      render: (val: number, record: InventoryDrug) =>
        `${val} ${record.category === 'herb' ? '克' : '盒'}`,
    },
    {
      title: '进货价',
      dataIndex: 'purchase_price',
      key: 'purchase_price',
      width: 120,
      render: (val: number, record: InventoryDrug) =>
        `${val} ${record.category === 'herb' ? '元/500克' : '元/盒'}`,
    },
    {
      title: '出售价',
      dataIndex: 'selling_price',
      key: 'selling_price',
      width: 120,
      render: (val: number, record: InventoryDrug) =>
        `${val} ${record.category === 'herb' ? '元/500克' : '元/盒'}`,
    },
    {
      title: '预警阈值',
      dataIndex: 'alert_threshold',
      key: 'alert_threshold',
      width: 100,
      render: (val: number | null) => (val == null ? '默认' : val),
    },
    {
      title: '备注',
      dataIndex: 'remark',
      key: 'remark',
      ellipsis: true,
      responsive: ['md'],
      render: (val: string) => val || '-',
    },
    {
      title: '操作',
      key: 'action',
      width: isMobile ? 90 : 140,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            {!isMobile && '编辑'}
          </Button>
          <Popconfirm
            title="确定删除此药物？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              {!isMobile && '删除'}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <style>{`
        .low-stock-row { background-color: #fff1f0 !important; }
        .low-stock-row:hover > td { background-color: #ffccc7 !important; }
      `}</style>
      <Card>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 16,
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <Space wrap>
            <Input
              placeholder="搜索药物名称"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              onPressEnter={handleSearch}
              style={{ width: 200 }}
              allowClear
            />
            <Select
              value={searchCategory || undefined}
              placeholder="全部种类"
              style={{ width: 120 }}
              allowClear
              onChange={(val) => setSearchCategory(val || '')}
              options={[
                { value: 'herb', label: '本草' },
                { value: 'patent', label: '成药' },
              ]}
            />
            <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
              搜索
            </Button>
            <Button onClick={handleReset}>重置</Button>
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            新增药物
          </Button>
        </div>

        <Table<InventoryDrug>
          rowKey="id"
          columns={columns}
          dataSource={drugs}
          loading={loading}
          rowClassName={(record) => (isLowStock(record) ? 'low-stock-row' : '')}
          pagination={{
            current: params.page,
            pageSize: params.size,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条记录`,
            onChange: (page, pageSize) => {
              setParams((prev) => ({ ...prev, page, size: pageSize }));
            },
          }}
          locale={{ emptyText: '暂无药物记录' }}
        />
      </Card>

      <Modal
        title={editingDrug ? '编辑药物' : '新增药物'}
        open={modalOpen}
        onOk={handleModalOk}
        onCancel={handleModalCancel}
        confirmLoading={confirmLoading}
        okText={editingDrug ? '保存' : '新增'}
        cancelText="取消"
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ category: 'herb' }}
        >
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: '请输入药物名称' }]}
          >
            <Input placeholder="请输入药物名称" />
          </Form.Item>

          <Form.Item
            label="种类"
            name="category"
            rules={[{ required: true, message: '请选择种类' }]}
          >
            <Select
              options={[
                { value: 'herb', label: '本草' },
                { value: 'patent', label: '成药' },
              ]}
              onChange={(val) => setModalCategory(val as 'herb' | 'patent')}
            />
          </Form.Item>

          <Form.Item
            label="库存量"
            name="stock"
            rules={[{ required: true, message: '请输入库存量' }]}
          >
            <InputNumber
              min={0}
              precision={2}
              addonAfter={unitLabel}
              style={{ width: '100%' }}
              placeholder="请输入库存量"
            />
          </Form.Item>

          <Form.Item
            label="进货价"
            name="purchase_price"
            rules={[{ required: true, message: '请输入进货价' }]}
          >
            <InputNumber
              min={0}
              precision={2}
              addonAfter={priceUnit}
              style={{ width: '100%' }}
              placeholder="请输入进货价"
            />
          </Form.Item>

          <Form.Item
            label="出售价"
            name="selling_price"
            rules={[{ required: true, message: '请输入出售价' }]}
          >
            <InputNumber
              min={0}
              precision={2}
              addonAfter={priceUnit}
              style={{ width: '100%' }}
              placeholder="请输入出售价"
            />
          </Form.Item>

          <Form.Item
            label="预警阈值"
            name="alert_threshold"
            tooltip="留空则使用全局默认值"
          >
            <InputNumber
              min={0}
              precision={2}
              style={{ width: '100%' }}
              placeholder="留空使用默认值"
            />
          </Form.Item>

          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={3} placeholder="备注（可选）" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
