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
  Select,
  Pagination,
  Spin,
  Empty,
} from 'antd';
import {
  EditOutlined,
  UserSwitchOutlined,
  DeleteOutlined,
  KeyOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { listUsers, updateUser, deleteUser, resetUserPassword, createUser, assignRoles } from '../../api/user';
import { listRoles } from '../../api/role';
import { listTenants } from '../../api/tenant';
import {
  listTenantUsers,
  updateTenantUser,
  deleteTenantUser,
  resetTenantUserPassword,
  createTenantUser,
  assignTenantUserRoles,
  listTenantRoles,
} from '../../api/tenant-admin';
import { useAuth } from '../../store/auth';
import useIsMobile from '../../hooks/useIsMobile';
import useRowHighlight from '../../hooks/useRowHighlight';
import { useAccessibleColumns, type AccessibleColumnsType } from '../../hooks/useAccessibleColumns';
import HiddenColumnsHint from '../../components/HiddenColumnsHint';

interface TenantItem {
  id: number;
  name: string;
}

interface RoleItem {
  id: number;
  name: string;
}

interface UserItem {
  id: number;
  username: string;
  real_name: string;
  phone: string;
  notes: string;
  status: number;
  tenant_id: number;
  tenant?: TenantItem;
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
  const isMobile = useIsMobile();
  const { user: currentUser, isSuperAdmin } = useAuth();

  const highlight = useRowHighlight({
    data,
    page: params.page,
    pageSize: params.size,
    loading,
    onPageChange: (page) => setParams(prev => ({ ...prev, page })),
    idPrefix: 'user',
  });

  // Edit modal state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [editForm] = Form.useForm();
  const [editLoading, setEditLoading] = useState(false);
  const [allTenants, setAllTenants] = useState<TenantItem[]>([]);

  // Role assignment modal state
  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const [roleTargetUser, setRoleTargetUser] = useState<UserItem | null>(null);
  const [allRoles, setAllRoles] = useState<RoleItem[]>([]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<number[]>([]);
  const [roleLoading, setRoleLoading] = useState(false);

  // Reset password modal state
  const [resetPwdVisible, setResetPwdVisible] = useState(false);
  const [resetPwdTarget, setResetPwdTarget] = useState<UserItem | null>(null);
  const [resetPwdForm] = Form.useForm();
  const [resetPwdLoading, setResetPwdLoading] = useState(false);

  // Create user modal state
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createForm] = Form.useForm();
  const [createLoading, setCreateLoading] = useState(false);
  const [createTenants, setCreateTenants] = useState<TenantItem[]>([]);

  const fetchData = useCallback(async (query: ListParams) => {
    setLoading(true);
    try {
      const res = isSuperAdmin
        ? await listUsers({ page: query.page, size: query.size })
        : await listTenantUsers({ page: query.page, size: query.size });
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
  }, [isSuperAdmin]);

  useEffect(() => {
    fetchData(params);
  }, [params, fetchData]);

  // --- Edit user ---
  const handleEdit = async (record: UserItem) => {
    setEditingUser(record);
    editForm.setFieldsValue({
      real_name: record.real_name,
      phone: record.phone,
      status: record.status,
      tenant_id: record.tenant_id,
      notes: record.notes,
    });
    setEditModalVisible(true);
    // Load tenants for selector (super admin only)
    if (isSuperAdmin) {
      try {
        const res = await listTenants({ page: 1, size: 100 });
        const body = res as unknown as { data: { list: TenantItem[] } };
        setAllTenants(body.data.list || []);
      } catch {
        // handled
      }
    }
  };

  const handleEditSubmit = async () => {
    try {
      const values = await editForm.validateFields();
      if (!editingUser) return;
      const isSelf = editingUser.id === currentUser?.id;
      setEditLoading(true);
      if (isSuperAdmin) {
        await updateUser(editingUser.id, {
          real_name: values.real_name,
          phone: values.phone,
          ...(!isSelf && values.status !== undefined ? { status: values.status } : {}),
          tenant_id: values.tenant_id,
          notes: values.notes,
        });
      } else {
        await updateTenantUser(editingUser.id, {
          real_name: values.real_name,
          phone: values.phone,
          ...(!isSelf && values.status !== undefined ? { status: values.status } : {}),
          notes: values.notes,
        });
      }
      message.success('更新成功');
      const editedId = editingUser.id;
      setEditModalVisible(false);
      setEditingUser(null);
      editForm.resetFields();
      highlight.setHighlightId(editedId);
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
      if (isSuperAdmin) {
        await updateUser(record.id, { status: newStatus });
      } else {
        await updateTenantUser(record.id, { status: newStatus });
      }
      message.success(newStatus === 1 ? '已启用' : '已禁用');
      highlight.setHighlightId(record.id);
      fetchData(params);
    } catch {
      // Error already handled by request interceptor
    }
  };

  // --- Delete user ---
  const handleDelete = async (record: UserItem) => {
    try {
      if (isSuperAdmin) {
        await deleteUser(record.id);
      } else {
        await deleteTenantUser(record.id);
      }
      message.success('已删除');
      fetchData(params);
    } catch {
      // Error already handled by request interceptor
    }
  };

  // --- Reset password ---
  const handleOpenResetPwd = (record: UserItem) => {
    setResetPwdTarget(record);
    resetPwdForm.resetFields();
    setResetPwdVisible(true);
  };

  const handleResetPwdSubmit = async () => {
    if (!resetPwdTarget) return;
    try {
      const values = await resetPwdForm.validateFields();
      setResetPwdLoading(true);
      if (isSuperAdmin) {
        await resetUserPassword(resetPwdTarget.id, { new_password: values.new_password });
      } else {
        await resetTenantUserPassword(resetPwdTarget.id, { new_password: values.new_password });
      }
      message.success(`已重置 ${resetPwdTarget.username} 的密码`);
      setResetPwdVisible(false);
      setResetPwdTarget(null);
      resetPwdForm.resetFields();
    } catch {
      // Validation or request error
    } finally {
      setResetPwdLoading(false);
    }
  };

  // --- Create user ---
  const handleOpenCreate = async () => {
    createForm.resetFields();
    setCreateModalVisible(true);
    if (isSuperAdmin) {
      try {
        const res = await listTenants({ page: 1, size: 100 });
        const body = res as unknown as { data: { list: TenantItem[] } };
        setCreateTenants(body.data.list || []);
      } catch {
        // handled
      }
    }
  };

  const handleCreateSubmit = async () => {
    try {
      const values = await createForm.validateFields();
      setCreateLoading(true);
      if (isSuperAdmin) {
        await createUser({
          tenant_id: values.tenant_id,
          username: values.username,
          password: values.password,
          real_name: values.real_name,
          phone: values.phone,
        });
      } else {
        await createTenantUser({
          username: values.username,
          password: values.password,
          real_name: values.real_name,
          phone: values.phone,
        });
      }
      message.success('用户创建成功');
      setCreateModalVisible(false);
      createForm.resetFields();
      fetchData(params);
    } catch {
      // Validation or request error
    } finally {
      setCreateLoading(false);
    }
  };

  // --- Assign roles ---
  const handleOpenRoleModal = async (record: UserItem) => {
    setRoleTargetUser(record);
    setSelectedRoleIds((record.roles || []).map((r) => r.id));
    setRoleModalVisible(true);
    // Fetch all roles
    try {
      const res = isSuperAdmin
        ? await listRoles({ tenant_id: record.tenant_id })
        : await listTenantRoles();
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
      if (isSuperAdmin) {
        await assignRoles(roleTargetUser.id, selectedRoleIds);
      } else {
        await assignTenantUserRoles(roleTargetUser.id, selectedRoleIds);
      }
      message.success('角色分配成功');
      const assignedId = roleTargetUser.id;
      setRoleModalVisible(false);
      setRoleTargetUser(null);
      highlight.setHighlightId(assignedId);
      fetchData(params);
    } catch {
      // Error already handled by request interceptor
    } finally {
      setRoleLoading(false);
    }
  };

  const allColumns: AccessibleColumnsType<UserItem> = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      width: 150,
      render: (val: string, record: UserItem) => {
        const isCurrentUser = record.id === currentUser?.id;
        const isProtectedAdmin = record.username === 'admin';
        const dotDisabled = isCurrentUser || (!isCurrentUser && isProtectedAdmin);
        const isDisabled = record.status !== 1;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Popconfirm
              title={isDisabled ? '确定启用此用户？' : '确定禁用此用户？'}
              onConfirm={() => handleToggleStatus(record)}
              okText="确定"
              cancelText="取消"
              disabled={dotDisabled}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: isDisabled ? '#ff4d4f' : '#52c41a',
                  boxShadow: isDisabled
                    ? '0 0 0 3px rgba(255,77,79,.12)'
                    : '0 0 0 3px rgba(82,196,26,.15)',
                  cursor: dotDisabled ? 'default' : 'pointer',
                  flexShrink: 0,
                }}
                title={isCurrentUser ? '当前用户' : isDisabled ? '点击启用' : '点击禁用'}
              />
            </Popconfirm>
            <span style={{
              fontWeight: 500,
              color: isDisabled ? '#ff4d4f' : undefined,
              opacity: isDisabled ? 0.7 : 1,
            }}>
              {val}
            </span>
            {isDisabled && (
              <span style={{
                fontSize: 11,
                color: '#ff4d4f',
                background: '#fff2f0',
                padding: '0 5px',
                borderRadius: 3,
              }}>
                已禁用
              </span>
            )}
            {isCurrentUser && (
              <Tag color="orange" style={{ marginLeft: 0, fontSize: 11 }}>当前</Tag>
            )}
          </span>
        );
      },
    },
    {
      title: '真实姓名',
      dataIndex: 'real_name',
      key: 'real_name',
      width: 100,
      ellipsis: true,
      render: (val: string) => val || '-',
    },
    {
      title: '手机号',
      dataIndex: 'phone',
      key: 'phone',
      width: 120,
      a11yPriority: 1,
      render: (val: string) => val || '-',
    },
    ...(isSuperAdmin ? [{
      title: '所属诊所',
      key: 'tenant',
      width: 100,
      ellipsis: true,
      a11yPriority: 2,
      render: (_: unknown, record: UserItem) => record.tenant?.name || '-',
    } as AccessibleColumnsType<UserItem>[number]] : []),
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      width: 120,
      ellipsis: true,
      a11yPriority: 2,
      render: (val: string) => val || '-',
    },
    {
      title: '角色',
      dataIndex: 'roles',
      key: 'roles',
      width: 100,
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
      title: '操作',
      key: 'action',
      width: 220,
      render: (_, record) => {
        const isCurrentUser = record.id === currentUser?.id;
        const isProtectedAdmin = record.username === 'admin';
        const isReadOnly = !isCurrentUser && isProtectedAdmin;
        return (
          <Space size={4} wrap>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
              disabled={isReadOnly}
              style={{ padding: '0 4px' }}
            >
              编辑
            </Button>
            <Button
              type="link"
              size="small"
              icon={<UserSwitchOutlined />}
              onClick={() => handleOpenRoleModal(record)}
              disabled={isCurrentUser || isReadOnly}
              style={{ padding: '0 4px' }}
            >
              角色
            </Button>
            {!isCurrentUser && !isReadOnly && (
              <Button
                type="link"
                size="small"
                icon={<KeyOutlined />}
                onClick={() => handleOpenResetPwd(record)}
                title="重置密码"
                style={{ padding: '0 4px' }}
              >
                密码
              </Button>
            )}
            {!isCurrentUser && !isReadOnly && (
              <Popconfirm
                title="确定删除此用户？删除后将无法恢复。"
                onConfirm={() => handleDelete(record)}
                okText="确定"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  style={{ padding: '0 4px' }}
                >
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  const { columns, hiddenColumnTitles, hasHiddenColumns, restoreAll } = useAccessibleColumns(allColumns);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>
          新增用户
        </Button>
      </div>
      {isMobile ? (
        loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : data.length === 0 ? (
          <Empty description="暂无用户记录" />
        ) : (
          <>
            {data.map((record) => {
              const isCurrentUser = record.id === currentUser?.id;
              const isProtectedAdmin = record.username === 'admin' && (record.roles || []).some(r => r.name === '管理员');
              const isReadOnly = !isCurrentUser && isProtectedAdmin;
              const dotDisabled = isCurrentUser || isReadOnly;
              const isDisabled = record.status !== 1;
              const isHL = highlight.isHighlighted(record.id);
              return (
              <div
                key={record.id}
                id={`user-row-${record.id}`}
                className={isHL ? 'row-highlight' : ''}
                style={{
                  background: isCurrentUser ? '#fff7e6' : '#fafafa',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 8,
                  border: isCurrentUser ? '1px solid #ffd591' : '1px solid transparent',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Popconfirm
                      title={isDisabled ? '确定启用此用户？' : '确定禁用此用户？'}
                      onConfirm={() => handleToggleStatus(record)}
                      okText="确定"
                      cancelText="取消"
                      disabled={dotDisabled}
                    >
                      <span
                        style={{
                          display: 'inline-block',
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: isDisabled ? '#ff4d4f' : '#52c41a',
                          boxShadow: isDisabled
                            ? '0 0 0 3px rgba(255,77,79,.12)'
                            : '0 0 0 3px rgba(82,196,26,.15)',
                          cursor: dotDisabled ? 'default' : 'pointer',
                          flexShrink: 0,
                        }}
                      />
                    </Popconfirm>
                    <span style={{
                      fontWeight: 600,
                      fontSize: 15,
                      color: isDisabled ? '#ff4d4f' : undefined,
                      opacity: isDisabled ? 0.7 : 1,
                    }}>
                      {record.username}
                    </span>
                    {isDisabled && (
                      <span style={{
                        fontSize: 11,
                        color: '#ff4d4f',
                        background: '#fff2f0',
                        padding: '0 5px',
                        borderRadius: 3,
                      }}>
                        已禁用
                      </span>
                    )}
                    {isCurrentUser && <Tag color="orange" style={{ marginLeft: 0, fontSize: 11 }}>当前</Tag>}
                    {record.real_name && <span style={{ color: '#666', marginLeft: 2, fontSize: 13 }}>{record.real_name}</span>}
                  </div>
                </div>
                {record.phone && <div style={{ color: '#666', fontSize: 13 }}>{record.phone}</div>}
                {record.roles && record.roles.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    {record.roles.map((role) => (
                      <Tag key={role.id} color="blue" style={{ marginBottom: 2 }}>{role.name}</Tag>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <Button type="link" size="small" style={{ padding: 0 }} icon={<EditOutlined />} onClick={() => handleEdit(record)} disabled={isReadOnly}>编辑</Button>
                  <Button type="link" size="small" style={{ padding: 0 }} icon={<UserSwitchOutlined />} onClick={() => handleOpenRoleModal(record)} disabled={isCurrentUser || isReadOnly}>分配角色</Button>
                  {!isCurrentUser && !isReadOnly && (
                    <Button type="link" size="small" style={{ padding: 0 }} icon={<KeyOutlined />} onClick={() => handleOpenResetPwd(record)}>重置密码</Button>
                  )}
                  {!isCurrentUser && !isReadOnly && (
                    <Popconfirm
                      title="确定删除此用户？删除后将无法恢复。"
                      onConfirm={() => handleDelete(record)}
                      okText="确定"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                    >
                      <Button type="link" size="small" style={{ padding: 0 }} danger icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>
                  )}
                </div>
              </div>
              );
            })}
            {total > params.size && (
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <Pagination
                  size="small"
                  simple
                  current={params.page}
                  pageSize={params.size}
                  total={total}
                  onChange={(page) => setParams({ page, size: params.size })}
                />
              </div>
            )}
          </>
        )
      ) : (
        <>
        <Table<UserItem>
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={loading}
          scroll={{ x: 'max-content' }}
          rowClassName={(record) => {
            const classes: string[] = [];
            if (record.id === currentUser?.id) classes.push('current-user-row');
            const hlClass = highlight.rowClassName(record);
            if (hlClass) classes.push(hlClass);
            return classes.join(' ');
          }}
          onRow={highlight.onRow}
          pagination={{
            current: params.page,
            pageSize: params.size,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条记录`,
            onChange: (page, pageSize) => {
              highlight.setHighlightId(null);
              setParams({ page, size: pageSize });
            },
          }}
          locale={{
            emptyText: '暂无用户记录',
          }}
        />
        {hasHiddenColumns && <HiddenColumnsHint titles={hiddenColumnTitles} onRestoreAll={restoreAll} />}
        </>
      )}

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
        width={isMobile ? 'calc(100vw - 32px)' : undefined}
        destroyOnClose
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
          {isSuperAdmin && (
            <Form.Item name="tenant_id" label="所属诊所">
              <Select
                placeholder="请选择所属诊所"
                options={allTenants.map((t) => ({
                  value: t.id,
                  label: t.name,
                }))}
              />
            </Form.Item>
          )}
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} placeholder="请输入备注" />
          </Form.Item>
          {editingUser?.id !== currentUser?.id && (
            <Form.Item name="status" label="状态">
              <Radio.Group>
                <Radio value={1}>启用</Radio>
                <Radio value={0}>禁用</Radio>
              </Radio.Group>
            </Form.Item>
          )}
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
        width={isMobile ? 'calc(100vw - 32px)' : undefined}
      >
        <Checkbox.Group
          value={selectedRoleIds}
          onChange={(vals) => setSelectedRoleIds(vals as number[])}
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {allRoles.map((role) => {
            const isAdminRole = role.name === '管理员';
            const canAssignAdmin = isSuperAdmin;
            const disabled = isAdminRole && !canAssignAdmin;
            if (isAdminRole && !isSuperAdmin) return null;
            return (
              <Checkbox key={role.id} value={role.id} disabled={disabled}>
                {role.name}{disabled ? '（仅 admin 可分配）' : ''}
              </Checkbox>
            );
          })}
        </Checkbox.Group>
        {allRoles.filter((r) => {
          const isAdminRole = r.name === '管理员';
          return !isAdminRole || isSuperAdmin;
        }).length === 0 && (
          <div style={{ color: '#999' }}>暂无可分配角色</div>
        )}
      </Modal>

      {/* Reset password modal */}
      <Modal
        title={`重置密码 - ${resetPwdTarget?.username || ''}`}
        open={resetPwdVisible}
        onOk={handleResetPwdSubmit}
        onCancel={() => {
          setResetPwdVisible(false);
          setResetPwdTarget(null);
          resetPwdForm.resetFields();
        }}
        confirmLoading={resetPwdLoading}
        okText="确定重置"
        cancelText="取消"
        width={isMobile ? 'calc(100vw - 32px)' : 400}
        destroyOnClose
      >
        <Form form={resetPwdForm} layout="vertical">
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码至少 6 个字符' },
              { max: 50, message: '密码最多 50 个字符' },
            ]}
          >
            <Input.Password placeholder="请输入新密码（6-50 个字符）" />
          </Form.Item>
          <Form.Item
            name="confirm_password"
            label="确认密码"
            dependencies={['new_password']}
            rules={[
              { required: true, message: '请确认密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入新密码" />
          </Form.Item>
        </Form>
        <div style={{ color: '#999', fontSize: 12 }}>
          重置后该用户需要使用新密码重新登录
        </div>
      </Modal>

      {/* Create user modal */}
      <Modal
        title="新增用户"
        open={createModalVisible}
        onOk={handleCreateSubmit}
        onCancel={() => {
          setCreateModalVisible(false);
          createForm.resetFields();
        }}
        confirmLoading={createLoading}
        okText="创建"
        cancelText="取消"
        width={isMobile ? 'calc(100vw - 32px)' : 450}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical">
          {isSuperAdmin && (
            <Form.Item
              name="tenant_id"
              label="所属诊所"
              rules={[{ required: true, message: '请选择所属诊所' }]}
            >
              <Select
                placeholder="请选择诊所"
                options={createTenants.map((t) => ({
                  value: t.id,
                  label: t.name,
                }))}
              />
            </Form.Item>
          )}
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, message: '请输入用户名' },
              { min: 2, message: '用户名至少 2 个字符' },
              { max: 50, message: '用户名最多 50 个字符' },
            ]}
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 6, message: '密码至少 6 个字符' },
              { max: 50, message: '密码最多 50 个字符' },
            ]}
          >
            <Input.Password placeholder="请输入密码（6-50 个字符）" />
          </Form.Item>
          <Form.Item
            name="real_name"
            label="真实姓名"
            rules={[{ required: true, message: '请输入真实姓名' }]}
          >
            <Input placeholder="请输入真实姓名" />
          </Form.Item>
          <Form.Item name="phone" label="手机号">
            <Input placeholder="请输入手机号（可选）" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
