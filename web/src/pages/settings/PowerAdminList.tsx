import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Table, Button, Space, Popconfirm, message, Card,
  Modal, Form, Select, Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  listPowerAdmins, deletePowerAdmin,
  assignPowerAdminGroups, listAllGroups, type PowerAdminItem,
} from '../../api/powerAdmin';

export default function PowerAdminList() {
  const [data, setData] = useState<PowerAdminItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [allGroups, setAllGroups] = useState<string[]>([]);

  // Assign groups modal
  const [assignVisible, setAssignVisible] = useState(false);
  const [assignTarget, setAssignTarget] = useState<PowerAdminItem | null>(null);
  const [assignForm] = Form.useForm();
  const [assignLoading, setAssignLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listPowerAdmins();
      const body = res as unknown as { code: number; data: PowerAdminItem[] };
      setData(body.data || []);
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await listAllGroups();
      const body = res as unknown as { code: number; data: string[] };
      setAllGroups(body.data || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchData();
    fetchGroups();
  }, [fetchData, fetchGroups]);

  const handleDelete = async (userId: number) => {
    try {
      await deletePowerAdmin(userId);
      message.success('已撤销超级管理员权限');
      fetchData();
    } catch { /* handled */ }
  };

  const openAssign = (record: PowerAdminItem) => {
    setAssignTarget(record);
    assignForm.setFieldsValue({ groups: record.groups });
    setAssignVisible(true);
  };

  const handleAssign = async () => {
    if (!assignTarget) return;
    try {
      const values = await assignForm.validateFields();
      setAssignLoading(true);
      await assignPowerAdminGroups(assignTarget.user_id, values.groups || []);
      message.success('分配成功');
      setAssignVisible(false);
      fetchData();
    } catch { /* validation or API error */ } finally {
      setAssignLoading(false);
    }
  };

  const columns = useMemo<ColumnsType<PowerAdminItem>>(() => [
    {
      title: '用户名 / 姓名',
      key: 'user',
      render: (_, record) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
              background: record.status === 1 ? '#52c41a' : '#ff4d4f',
              flexShrink: 0,
            }}
          />
          <span>
            <strong style={{ color: record.status !== 1 ? '#ff4d4f' : undefined }}>
              {record.username}
            </strong>
            <span style={{ color: '#999', fontSize: 12, marginLeft: 5 }}>
              {record.real_name}
            </span>
          </span>
        </span>
      ),
    },
    {
      title: '授权分组',
      key: 'groups',
      render: (_, record) => (
        record.groups.length === 0
          ? <Tag color="default">暂未分配</Tag>
          : record.groups.map(g => <Tag key={g} color="purple">{g}</Tag>)
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_, record) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => openAssign(record)}>
            分配分组
          </Button>
          <Popconfirm
            title="确定撤销此用户的超级管理员权限？"
            onConfirm={() => handleDelete(record.user_id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [allGroups]);

  return (
    <Card title="超级管理员管理">
      <Table
        rowKey="user_id"
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={false}
      />

      {/* Assign Groups Modal */}
      <Modal
        title={`分配分组 — ${assignTarget?.real_name}（${assignTarget?.username}）`}
        open={assignVisible}
        onOk={handleAssign}
        onCancel={() => { setAssignVisible(false); assignForm.resetFields(); }}
        confirmLoading={assignLoading}
        width={520}
        destroyOnClose
      >
        {assignTarget && (
          <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 6, padding: '8px 14px', marginBottom: 18, fontSize: 13, color: '#666' }}>
            创建时间：<strong style={{ color: '#333' }}>{assignTarget.created_at}</strong>
          </div>
        )}
        <Form form={assignForm} layout="vertical">
          <Form.Item name="groups" label="授权分组">
            <Select
              mode="multiple"
              placeholder="选择授权分组"
              options={allGroups.map(g => ({ value: g, label: g }))}
              allowClear
            />
          </Form.Item>
          <div style={{ fontSize: 12, color: '#1677ff' }}>
            修改授权后，该用户下次操作时将自动刷新 Token，无需重新登录。
          </div>
        </Form>
      </Modal>
    </Card>
  );
}
