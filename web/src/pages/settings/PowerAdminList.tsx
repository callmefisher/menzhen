import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Table, Button, Space, Popconfirm, message, Card,
  Modal, Form, Select, Input,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  listPowerAdmins, deletePowerAdmin,
  assignPowerAdminGroups, listAllGroups,
  type PowerAdminItem, type GroupInfo,
} from '../../api/powerAdmin';
import { listUsers } from '../../api/user';

// Static style objects at module scope (not recreated on every render)
const panelCol: React.CSSProperties = { display: 'flex', flexDirection: 'column' };
const panelHeader: React.CSSProperties = {
  background: '#fafafa', padding: '10px 12px', fontSize: 12, color: '#666',
  borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
};
const panelList: React.CSSProperties = { flex: 1, overflowY: 'auto', maxHeight: 260 };
const panelRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '9px 12px',
  fontSize: 13, borderBottom: '1px solid #fafafa', cursor: 'pointer',
};

interface UserOption {
  value: number;
  label: string;
  username: string;
  real_name: string;
}

export default function PowerAdminList() {
  const [data, setData] = useState<PowerAdminItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [allGroups, setAllGroups] = useState<GroupInfo[]>([]);

  // Add modal
  const [addVisible, setAddVisible] = useState(false);
  const [addForm] = Form.useForm();
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [userOptionsLoading, setUserOptionsLoading] = useState(false);

  // Assign panel modal
  const [assignVisible, setAssignVisible] = useState(false);
  const [assignTarget, setAssignTarget] = useState<PowerAdminItem | null>(null);
  const [isNewAdmin, setIsNewAdmin] = useState(false);
  const [leftGroups, setLeftGroups] = useState<GroupInfo[]>([]);
  const [rightGroups, setRightGroups] = useState<GroupInfo[]>([]);
  const [leftSearch, setLeftSearch] = useState('');
  const [rightSearch, setRightSearch] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listPowerAdmins();
      const body = res as unknown as { code: number; data: PowerAdminItem[] };
      setData(body.data || []);
    } catch { /* handled by interceptor */ } finally {
      setLoading(false);
    }
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await listAllGroups();
      const body = res as unknown as { code: number; data: GroupInfo[] };
      setAllGroups(body.data || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchData();
    fetchGroups();
  }, [fetchData, fetchGroups]);

  const handleDelete = useCallback(async (userId: number) => {
    try {
      await deletePowerAdmin(userId);
      message.success('已撤销超级管理员权限');
      fetchData();
    } catch { /* handled */ }
  }, [fetchData]);

  const openAssign = useCallback((record: PowerAdminItem, isNew = false) => {
    setAssignTarget(record);
    setIsNewAdmin(isNew);
    const selectedNames = new Set(record.groups);
    setRightGroups(allGroups.filter(g => selectedNames.has(g.name)));
    setLeftGroups(allGroups.filter(g => !selectedNames.has(g.name)));
    setLeftSearch('');
    setRightSearch('');
    setAssignVisible(true);
  }, [allGroups]);

  const moveToRight = (group: GroupInfo) => {
    setLeftGroups(prev => prev.filter(g => g.name !== group.name));
    setRightGroups(prev => [...prev, group]);
  };

  const moveToLeft = (group: GroupInfo) => {
    setRightGroups(prev => prev.filter(g => g.name !== group.name));
    setLeftGroups(prev => [...prev, group]);
  };

  const handleAssign = async () => {
    if (!assignTarget) return;
    if (isNewAdmin && rightGroups.length === 0) {
      message.warning('请至少选择一个分组');
      return;
    }
    setAssignLoading(true);
    try {
      await assignPowerAdminGroups(assignTarget.user_id, rightGroups.map(g => g.name));
      message.success('分配成功');
      setAssignVisible(false);
      fetchData();
    } catch { /* handled */ } finally {
      setAssignLoading(false);
    }
  };

  const fetchUserOptions = useCallback(async () => {
    if (userOptionsLoading || userOptions.length > 0) return;
    setUserOptionsLoading(true);
    try {
      const res = await listUsers({ page: 1, size: 200 });
      const body = res as unknown as { code: number; data: { list: Array<{ id: number; username: string; real_name: string }> } };
      const existingIds = new Set(data.map(d => d.user_id));
      setUserOptions((body.data?.list || [])
        .filter(u => !existingIds.has(u.id))
        .map(u => ({
          value: u.id,
          label: u.real_name ? `${u.username}（${u.real_name}）` : u.username,
          username: u.username,
          real_name: u.real_name,
        })));
    } catch { /* ignore */ } finally {
      setUserOptionsLoading(false);
    }
  }, [data, userOptions.length, userOptionsLoading]);

  const handleAddOpen = () => {
    addForm.resetFields();
    setUserOptions([]); // Reset so list refreshes for new selection
    setAddVisible(true);
  };

  const handleAddSubmit = async () => {
    try {
      const values = await addForm.validateFields();
      const selected = userOptions.find(u => u.value === values.user_id);
      setAddVisible(false);
      addForm.resetFields();
      openAssign({
        user_id: values.user_id,
        username: selected?.username ?? String(values.user_id),
        real_name: selected?.real_name ?? '',
        status: 1,
        groups: [],
        created_at: '',
      }, true);
    } catch { /* validation */ }
  };

  const filteredLeft = leftGroups.filter(g =>
    g.name.toLowerCase().includes(leftSearch.toLowerCase())
  );
  const filteredRight = rightGroups.filter(g =>
    g.name.toLowerCase().includes(rightSearch.toLowerCase())
  );
  const totalRight = rightGroups.reduce((s, g) => s + g.count, 0);

  const columns = useMemo<ColumnsType<PowerAdminItem>>(() => [
    {
      title: '用户名 / 姓名',
      key: 'user',
      render: (_, record) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
            background: record.status === 1 ? '#52c41a' : '#ff4d4f',
            boxShadow: record.status === 1 ? '0 0 0 3px rgba(82,196,26,.15)' : '0 0 0 3px rgba(255,77,79,.12)',
            flexShrink: 0,
          }} />
          <span>
            <strong style={{ color: record.status !== 1 ? '#ff4d4f' : undefined }}>{record.username}</strong>
            <span style={{ color: '#999', fontSize: 12, marginLeft: 5 }}>{record.real_name}</span>
            {record.status !== 1 && (
              <span style={{ fontSize: 11, color: '#ff4d4f', background: '#fff2f0', padding: '0 5px', borderRadius: 3, marginLeft: 4 }}>已禁用</span>
            )}
          </span>
        </span>
      ),
    },
    {
      title: '授权分组',
      key: 'groups',
      render: (_, record) => {
        if (record.groups.length === 0) {
          return <span style={{ color: '#999', fontSize: 13 }}>暂未分配</span>;
        }
        const totalCount = record.groups.reduce((sum, g) => {
          return sum + (allGroups.find(ag => ag.name === g)?.count ?? 0);
        }, 0);
        return (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
            onClick={() => openAssign(record)}
          >
            <span style={{
              background: '#f9f0ff', color: '#722ed1', border: '1px solid #d3adf7',
              borderRadius: 10, padding: '1px 10px', fontSize: 12, fontWeight: 500,
            }}>
              {record.groups.length} 个分组 · {totalCount} 家
            </span>
            <span style={{ fontSize: 12, color: '#999' }}>点击查看</span>
          </span>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_, record) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => openAssign(record)}>⊞ 分配分组</Button>
          <span style={{ color: '#e8e8e8' }}>|</span>
          <Popconfirm
            title="确定撤销此用户的超级管理员权限？"
            onConfirm={() => handleDelete(record.user_id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger>✕ 删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ], [allGroups, openAssign, handleDelete]);

  const assignTitle = assignTarget
    ? assignTarget.real_name
      ? `分配分组 — ${assignTarget.real_name}（${assignTarget.username}）`
      : `分配分组 — ${assignTarget.username}`
    : '分配分组';

  return (
    <Card
      title="超级管理员管理"
      extra={
        <Button type="primary" size="small" onClick={handleAddOpen}>
          ＋ 新增管理员
        </Button>
      }
    >
      <Table
        rowKey="user_id"
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={false}
      />

      {/* Add Modal — pick user only, then opens assign panel */}
      <Modal
        title="新增超级管理员"
        open={addVisible}
        onOk={handleAddSubmit}
        onCancel={() => { setAddVisible(false); addForm.resetFields(); }}
        width={480}
        destroyOnClose
      >
        <Form form={addForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="user_id"
            label="选择用户账号"
            rules={[{ required: true, message: '请选择用户' }]}
          >
            <Select
              showSearch
              placeholder="搜索用户名或姓名"
              loading={userOptionsLoading}
              options={userOptions}
              filterOption={(input, option) =>
                (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
              }
              onFocus={fetchUserOptions}
              allowClear
            />
          </Form.Item>
          <div style={{ fontSize: 12, color: '#999' }}>选择后将进入分组分配步骤</div>
        </Form>
      </Modal>

      {/* Assign Groups Modal — Transfer panel */}
      <Modal
        title={assignTitle}
        open={assignVisible}
        onOk={handleAssign}
        onCancel={() => setAssignVisible(false)}
        confirmLoading={assignLoading}
        okText="保存"
        width={680}
        destroyOnClose
      >
        {assignTarget?.created_at && (
          <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 6, padding: '8px 14px', marginBottom: 16, fontSize: 13, color: '#666', display: 'flex', alignItems: 'center', gap: 6 }}>
            创建时间：<strong style={{ color: '#333' }}>{assignTarget.created_at}</strong>
          </div>
        )}

        {/* Transfer panel */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 36px 1fr', border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
          {/* Left: available */}
          <div style={panelCol}>
            <div style={panelHeader}>
              <span>可选分组</span>
              <span
                style={{ color: '#1677ff', cursor: 'pointer' }}
                onClick={() => { setRightGroups(prev => [...prev, ...leftGroups]); setLeftGroups([]); }}
              >全选</span>
            </div>
            <div style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0' }}>
              <Input size="small" placeholder="搜索分组名…" value={leftSearch} onChange={e => setLeftSearch(e.target.value)} />
            </div>
            <div style={panelList}>
              {filteredLeft.map(g => (
                <div
                  key={g.name} style={panelRow}
                  onClick={() => moveToRight(g)}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f0f7ff')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <span style={{ flex: 1, fontWeight: 500 }}>{g.name}</span>
                  <span style={{ fontSize: 12, color: '#999' }}>{g.count} 家</span>
                </div>
              ))}
              {filteredLeft.length === 0 && (
                <div style={{ padding: 16, textAlign: 'center', color: '#999', fontSize: 13 }}>无可选分组</div>
              )}
            </div>
          </div>

          {/* Arrows: › moves all left→right, ‹ moves all right→left */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: '#fafafa', borderLeft: '1px solid #f0f0f0', borderRight: '1px solid #f0f0f0' }}>
            <div
              style={{ width: 28, height: 28, border: '1px solid #d9d9d9', borderRadius: 4, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#666' }}
              title="全部添加"
              onClick={() => { setRightGroups(prev => [...prev, ...leftGroups]); setLeftGroups([]); }}
            >›</div>
            <div
              style={{ width: 28, height: 28, border: '1px solid #d9d9d9', borderRadius: 4, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#666' }}
              title="全部移除"
              onClick={() => { setLeftGroups(prev => [...prev, ...rightGroups]); setRightGroups([]); }}
            >‹</div>
          </div>

          {/* Right: selected */}
          <div style={panelCol}>
            <div style={panelHeader}>
              <span>已授权分组</span>
              <span style={{ color: '#722ed1' }}>已选 {rightGroups.length} 组 · {totalRight} 家</span>
            </div>
            <div style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0' }}>
              <Input size="small" placeholder="搜索已选…" value={rightSearch} onChange={e => setRightSearch(e.target.value)} />
            </div>
            <div style={panelList}>
              {filteredRight.map(g => (
                <div key={g.name} style={{ ...panelRow, cursor: 'default' }}>
                  <span style={{ flex: 1, fontWeight: 500 }}>{g.name}</span>
                  <span style={{ fontSize: 12, color: '#999', marginRight: 8 }}>{g.count} 家</span>
                  <span
                    style={{ color: '#ff4d4f', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                    onClick={() => moveToLeft(g)}
                  >×</span>
                </div>
              ))}
              {filteredRight.length === 0 && (
                <div style={{ padding: 16, textAlign: 'center', color: '#999', fontSize: 13 }}>
                  {rightGroups.length === 0 ? '暂未选择分组' : '无匹配结果'}
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ fontSize: 12, color: '#1677ff', marginTop: 10 }}>
          ℹ 修改授权后，该用户下次操作时将自动刷新 Token，无需重新登录。
        </div>
      </Modal>
    </Card>
  );
}
