import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Table,
  Input,
  DatePicker,
  Button,
  Space,
  Popconfirm,
  message,
  Card,
  Pagination,
  Spin,
  Tag,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  MedicineBoxOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import { listRecords, deleteRecord, findRecordPage } from '../../api/record';
import type { RecordListItem, RecordListParams } from '../../api/record';
import useIsMobile from '../../hooks/useIsMobile';

const { RangePicker } = DatePicker;

export default function RecordList() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const highlightId = (location.state as { highlightId?: number })?.highlightId;
  const highlightedRef = useRef(false);
  const pageResolvedRef = useRef(false);

  const [data, setData] = useState<RecordListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [params, setParams] = useState<RecordListParams>({
    page: 1,
    size: 20,
  });

  // If returning from edit, ask backend which page the record is on and jump there
  useEffect(() => {
    if (!highlightId || pageResolvedRef.current) return;
    pageResolvedRef.current = true;
    findRecordPage(highlightId, 20)
      .then((res) => {
        const body = res as unknown as { data: { page: number } };
        const page = body.data?.page || 1;
        if (page !== 1) {
          setParams(prev => ({ ...prev, page }));
        }
      })
      .catch(() => { /* ignore, stay on page 1 */ });
  }, [highlightId]);

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

  // Scroll to and highlight the row/card after returning from edit
  useEffect(() => {
    if (!highlightId || highlightedRef.current || loading) return;
    let removeTimer: ReturnType<typeof setTimeout>;
    // Wait for DOM update after data render
    const timer = setTimeout(() => {
      // Desktop: table row; Mobile: card with data-record-id
      const el = document.querySelector(`tr[data-row-key="${highlightId}"]`)
        || document.querySelector(`[data-record-id="${highlightId}"]`);
      if (el) {
        highlightedRef.current = true;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('row-highlight');
        removeTimer = setTimeout(() => el.classList.remove('row-highlight'), 15000);
        window.history.replaceState({}, '');
      }
    }, 100);
    return () => {
      clearTimeout(timer);
      clearTimeout(removeTimer);
    };
  }, [highlightId, loading, data]);

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
      width: 160,
    },
    {
      title: '年龄',
      dataIndex: 'patient_age',
      key: 'patient_age',
      width: 80,
      responsive: ['md'],
    },
    {
      title: '就诊日期',
      dataIndex: 'visit_date',
      key: 'visit_date',
      width: 130,
      defaultSortOrder: 'descend',
      sorter: (a, b) =>
        new Date(a.visit_date).getTime() - new Date(b.visit_date).getTime(),
      render: (val: string) => (
        <Tag style={{ background: 'linear-gradient(135deg, #fff7e6, #ffe7ba)', border: 'none', color: '#AD6800' }}>
          <CalendarOutlined style={{ marginRight: 4 }} />{val}
        </Tag>
      ),
    },
    {
      title: '诊断摘要',
      dataIndex: 'diagnosis',
      key: 'diagnosis',
      ellipsis: true,
      responsive: ['md'],
      render: (text: string) => {
        if (!text) return '-';
        return text.length > 50 ? `${text.slice(0, 50)}...` : text;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: isMobile ? 100 : 200,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/records/${record.id}`)}
          >
            {!isMobile && '查看'}
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => navigate(`/records/${record.id}`)}
          >
            {!isMobile && '编辑'}
          </Button>
          <Popconfirm
            title="确定删除此诊疗记录？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              {!isMobile && '删除'}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // --- Mobile record card ---
  const renderMobileRecordCard = (record: RecordListItem) => (
    <div
      key={record.id}
      className="warm-list-card"
      data-record-id={record.id}
      onClick={() => navigate(`/records/${record.id}`)}
    >
      {/* Row 1: patient name + visit date */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 16, color: '#5C4A32' }}>{record.patient_name}</span>
        <Tag style={{ background: 'linear-gradient(135deg, #fff7e6, #ffe7ba)', border: 'none', color: '#AD6800', margin: 0, fontSize: 12 }}>
          <CalendarOutlined style={{ marginRight: 3 }} />{record.visit_date}
        </Tag>
      </div>
      {/* Row 2: diagnosis */}
      <div style={{ fontSize: 13, color: '#8B7355', marginBottom: 8, lineHeight: 1.5 }}>
        {record.diagnosis
          ? (record.diagnosis.length > 60 ? record.diagnosis.slice(0, 60) + '...' : record.diagnosis)
          : <span style={{ color: '#BFB8A8' }}>暂无诊断</span>}
      </div>
      {/* Row 3: actions */}
      <div style={{ display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
        <Button size="small" type="primary" ghost icon={<EyeOutlined />} onClick={() => navigate(`/records/${record.id}`)}>
          查看
        </Button>
        <Popconfirm
          title="确定删除此诊疗记录？"
          onConfirm={() => handleDelete(record.id)}
          okText="确定"
          cancelText="取消"
        >
          <Button size="small" danger icon={<DeleteOutlined />}>
            删除
          </Button>
        </Popconfirm>
      </div>
    </div>
  );

  // --- Empty state ---
  const renderEmpty = () => (
    <div className="warm-empty">
      <div className="warm-empty-icon">
        <MedicineBoxOutlined style={{ color: '#D4B896' }} />
      </div>
      <div className="warm-empty-text">暂无诊疗记录</div>
      <div className="warm-empty-sub">点击「新增诊疗记录」开始记录</div>
    </div>
  );

  return (
    <Card
      className="warm-card"
      styles={isMobile ? { body: { padding: 12 } } : undefined}
    >
      {/* Search bar */}
      {isMobile ? (
        <div className="warm-search-bar" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <Input
              placeholder="搜索患者姓名"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              onPressEnter={handleSearch}
              allowClear
              style={{ flex: 1 }}
            />
            <Button type="primary" className="warm-btn-primary" icon={<SearchOutlined />} onClick={handleSearch}>
              搜索
            </Button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <RangePicker
              value={searchDateRange}
              onChange={(dates) => {
                if (dates && dates[0] && dates[1]) {
                  setSearchDateRange([dates[0], dates[1]]);
                } else {
                  setSearchDateRange(null);
                }
              }}
              style={{ flex: 1 }}
              size="small"
            />
            <Button size="small" onClick={handleReset}>重置</Button>
          </div>
          <div style={{ marginTop: 8 }}>
            <Button type="primary" className="warm-btn-primary" icon={<PlusOutlined />} onClick={() => navigate('/records/new')} block>
              新增诊疗记录
            </Button>
          </div>
        </div>
      ) : (
        <div className="warm-search-bar">
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
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
              <Button type="primary" className="warm-btn-primary" icon={<SearchOutlined />} onClick={handleSearch}>
                搜索
              </Button>
              <Button onClick={handleReset}>重置</Button>
            </Space>
            <Button
              type="primary"
              className="warm-btn-primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/records/new')}
            >
              新增诊疗记录
            </Button>
          </div>
        </div>
      )}

      {/* Record list */}
      {isMobile ? (
        <>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : data.length === 0 ? (
            renderEmpty()
          ) : (
            data.map(renderMobileRecordCard)
          )}
          {total > 0 && (
            <div style={{ textAlign: 'center', paddingTop: 12 }}>
              <Pagination
                current={params.page}
                pageSize={params.size}
                total={total}
                size="small"
                simple
                onChange={(page, pageSize) => {
                  setParams(prev => ({ ...prev, page, size: pageSize }));
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </div>
          )}
        </>
      ) : (
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
            emptyText: renderEmpty(),
          }}
        />
      )}
    </Card>
  );
}
