import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Table,
  Input,
  Button,
  Space,
  Popconfirm,
  message,
  Card,
  Tag,
  Pagination,
  Spin,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  PhoneOutlined,
  ManOutlined,
  WomanOutlined,
  TeamOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import { listPatients, deletePatient, findPatientPage } from '../../api/patient';
import { callNumber } from '../../api/queue';
import { PatientFormModal } from './PatientForm';
import useIsMobile from '../../hooks/useIsMobile';
import useRowHighlight from '../../hooks/useRowHighlight';
import { useAccessibleColumns, type AccessibleColumnsType } from '../../hooks/useAccessibleColumns';
import HiddenColumnsHint from '../../components/HiddenColumnsHint';
import QueueStrip, { useQueueStatusMap, type QueueStatusInfo } from '../../components/QueueStrip';
import { useWebSocket } from '../../hooks/useWebSocket';

interface PatientItem {
  id: number;
  name: string;
  gender: number;
  age: number;
  birthday: string;
  weight: number;
  phone: string;
  id_card: string;
  address: string;
  native_place: string;
  notes: string;
  created_at: string;
}

interface ListParams {
  name?: string;
  page: number;
  size: number;
}

export default function PatientList() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();

  const [data, setData] = useState<PatientItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [params, setParams] = useState<ListParams>({ page: 1, size: 20 });

  // Search local state
  const [searchName, setSearchName] = useState('');

  // Edit modal state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingPatient, setEditingPatient] = useState<PatientItem | null>(null);

  // Queue status map for row highlighting
  const queueStatusMap = useQueueStatusMap();

  const handleQueueCall = async (info: QueueStatusInfo) => {
    try {
      await callNumber(info.entryId);
    } catch {
      message.error('叫号失败');
    }
  };

  const highlight = useRowHighlight({
    data,
    page: params.page,
    pageSize: params.size,
    loading,
    onPageChange: (page) => setParams(prev => ({ ...prev, page })),
    findPage: findPatientPage,
    idPrefix: 'patient',
  });

  // Handle highlight from navigation state (detail page return or standalone form)
  useEffect(() => {
    const state = location.state as { highlightPatientId?: number } | null;
    if (state?.highlightPatientId) {
      highlight.setHighlightId(state.highlightPatientId);
      // Clear state to prevent re-highlight on re-render
      window.history.replaceState({}, '');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = useCallback(async (query: ListParams) => {
    setLoading(true);
    try {
      const res = await listPatients({
        name: query.name,
        page: query.page,
        size: query.size,
      });
      const body = res as unknown as {
        data: {
          list: PatientItem[];
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

  // Auto-refresh when a patient is auto-created via queue take-number
  const paramsRef = useRef(params);
  paramsRef.current = params;
  useWebSocket('patient_created', useCallback(() => {
    fetchData(paramsRef.current);
  }, [fetchData]));

  const handleSearch = () => {
    setParams({
      page: 1,
      size: params.size,
      name: searchName || undefined,
    });
  };

  const handleReset = () => {
    setSearchName('');
    setParams({ page: 1, size: 20 });
  };

  const handleDelete = async (id: number) => {
    try {
      await deletePatient(id);
      message.success('删除成功');
      fetchData(params);
    } catch {
      // Error already handled by request interceptor
    }
  };

  const handleEdit = (record: PatientItem) => {
    setEditingPatient(record);
    setEditModalVisible(true);
  };

  const handleEditSuccess = (id: number) => {
    fetchData(params);
    highlight.setHighlightId(id);
  };

  const allColumns: AccessibleColumnsType<PatientItem> = [
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
      width: 160,
      render: (name: string) => {
        const info = queueStatusMap.get(name);
        if (!info) return name;
        const callBtn = (
          <Button
            type="link"
            size="small"
            icon={<SoundOutlined />}
            onClick={(e) => { e.stopPropagation(); handleQueueCall(info); }}
            style={{ fontSize: 11, padding: '0 4px', marginLeft: 2 }}
          />
        );
        if (info.status === 'seeing') {
          return (
            <span>
              <b>{name}</b>{' '}
              <Tag color="success" style={{ fontSize: 10, marginLeft: 4, padding: '0 6px', lineHeight: '18px', borderRadius: 3 }}>就诊中</Tag>
              {callBtn}
            </span>
          );
        }
        if (info.status === 'ready') {
          return (
            <span>
              <b>{name}</b>{' '}
              <Tag color="warning" style={{ fontSize: 10, marginLeft: 4, padding: '0 6px', lineHeight: '18px', borderRadius: 3 }}>请准备</Tag>
              {callBtn}
            </span>
          );
        }
        if (info.status === 'waiting') {
          return (
            <span>
              <b>{name}</b>{' '}
              <Tag color="processing" style={{ fontSize: 10, marginLeft: 4, padding: '0 6px', lineHeight: '18px', borderRadius: 3 }}>候诊</Tag>
              {callBtn}
            </span>
          );
        }
        return name;
      },
    },
    {
      title: '性别',
      dataIndex: 'gender',
      key: 'gender',
      width: 80,
      render: (val: number) =>
        val === 1 ? <Tag className="warm-tag-male"><ManOutlined /> 男</Tag>
        : val === 2 ? <Tag className="warm-tag-female"><WomanOutlined /> 女</Tag>
        : '-',
    },
    {
      title: '年龄',
      dataIndex: 'age',
      key: 'age',
      width: 80,
    },
    {
      title: '联系电话',
      dataIndex: 'phone',
      key: 'phone',
      width: 140,
      responsive: ['md'],
      render: (val: string) => val || '-',
    },
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      width: 150,
      ellipsis: true,
      responsive: ['md'],
      a11yPriority: 1,
      render: (val: string) => val || '-',
    },
    {
      title: '操作',
      key: 'action',
      width: isMobile ? 120 : 200,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/patients/${record.id}`)}
          >
            {!isMobile && '查看'}
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            {!isMobile && '编辑'}
          </Button>
          <Popconfirm
            title="确定删除此患者？"
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

  const { columns, hiddenColumnTitles, hasHiddenColumns, restoreAll } = useAccessibleColumns(allColumns);

  // --- Mobile patient card ---
  const renderMobilePatientCard = (patient: PatientItem) => {
    const genderIcon = patient.gender === 1
      ? <ManOutlined style={{ color: '#69B1FF' }} />
      : patient.gender === 2
      ? <WomanOutlined style={{ color: '#FF85C0' }} />
      : null;
    const queueInfo = queueStatusMap.get(patient.name);
    const queueStatus = queueInfo?.status;
    const cardExtraClass = queueStatus === 'seeing' ? ' queue-card-seeing' : queueStatus === 'ready' ? ' queue-card-ready' : '';
    return (
      <div
        key={patient.id}
        id={`patient-row-${patient.id}`}
        className={`warm-list-card${highlight.isHighlighted(patient.id) ? ' row-highlight' : ''}${cardExtraClass}`}
        onClick={() => navigate(`/patients/${patient.id}`)}
      >
        {/* Row 1: name + gender/age */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 16, color: '#5C4A32' }}>{patient.name}</span>
            {queueStatus === 'seeing' && <Tag color="success" style={{ fontSize: 10, margin: 0, padding: '0 6px', lineHeight: '18px', borderRadius: 3 }}>就诊中</Tag>}
            {queueStatus === 'ready' && <Tag color="warning" style={{ fontSize: 10, margin: 0, padding: '0 6px', lineHeight: '18px', borderRadius: 3 }}>请准备</Tag>}
            {queueStatus === 'waiting' && <Tag color="processing" style={{ fontSize: 10, margin: 0, padding: '0 6px', lineHeight: '18px', borderRadius: 3 }}>候诊</Tag>}
            {queueInfo && (
              <Button
                type="link"
                size="small"
                icon={<SoundOutlined />}
                onClick={(e) => { e.stopPropagation(); handleQueueCall(queueInfo); }}
                style={{ fontSize: 12, padding: '0 4px' }}
              />
            )}
            {genderIcon}
            <Tag className={patient.gender === 1 ? 'warm-tag-male' : patient.gender === 2 ? 'warm-tag-female' : ''} style={{ margin: 0 }}>
              {patient.age}岁
            </Tag>
          </div>
          {patient.phone && (
            <span style={{ fontSize: 12, color: '#8B7355' }}>
              <PhoneOutlined style={{ marginRight: 3 }} />{patient.phone}
            </span>
          )}
        </div>
        {/* Row 2: extra info */}
        <div style={{ fontSize: 13, color: '#8B7355', marginBottom: 8, lineHeight: 1.5 }}>
          {patient.address && <span>{patient.address}</span>}
          {patient.address && patient.notes && <span> · </span>}
          {patient.notes && <span>{patient.notes.length > 20 ? patient.notes.slice(0, 20) + '...' : patient.notes}</span>}
          {!patient.address && !patient.notes && <span style={{ color: '#BFB8A8' }}>暂无备注</span>}
        </div>
        {/* Row 3: actions */}
        <div style={{ display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
          <Button size="small" type="primary" ghost icon={<EyeOutlined />} onClick={() => navigate(`/patients/${patient.id}`)}>
            查看
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(patient)}>
            编辑
          </Button>
          <Popconfirm
            title="确定删除此患者？"
            onConfirm={() => handleDelete(patient.id)}
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
  };

  // --- Empty state ---
  const renderEmpty = () => (
    <div className="warm-empty">
      <div className="warm-empty-icon">
        <TeamOutlined style={{ color: '#D4B896' }} />
      </div>
      <div className="warm-empty-text">暂无患者记录</div>
      <div className="warm-empty-sub">点击「新增」添加第一位患者</div>
    </div>
  );

  // Combined row className for highlight + queue status
  const combinedRowClassName = (record: PatientItem) => {
    const base = highlight.rowClassName(record);
    const info = queueStatusMap.get(record.name);
    if (info?.status === 'seeing') return `${base} queue-row-seeing`;
    if (info?.status === 'ready') return `${base} queue-row-ready`;
    return base;
  };

  return (
    <>
      <QueueStrip />
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
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={handleReset}>重置</Button>
            <div style={{ flex: 1 }} />
            <Button type="primary" className="warm-btn-primary" icon={<PlusOutlined />} onClick={() => navigate('/patients/new')}>
              新增
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
              <Button type="primary" className="warm-btn-primary" icon={<SearchOutlined />} onClick={handleSearch}>
                搜索
              </Button>
              <Button onClick={handleReset}>重置</Button>
            </Space>
            <Button
              type="primary"
              className="warm-btn-primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/patients/new')}
            >
              新增患者
            </Button>
          </div>
        </div>
      )}

      {/* Patient list */}
      {isMobile ? (
        <>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : data.length === 0 ? (
            renderEmpty()
          ) : (
            data.map(renderMobilePatientCard)
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
                  highlight.setHighlightId(null);
                  setParams(prev => ({ ...prev, page, size: pageSize }));
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </div>
          )}
        </>
      ) : (
        <>
        <Table<PatientItem>
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={loading}
          rowClassName={combinedRowClassName}
          onRow={highlight.onRow}
          pagination={{
            current: params.page,
            pageSize: params.size,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条记录`,
            onChange: (page, pageSize) => {
              highlight.setHighlightId(null);
              setParams((prev) => ({ ...prev, page, size: pageSize }));
            },
          }}
          locale={{
            emptyText: renderEmpty(),
          }}
        />
        {hasHiddenColumns && <HiddenColumnsHint titles={hiddenColumnTitles} onRestoreAll={restoreAll} />}
        </>
      )}

      <PatientFormModal
        visible={editModalVisible}
        onClose={() => {
          setEditModalVisible(false);
          setEditingPatient(null);
        }}
        onSuccess={handleEditSuccess}
        initialData={
          editingPatient
            ? {
                id: editingPatient.id,
                name: editingPatient.name,
                gender: editingPatient.gender,
                age: editingPatient.age,
                birthday: editingPatient.birthday,
                weight: editingPatient.weight,
                phone: editingPatient.phone,
                id_card: editingPatient.id_card,
                address: editingPatient.address,
                native_place: editingPatient.native_place,
                notes: editingPatient.notes,
              }
            : undefined
        }
      />
    </Card>
    </>
  );
}
