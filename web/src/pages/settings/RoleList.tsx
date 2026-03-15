import { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Button,
  Space,
  Popconfirm,
  message,
  Card,
  Modal,
  Form,
  Input,
  Checkbox,
  Spin,
  Empty,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { listRoles, createRole, updateRole, listPermissions, deleteRole } from '../../api/role';
import {
  listTenantRoles,
  createTenantRole,
  updateTenantRole,
  deleteTenantRole,
  listTenantPermissions,
} from '../../api/tenant-admin';
import { useAuth } from '../../store/auth';
import useIsMobile from '../../hooks/useIsMobile';

interface PermissionItem {
  id: number;
  code: string;
  name: string;
}

interface RoleItem {
  id: number;
  name: string;
  description: string;
  permissions: PermissionItem[];
}

// Permission groups for display
const PERMISSION_GROUPS: { label: string; codes: string[] }[] = [
  {
    label: '患者管理',
    codes: ['patient:create', 'patient:read', 'patient:update', 'patient:delete'],
  },
  {
    label: '诊疗记录',
    codes: ['record:create', 'record:read', 'record:update', 'record:delete'],
  },
  {
    label: '中医药查询',
    codes: ['herb:read', 'formula:read'],
  },
  {
    label: '处方管理',
    codes: ['prescription:create', 'prescription:read'],
  },
  {
    label: '操作日志',
    codes: ['oplog:read'],
  },
  {
    label: '库存管理',
    codes: ['inventory:create', 'inventory:read', 'inventory:update', 'inventory:delete'],
  },
  {
    label: '系统管理',
    codes: ['user:manage', 'role:manage', 'tenant:manage'],
  },
  {
    label: '收费管理',
    codes: ['billing:create', 'billing:read'],
  },
  {
    label: '诊所运营',
    codes: ['tenant:user:manage', 'tenant:role:manage'],
  },
];

export default function RoleList() {
  const [data, setData] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const isMobile = useIsMobile();
  const { hasPermission } = useAuth();
  const isGlobalAdmin = hasPermission('role:manage');

  // All permissions from the backend
  const [allPermissions, setAllPermissions] = useState<PermissionItem[]>([]);

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleItem | null>(null);
  const [form] = Form.useForm();
  const [submitLoading, setSubmitLoading] = useState(false);
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<number[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = isGlobalAdmin ? await listRoles() : await listTenantRoles();
      const body = res as unknown as { data: RoleItem[] };
      setData(body.data || []);
    } catch {
      // Error already handled by request interceptor
    } finally {
      setLoading(false);
    }
  }, [isGlobalAdmin]);

  const fetchPermissions = useCallback(async () => {
    try {
      const res = isGlobalAdmin ? await listPermissions() : await listTenantPermissions();
      const body = res as unknown as { data: PermissionItem[] };
      setAllPermissions(body.data || []);
    } catch {
      // Error already handled by request interceptor
    }
  }, [isGlobalAdmin]);

  useEffect(() => {
    fetchData();
    fetchPermissions();
  }, [fetchData, fetchPermissions]);

  // Helper: get permission by code
  const getPermissionByCode = (code: string): PermissionItem | undefined =>
    allPermissions.find((p) => p.code === code);

  // Helper: get all permission ids
  const allPermissionIds = allPermissions.map((p) => p.id);

  // --- Modal open/close ---
  const handleAdd = () => {
    setEditingRole(null);
    form.resetFields();
    setSelectedPermissionIds([]);
    setModalVisible(true);
  };

  const handleEdit = (record: RoleItem) => {
    setEditingRole(record);
    form.setFieldsValue({
      name: record.name,
      description: record.description,
    });
    setSelectedPermissionIds((record.permissions || []).map((p) => p.id));
    setModalVisible(true);
  };

  const handleModalCancel = () => {
    setModalVisible(false);
    setEditingRole(null);
    form.resetFields();
    setSelectedPermissionIds([]);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitLoading(true);
      if (editingRole) {
        if (isGlobalAdmin) {
          await updateRole(editingRole.id, {
            name: values.name,
            description: values.description,
            permission_ids: selectedPermissionIds,
          });
        } else {
          await updateTenantRole(editingRole.id, {
            name: values.name,
            description: values.description,
            permission_ids: selectedPermissionIds,
          });
        }
        message.success('更新成功');
      } else {
        if (isGlobalAdmin) {
          await createRole({
            name: values.name,
            description: values.description,
            permission_ids: selectedPermissionIds,
          });
        } else {
          await createTenantRole({
            name: values.name,
            description: values.description,
            permission_ids: selectedPermissionIds,
          });
        }
        message.success('创建成功');
      }
      handleModalCancel();
      fetchData();
    } catch {
      // Validation or request error
    } finally {
      setSubmitLoading(false);
    }
  };

  // --- Delete role ---
  const handleDelete = async (id: number) => {
    try {
      if (isGlobalAdmin) {
        await deleteRole(id);
      } else {
        await deleteTenantRole(id);
      }
      message.success('删除成功');
      fetchData();
    } catch {
      // Error already handled by request interceptor
    }
  };

  // --- Select all / deselect all permissions ---
  const handleSelectAll = () => {
    setSelectedPermissionIds([...allPermissionIds]);
  };

  const handleDeselectAll = () => {
    setSelectedPermissionIds([]);
  };

  const isAllSelected =
    allPermissionIds.length > 0 &&
    selectedPermissionIds.length === allPermissionIds.length;

  // --- Toggle permission in a group ---
  const getGroupPermissionIds = (codes: string[]): number[] =>
    codes
      .map((code) => getPermissionByCode(code))
      .filter((p): p is PermissionItem => !!p)
      .map((p) => p.id);

  const handleGroupChange = (groupIds: number[], checkedValues: number[]) => {
    const otherIds = selectedPermissionIds.filter((id) => !groupIds.includes(id));
    setSelectedPermissionIds([...otherIds, ...checkedValues]);
  };

  const columns: ColumnsType<RoleItem> = [
    {
      title: '角色名',
      dataIndex: 'name',
      key: 'name',
      width: 150,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (val: string) => val || '-',
    },
    {
      title: '权限数量',
      key: 'permission_count',
      width: 120,
      render: (_, record) => (record.permissions || []).length,
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
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
          <Popconfirm
            title="确定删除此角色？"
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
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          新增角色
        </Button>
      </div>

      {isMobile ? (
        loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : data.length === 0 ? (
          <Empty description="暂无角色记录" />
        ) : (
          data.map((record) => (
            <div
              key={record.id}
              style={{
                background: '#fafafa',
                borderRadius: 8,
                padding: 12,
                marginBottom: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{record.name}</span>
                <span style={{ color: '#999', fontSize: 12 }}>权限: {(record.permissions || []).length}</span>
              </div>
              {record.description && <div style={{ color: '#666', fontSize: 13, marginBottom: 8 }}>{record.description}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <Button type="link" size="small" style={{ padding: 0 }} icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
                <Popconfirm title="确定删除此角色？" onConfirm={() => handleDelete(record.id)} okText="确定" cancelText="取消">
                  <Button type="link" size="small" style={{ padding: 0 }} danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>
              </div>
            </div>
          ))
        )
      ) : (
        <Table<RoleItem>
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={false}
          locale={{
            emptyText: '暂无角色记录',
          }}
        />
      )}

      {/* Add / Edit role modal */}
      <Modal
        title={editingRole ? '编辑角色' : '新增角色'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={handleModalCancel}
        confirmLoading={submitLoading}
        okText="保存"
        cancelText="取消"
        width={isMobile ? 'calc(100vw - 32px)' : 600}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="角色名称"
            rules={[{ required: true, message: '请输入角色名称' }]}
          >
            <Input placeholder="请输入角色名称" />
          </Form.Item>
          <Form.Item name="description" label="角色描述">
            <Input placeholder="请输入角色描述" />
          </Form.Item>
        </Form>

        <div style={{ marginBottom: 8 }}>
          <span style={{ fontWeight: 'bold', marginRight: 12 }}>权限分配</span>
          <Button
            type="link"
            size="small"
            onClick={isAllSelected ? handleDeselectAll : handleSelectAll}
          >
            {isAllSelected ? '取消全选' : '全选'}
          </Button>
        </div>

        {PERMISSION_GROUPS.map((group) => {
          const groupPermIds = getGroupPermissionIds(group.codes);
          const currentChecked = groupPermIds.filter((id) =>
            selectedPermissionIds.includes(id)
          );
          return (
            <div key={group.label} style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontWeight: 500,
                  marginBottom: 4,
                  color: '#333',
                }}
              >
                {group.label}
              </div>
              <Checkbox.Group
                value={currentChecked}
                onChange={(vals) =>
                  handleGroupChange(groupPermIds, vals as number[])
                }
              >
                <Space wrap>
                  {group.codes.map((code) => {
                    const perm = getPermissionByCode(code);
                    if (!perm) return null;
                    return (
                      <Checkbox key={perm.id} value={perm.id}>
                        {perm.name || code}
                      </Checkbox>
                    );
                  })}
                </Space>
              </Checkbox.Group>
            </div>
          );
        })}
      </Modal>
    </Card>
  );
}
