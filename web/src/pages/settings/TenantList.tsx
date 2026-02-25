import { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Button,
  Space,
  Popconfirm,
  message,
  Card,
  Tag,
  Modal,
  Form,
  Input,
  Radio,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { listTenants, createTenant, updateTenant, deleteTenant } from '../../api/tenant';

interface TenantItem {
  id: number;
  name: string;
  code: string;
  status: number;
  created_at: string;
}

interface ListParams {
  page: number;
  size: number;
}

export default function TenantList() {
  const [data, setData] = useState<TenantItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [params, setParams] = useState<ListParams>({ page: 1, size: 20 });

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTenant, setEditingTenant] = useState<TenantItem | null>(null);
  const [form] = Form.useForm();
  const [submitLoading, setSubmitLoading] = useState(false);

  const isEdit = Boolean(editingTenant);

  const fetchData = useCallback(async (query: ListParams) => {
    setLoading(true);
    try {
      const res = await listTenants({
        page: query.page,
        size: query.size,
      });
      const body = res as unknown as {
        data: {
          list: TenantItem[];
          total: number;
        };
      };
      setData(body.data.list || []);
      setTotal(body.data.total || 0);
    } catch {
      // Error already handled by request interceptor
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(params);
  }, [params, fetchData]);

  const handleOpenModal = (record?: TenantItem) => {
    if (record) {
      setEditingTenant(record);
      form.setFieldsValue({
        name: record.name,
        code: record.code,
        status: record.status,
      });
    } else {
      setEditingTenant(null);
      form.resetFields();
    }
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitLoading(true);

      if (isEdit && editingTenant) {
        await updateTenant(editingTenant.id, {
          name: values.name,
          code: values.code,
          status: values.status,
        });
        message.success('更新成功');
      } else {
        await createTenant({
          name: values.name,
          code: values.code,
        });
        message.success('创建成功');
      }

      setModalVisible(false);
      setEditingTenant(null);
      form.resetFields();
      fetchData(params);
    } catch {
      // Validation or request error
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteTenant(id);
      message.success('删除成功');
      fetchData(params);
    } catch {
      // Error already handled by request interceptor
    }
  };

  const columns: ColumnsType<TenantItem> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 60,
    },
    {
      title: '诊所名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
    },
    {
      title: '编码',
      dataIndex: 'code',
      key: 'code',
      width: 120,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (status: number) =>
        status === 1 ? (
          <Tag color="green">启用</Tag>
        ) : (
          <Tag color="red">禁用</Tag>
        ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (val: string) => val?.slice(0, 19).replace('T', ' ') || '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleOpenModal(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除此诊所？删除后关联数据将无法访问。"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: 16,
        }}
      >
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => handleOpenModal()}
        >
          新增诊所
        </Button>
      </div>

      <Table<TenantItem>
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={{
          current: params.page,
          pageSize: params.size,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条记录`,
          onChange: (page, pageSize) => {
            setParams({ page, size: pageSize });
          },
        }}
        locale={{
          emptyText: '暂无诊所记录',
        }}
      />

      <Modal
        title={isEdit ? '编辑诊所' : '新增诊所'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => {
          setModalVisible(false);
          setEditingTenant(null);
          form.resetFields();
        }}
        confirmLoading={submitLoading}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ status: 1 }}
        >
          <Form.Item
            name="name"
            label="诊所名称"
            rules={[{ required: true, message: '请输入诊所名称' }]}
          >
            <Input placeholder="请输入诊所名称" />
          </Form.Item>
          <Form.Item
            name="code"
            label="编码"
            rules={[{ required: true, message: '请输入诊所编码' }]}
          >
            <Input placeholder="请输入唯一编码，如 clinic01" />
          </Form.Item>
          {isEdit && (
            <Form.Item name="status" label="状态">
              <Radio.Group>
                <Radio value={1}>启用</Radio>
                <Radio value={0}>禁用</Radio>
              </Radio.Group>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </Card>
  );
}
