import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Input,
  DatePicker,
  Button,
  Space,
  Popconfirm,
  message,
  Card,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import { listRecords, deleteRecord } from '../../api/record';
import type { RecordListItem, RecordListParams } from '../../api/record';

const { RangePicker } = DatePicker;

export default function RecordList() {
  const navigate = useNavigate();

  const [data, setData] = useState<RecordListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [params, setParams] = useState<RecordListParams>({
    page: 1,
    size: 20,
  });

  // Search form local state (not submitted until user clicks search)
  const [searchName, setSearchName] = useState('');
  const [searchDateRange, setSearchDateRange] = useState<
    [Dayjs, Dayjs] | null
  >(null);

  const fetchData = useCallback(async (query: RecordListParams) => {
    setLoading(true);
    try {
      const res = await listRecords(query);
      const body = res as unknown as {
        data: {
          list: RecordListItem[];
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
    const newParams: RecordListParams = {
      page: 1,
      size: params.size,
      name: searchName || undefined,
      date: searchDateRange
        ? `${searchDateRange[0].format('YYYY-MM-DD')},${searchDateRange[1].format('YYYY-MM-DD')}`
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
      await deleteRecord(id);
      message.success('删除成功');
      // Refresh current page
      fetchData(params);
    } catch {
      // Error already handled by request interceptor
    }
  };

  const columns: ColumnsType<RecordListItem> = [
    {
      title: '患者姓名',
      dataIndex: 'patient_name',
      key: 'patient_name',
      width: 120,
    },
    {
      title: '年龄',
      dataIndex: 'patient_age',
      key: 'patient_age',
      width: 80,
    },
    {
      title: '就诊日期',
      dataIndex: 'visit_date',
      key: 'visit_date',
      width: 120,
      defaultSortOrder: 'descend',
      sorter: (a, b) =>
        new Date(a.visit_date).getTime() - new Date(b.visit_date).getTime(),
    },
    {
      title: '诊断摘要',
      dataIndex: 'diagnosis',
      key: 'diagnosis',
      ellipsis: true,
      render: (text: string) => {
        if (!text) return '-';
        return text.length > 50 ? `${text.slice(0, 50)}...` : text;
      },
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
            icon={<EyeOutlined />}
            onClick={() => navigate(`/records/${record.id}`)}
          >
            查看
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => navigate(`/records/${record.id}`)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除此诊疗记录？"
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
          justifyContent: 'space-between',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <Space wrap>
          <Input
            placeholder="搜索患者姓名"
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
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => navigate('/records/new')}
        >
          新增诊疗记录
        </Button>
      </div>

      <Table<RecordListItem>
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
            setParams((prev) => ({ ...prev, page, size: pageSize }));
          },
        }}
        locale={{
          emptyText: '暂无诊疗记录',
        }}
      />
    </Card>
  );
}
