import { useState } from 'react';
import { Input, Table, Tag, message, Button, Popconfirm } from 'antd';
import { SearchOutlined, RobotOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { listHerbs, deleteHerb } from '../../api/herb';
import type { HerbItem } from '../../api/herb';
import { useAuth } from '../../store/auth';

export default function HerbSearch() {
  const [herbs, setHerbs] = useState<HerbItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [searchName, setSearchName] = useState('');
  const { hasPermission } = useAuth();

  const fetchHerbs = async (name: string, p: number, s: number) => {
    setLoading(true);
    try {
      const res = await listHerbs({ name, page: p, size: s });
      const body = res as unknown as {
        data: { list: HerbItem[]; total: number };
      };
      setHerbs(body.data.list || []);
      setTotal(body.data.total || 0);
    } catch {
      message.error('查询中药失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearchName(value);
    setPage(1);
    fetchHerbs(value, 1, size);
  };

  const handleTableChange = (pagination: { current?: number; pageSize?: number }) => {
    const newPage = pagination.current || 1;
    const newSize = pagination.pageSize || 20;
    setPage(newPage);
    setSize(newSize);
    fetchHerbs(searchName, newPage, newSize);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteHerb(id);
      message.success('删除成功');
      fetchHerbs(searchName, page, size);
    } catch {
      // Error handled by interceptor
    }
  };

  const columns: ColumnsType<HerbItem> = [
    {
      title: '药名',
      dataIndex: 'name',
      key: 'name',
      width: 120,
    },
    {
      title: '别名',
      dataIndex: 'alias',
      key: 'alias',
      width: 200,
      ellipsis: true,
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 100,
    },
    {
      title: '性味归经',
      dataIndex: 'properties',
      key: 'properties',
      width: 200,
      ellipsis: true,
    },
    {
      title: '功效',
      dataIndex: 'effects',
      key: 'effects',
      ellipsis: true,
    },
    {
      title: '主治',
      dataIndex: 'indications',
      key: 'indications',
      ellipsis: true,
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 100,
      render: (source: string) =>
        source === 'deepseek' ? (
          <Tag icon={<RobotOutlined />} color="blue">
            AI
          </Tag>
        ) : (
          <Tag color="green">本地</Tag>
        ),
    },
    ...(hasPermission('role:manage')
      ? [
          {
            title: '操作',
            key: 'action',
            width: 80,
            render: (_: unknown, record: HerbItem) => (
              <Popconfirm
                title="确定删除此中药？"
                onConfirm={() => handleDelete(record.id)}
                okText="删除"
                cancelText="取消"
              >
                <Button type="text" danger size="small" icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="输入中药名称搜索（支持AI查询）"
          allowClear
          enterButton={<><SearchOutlined /> 搜索</>}
          size="large"
          onSearch={handleSearch}
          style={{ maxWidth: 500 }}
        />
      </div>

      <Table<HerbItem>
        columns={columns}
        dataSource={herbs}
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
              <p><strong>别名：</strong>{record.alias || '无'}</p>
              <p><strong>性味归经：</strong>{record.properties || '无'}</p>
              <p><strong>功效：</strong>{record.effects || '无'}</p>
              <p><strong>主治：</strong>{record.indications || '无'}</p>
              {record.source === 'deepseek' && (
                <Tag icon={<RobotOutlined />} color="blue">
                  数据来源：DeepSeek AI（仅供参考，请结合临床经验）
                </Tag>
              )}
            </div>
          ),
        }}
      />
    </div>
  );
}
