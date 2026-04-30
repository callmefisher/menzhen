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
  Radio,
  Pagination,
  Spin,
  Empty,
  Tag,
  AutoComplete,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { listTenants, createTenant, updateTenant, deleteTenant } from '../../api/tenant';
import { listAllGroups } from '../../api/powerAdmin';
import useIsMobile from '../../hooks/useIsMobile';
import useRowHighlight from '../../hooks/useRowHighlight';
import { useAuth } from '../../store/auth';
import { useAccessibleColumns, type AccessibleColumnsType } from '../../hooks/useAccessibleColumns';
import HiddenColumnsHint from '../../components/HiddenColumnsHint';

interface TenantItem {
  id: number;
  name: string;
  code: string;
  status: number;
  created_at: string;
  group_name: string;
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
  const isMobile = useIsMobile();
  const { isSuperAdmin } = useAuth();

  const highlight = useRowHighlight({
    data,
    page: params.page,
    pageSize: params.size,
    loading,
    onPageChange: (page) => setParams(prev => ({ ...prev, page })),
    idPrefix: 'tenant',
  });

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTenant, setEditingTenant] = useState<TenantItem | null>(null);
  const [form] = Form.useForm();
  const [submitLoading, setSubmitLoading] = useState(false);
  const [groupOptions, setGroupOptions] = useState<{ value: string }[]>([]);

  const isEdit = Boolean(editingTenant);

  const handleGroupSearch = useCallback(async (val: string) => {
    try {
      const res = await listAllGroups();
      const body = res as unknown as { code: number; data: { name: string; count: number }[] };
      const groups = (body.data || []).map(g => g.name);
      const filtered = groups.filter(g => !val || g.includes(val)).map(g => ({ value: g }));
      if (val && !groups.includes(val)) {
        filtered.push({ value: val });
      }
      setGroupOptions(filtered);
    } catch { /* ignore */ }
  }, []);

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
        group_name: record.group_name || 'default',
      });
    } else {
      setEditingTenant(null);
      form.resetFields();
      form.setFieldValue('group_name', 'default');
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
          group_name: values.group_name,
        });
        message.success('更新成功');
        const editedId = editingTenant.id;
        setModalVisible(false);
        setEditingTenant(null);
        form.resetFields();
        fetchData(params);
        highlight.setHighlightId(editedId);
      } else {
        await createTenant({
          name: values.name,
          code: values.code,
          group_name: values.group_name || 'default',
        });
        message.success('创建成功');
        setModalVisible(false);
        setEditingTenant(null);
        form.resetFields();
        fetchData(params);
      }
    } catch {
      // 409 errors handled by request interceptor with Chinese message mapping
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

  const allColumns: AccessibleColumnsType<TenantItem> = [
    {
      title: '诊所名称',
      dataIndex: 'name',
      key: 'name',
      width: 160,
      ellipsis: true,
      render: (val: string, record: TenantItem) => {
        const isDisabled = record.status !== 1;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
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
                flexShrink: 0,
              }}
            />
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
          </span>
        );
      },
    },
    {
      title: '编码',
      dataIndex: 'code',
      key: 'code',
      width: 100,
      ellipsis: true,
      a11yPriority: 2,
    },
    {
      title: '分组',
      dataIndex: 'group_name',
      key: 'group_name',
      width: 100,
      render: (val: string) => (
        <Tag color={val === 'default' || !val ? 'default' : 'purple'}>{val || 'default'}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleOpenModal(record)}
            disabled={!isSuperAdmin}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除此诊所？删除后关联数据将无法访问。"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
            disabled={!isSuperAdmin}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} disabled={!isSuperAdmin}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const { columns, hiddenColumnTitles, hasHiddenColumns, restoreAll } = useAccessibleColumns(allColumns);

  return (
    <Card>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: 16,
        }}
      >
        {isSuperAdmin && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => handleOpenModal()}
          >
            新增诊所
          </Button>
        )}
      </div>

      {isMobile ? (
        loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : data.length === 0 ? (
          <Empty description="暂无诊所记录" />
        ) : (
          <>
            {data.map((record) => {
              const isDisabled = record.status !== 1;
              return (
              <div
                key={record.id}
                id={`tenant-row-${record.id}`}
                className={highlight.isHighlighted(record.id) ? 'row-highlight' : ''}
                style={{
                  background: '#fafafa',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
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
                      flexShrink: 0,
                    }}
                  />
                  <span style={{
                    fontWeight: 600,
                    fontSize: 15,
                    color: isDisabled ? '#ff4d4f' : undefined,
                    opacity: isDisabled ? 0.7 : 1,
                  }}>
                    {record.name}
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
                </div>
                <div style={{ color: '#666', fontSize: 13, marginBottom: 8 }}>
                  编码：{record.code}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button type="link" size="small" style={{ padding: 0 }} icon={<EditOutlined />} onClick={() => handleOpenModal(record)} disabled={!isSuperAdmin}>编辑</Button>
                  <Popconfirm title="确定删除此诊所？" onConfirm={() => handleDelete(record.id)} okText="确定" cancelText="取消" disabled={!isSuperAdmin}>
                    <Button type="link" size="small" style={{ padding: 0 }} danger icon={<DeleteOutlined />} disabled={!isSuperAdmin}>删除</Button>
                  </Popconfirm>
                </div>
              </div>
              );
            })}
            {total > 0 && (
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <Pagination
                  size="small"
                  simple
                  current={params.page}
                  pageSize={params.size}
                  total={total}
                  onChange={(page) => {
                    highlight.setHighlightId(null);
                    setParams({ page, size: params.size });
                  }}
                />
              </div>
            )}
          </>
        )
      ) : (
        <div>
        <Table<TenantItem>
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={loading}
          rowClassName={highlight.rowClassName}
          onRow={highlight.onRow}
          scroll={{ x: 'max-content' }}
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
            emptyText: '暂无诊所记录',
          }}
        />
        {hasHiddenColumns && <HiddenColumnsHint titles={hiddenColumnTitles} onRestoreAll={restoreAll} />}
        </div>
      )}

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
        width={isMobile ? 'calc(100vw - 32px)' : undefined}
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
          <Form.Item
            name="group_name"
            label="所属分组"
            rules={[{ required: true, message: '请输入分组名' }]}
          >
            <AutoComplete
              placeholder="默认 default，输入新名称自动创建分组"
              options={groupOptions}
              onSearch={handleGroupSearch}
              onFocus={() => handleGroupSearch('')}
              filterOption={false}
            />
          </Form.Item>
          {isEdit && (
            <Form.Item name="status" label="状态">
              <Radio.Group>
                <Radio value={1}>启用</Radio>
                <Radio value={0}>禁用</Radio>
              </Radio.Group>
            </Form.Item>
          )}
          {isEdit && editingTenant?.created_at && (
            <div style={{ color: '#999', fontSize: 13, marginTop: -8 }}>
              创建时间：{editingTenant.created_at.slice(0, 19).replace('T', ' ')}
            </div>
          )}
        </Form>
      </Modal>
    </Card>
  );
}
