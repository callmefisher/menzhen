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
  Checkbox,
} from 'antd';
import {
  EditOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { listUsers, updateUser, assignRoles } from '../../api/user';
import { listRoles } from '../../api/role';

interface RoleItem {
  id: number;
  name: string;
}

interface UserItem {
  id: number;
  username: string;
  real_name: string;
  phone: string;
  status: number;
  roles: RoleItem[];
  created_at: string;
}

interface ListParams {
  page: number;
  size: number;
}

export default function UserList() {
  const [data, setData] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [params, setParams] = useState<ListParams>({ page: 1, size: 20 });

  // Edit modal state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [editForm] = Form.useForm();
  const [editLoading, setEditLoading] = useState(false);

  // Role assignment modal state
  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const [roleTargetUser, setRoleTargetUser] = useState<UserItem | null>(null);
  const [allRoles, setAllRoles] = useState<RoleItem[]>([]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<number[]>([]);
  const [roleLoading, setRoleLoading] = useState(false);

  const fetchData = useCallback(async (query: ListParams) => {
    setLoading(true);
    try {
      const res = await listUsers({
        page: query.page,
        size: query.size,
      });
      const body = res as unknown as {
        data: {
          list: UserItem[];
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

  // --- Edit user ---
  const handleEdit = (record: UserItem) => {
    setEditingUser(record);
    editForm.setFieldsValue({
      real_name: record.real_name,
      phone: record.phone,
      status: record.status,
    });
    setEditModalVisible(true);
  };

  const handleEditSubmit = async () => {
    try {
      const values = await editForm.validateFields();
      setEditLoading(true);
      await updateUser(editingUser!.id, {
        real_name: values.real_name,
        phone: values.phone,
        status: values.status,
      });
      message.success('更新成功');
      setEditModalVisible(false);
      setEditingUser(null);
      editForm.resetFields();
      fetchData(params);
    } catch {
      // Validation or request error
    } finally {
      setEditLoading(false);
    }
  };

  // --- Toggle status ---
  const handleToggleStatus = async (record: UserItem) => {
    const newStatus = record.status === 1 ? 0 : 1;
    try {
      await updateUser(record.id, { status: newStatus });
      message.success(newStatus === 1 ? '已启用' : '已禁用');
      fetchData(params);
    } catch {
      // Error already handled by request interceptor
    }
  };

  // --- Assign roles ---
  const handleOpenRoleModal = async (record: UserItem) => {
    setRoleTargetUser(record);
    setSelectedRoleIds((record.roles || []).map((r) => r.id));
    setRoleModalVisible(true);
    // Fetch all roles
    try {
      const res = await listRoles();
      const body = res as unknown as { data: RoleItem[] };
      setAllRoles(body.data || []);
    } catch {
      // Error already handled by request interceptor
    }
  };

  const handleRoleSubmit = async () => {
    if (!roleTargetUser) return;
    setRoleLoading(true);
    try {
      await assignRoles(roleTargetUser.id, selectedRoleIds);
      message.success('角色分配成功');
      setRoleModalVisible(false);
      setRoleTargetUser(null);
      fetchData(params);
    } catch {
      // Error already handled by request interceptor
    } finally {
      setRoleLoading(false);
    }
  };

  const columns: ColumnsType<UserItem> = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      width: 120,
    },
    {
      title: '真实姓名',
      dataIndex: 'real_name',
      key: 'real_name',
      width: 120,
      render: (val: string) => val || '-',
    },
    {
      title: '手机号',
      dataIndex: 'phone',
      key: 'phone',
      width: 140,
      render: (val: string) => val || '-',
    },
    {
      title: '角色',
      dataIndex: 'roles',
      key: 'roles',
      width: 200,
      render: (roles: RoleItem[]) => {
        if (!roles || roles.length === 0) return '-';
        return (
          <Space size={[0, 4]} wrap>
            {roles.map((role) => (
              <Tag key={role.id} color="blue">
                {role.name}
              </Tag>
            ))}
          </Space>
        );
      },
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
      title: '操作',
      key: 'action',
      width: 240,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            icon={<UserSwitchOutlined />}
            onClick={() => handleOpenRoleModal(record)}
          >
            分配角色
          </Button>
          <Popconfirm
            title={record.status === 1 ? '确定禁用此用户？' : '确定启用此用户？'}
            onConfirm={() => handleToggleStatus(record)}
            okText="确定"
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              danger={record.status === 1}
            >
              {record.status === 1 ? '禁用' : '启用'}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card>
      <Table<UserItem>
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
          emptyText: '暂无用户记录',
        }}
      />

      {/* Edit user modal */}
      <Modal
        title="编辑用户"
        open={editModalVisible}
        onOk={handleEditSubmit}
        onCancel={() => {
          setEditModalVisible(false);
          setEditingUser(null);
          editForm.resetFields();
        }}
        confirmLoading={editLoading}
        okText="保存"
        cancelText="取消"
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="real_name"
            label="真实姓名"
            rules={[{ required: true, message: '请输入真实姓名' }]}
          >
            <Input placeholder="请输入真实姓名" />
          </Form.Item>
          <Form.Item name="phone" label="手机号">
            <Input placeholder="请输入手机号" />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Radio.Group>
              <Radio value={1}>启用</Radio>
              <Radio value={0}>禁用</Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>

      {/* Assign roles modal */}
      <Modal
        title={`分配角色 - ${roleTargetUser?.username || ''}`}
        open={roleModalVisible}
        onOk={handleRoleSubmit}
        onCancel={() => {
          setRoleModalVisible(false);
          setRoleTargetUser(null);
          setSelectedRoleIds([]);
        }}
        confirmLoading={roleLoading}
        okText="保存"
        cancelText="取消"
      >
        <Checkbox.Group
          value={selectedRoleIds}
          onChange={(vals) => setSelectedRoleIds(vals as number[])}
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {allRoles.map((role) => (
            <Checkbox key={role.id} value={role.id}>
              {role.name}
            </Checkbox>
          ))}
        </Checkbox.Group>
        {allRoles.length === 0 && (
          <div style={{ color: '#999' }}>暂无可分配角色</div>
        )}
      </Modal>
    </Card>
  );
}
