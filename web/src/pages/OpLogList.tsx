import { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Input,
  DatePicker,
  Button,
  Space,
  Card,
  Tag,
  Popconfirm,
  message,
} from 'antd';
import { SearchOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import { listOpLogs, deleteOpLog, batchDeleteOpLogs } from '../api/oplog';
import type { OpLogItem, OpLogListParams } from '../api/oplog';
import { useAuth } from '../store/auth';

const { RangePicker } = DatePicker;

const ACTION_MAP: Record<string, { label: string; color: string }> = {
  create: { label: '新增', color: 'green' },
  update: { label: '修改', color: 'blue' },
  delete: { label: '删除', color: 'red' },
};

const RESOURCE_TYPE_MAP: Record<string, string> = {
  patient: '患者',
  record: '诊疗记录',
  medical_record: '诊疗记录',
  attachment: '附件',
  prescription: '处方',
  user: '用户',
};

export default function OpLogList() {
  const [data, setData] = useState<OpLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [params, setParams] = useState<OpLogListParams>({
    page: 1,
    size: 20,
  });
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const { hasPermission } = useAuth();
  const canDelete = hasPermission('role:manage');

  // Search form local state
  const [searchName, setSearchName] = useState('');
  const [searchDateRange, setSearchDateRange] = useState<
    [Dayjs, Dayjs] | null
  >(null);

  const fetchData = useCallback(async (query: OpLogListParams) => {
    setLoading(true);
    try {
      const res = await listOpLogs(query);
      const body = res as unknown as {
        data: {
          list: OpLogItem[];
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

  const handleSearch = () => {
    const newParams: OpLogListParams = {
      page: 1,
      size: params.size,
      name: searchName || undefined,
      start_date: searchDateRange
        ? searchDateRange[0].format('YYYY-MM-DD')
        : undefined,
      end_date: searchDateRange
        ? searchDateRange[1].format('YYYY-MM-DD')
        : undefined,
    };
    setParams(newParams);
  };

  const handleReset = () => {
    setSearchName('');
    setSearchDateRange(null);
    setParams({ page: 1, size: 20 });
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteOpLog(id);
      message.success('删除成功');
      setSelectedRowKeys((prev) => prev.filter((k) => k !== id));
      fetchData(params);
    } catch {
      // Error handled by interceptor
    }
  };

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return;
    try {
      await batchDeleteOpLogs(selectedRowKeys as number[]);
      message.success(`成功删除 ${selectedRowKeys.length} 条记录`);
      setSelectedRowKeys([]);
      fetchData(params);
    } catch {
      // Error handled by interceptor
    }
  };

  const columns: ColumnsType<OpLogItem> = [
    {
      title: '操作时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
    },
    {
      title: '操作人',
      dataIndex: 'user_name',
      key: 'user_name',
      width: 120,
    },
    {
      title: '操作类型',
      dataIndex: 'action',
      key: 'action',
      width: 100,
      render: (action: string) => {
        const item = ACTION_MAP[action];
        if (!item) return action;
        return <Tag color={item.color}>{item.label}</Tag>;
      },
    },
    {
      title: '资源类型',
      dataIndex: 'resource_type',
      key: 'resource_type',
      width: 120,
      render: (type: string) => RESOURCE_TYPE_MAP[type] || type,
    },
    {
      title: '资源ID',
      dataIndex: 'resource_id',
      key: 'resource_id',
      width: 100,
    },
    ...(canDelete
      ? [
          {
            title: '操作',
            key: 'action_col',
            width: 80,
            render: (_: unknown, record: OpLogItem) => (
              <Popconfirm
                title="确定删除此日志？"
                onConfirm={() => handleDelete(record.id)}
                okText="删除"
                cancelText="取消"
              >
                <Button type="text" danger size="small" icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            ),
          } as ColumnsType<OpLogItem>[number],
        ]
      : []),
  ];

  const renderDiff = (record: OpLogItem) => (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 300 }}>
        <div style={{ fontWeight: 'bold', marginBottom: 8 }}>变更前</div>
        <pre
          style={{
            backgroundColor: '#fff1f0',
            border: '1px solid #ffa39e',
            borderRadius: 4,
            padding: 12,
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: 400,
            overflow: 'auto',
            fontSize: 13,
          }}
        >
          {record.old_data
            ? JSON.stringify(record.old_data, null, 2)
            : '(无)'}
        </pre>
      </div>
      <div style={{ flex: 1, minWidth: 300 }}>
        <div style={{ fontWeight: 'bold', marginBottom: 8 }}>变更后</div>
        <pre
          style={{
            backgroundColor: '#f6ffed',
            border: '1px solid #b7eb8f',
            borderRadius: 4,
            padding: 12,
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: 400,
            overflow: 'auto',
            fontSize: 13,
          }}
        >
          {record.new_data
            ? JSON.stringify(record.new_data, null, 2)
            : '(无)'}
        </pre>
      </div>
    </div>
  );

  return (
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
            placeholder="操作人姓名"
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 200 }}
            allowClear
          />
          <RangePicker
            value={searchDateRange}
            onChange={(dates) => {
              if (dates && dates[0] && dates[1]) {
                setSearchDateRange([dates[0], dates[1]]);
              } else {
                setSearchDateRange(null);
              }
            }}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
            搜索
          </Button>
          <Button onClick={handleReset}>重置</Button>
        </Space>
        {canDelete && selectedRowKeys.length > 0 && (
          <Popconfirm
            title={`确定删除选中的 ${selectedRowKeys.length} 条日志？`}
            onConfirm={handleBatchDelete}
            okText="删除"
            cancelText="取消"
          >
            <Button danger icon={<DeleteOutlined />}>
              批量删除 ({selectedRowKeys.length})
            </Button>
          </Popconfirm>
        )}
      </div>

      <Table<OpLogItem>
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        rowSelection={
          canDelete
            ? {
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys),
              }
            : undefined
        }
        expandable={{
          expandedRowRender: renderDiff,
        }}
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
        locale={{
          emptyText: '暂无操作日志',
        }}
      />
    </Card>
  );
}
