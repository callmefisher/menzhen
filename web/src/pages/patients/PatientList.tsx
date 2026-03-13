import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { listPatients, deletePatient } from '../../api/patient';
import { PatientFormModal } from './PatientForm';
import useIsMobile from '../../hooks/useIsMobile';

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

  const handleEditSuccess = () => {
    fetchData(params);
  };

  const columns: ColumnsType<PatientItem> = [
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
      width: 120,
    },
    {
      title: '性别',
      dataIndex: 'gender',
      key: 'gender',
      width: 80,
      render: (val: number) => (val === 1 ? '男' : val === 2 ? '女' : '-'),
    },
    {
      title: '年龄',
      dataIndex: 'age',
      key: 'age',
      width: 80,
    },
    {
      title: '出生日期',
      dataIndex: 'birthday',
      key: 'birthday',
      width: 120,
      responsive: ['md'],
      render: (val: string) => val ? dayjs(val).format('YYYY-MM-DD') : '-',
    },
    {
      title: '体重(kg)',
      dataIndex: 'weight',
      key: 'weight',
      width: 100,
      responsive: ['md'],
      render: (val: number) => (val ? `${val}` : '-'),
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
      title: '现居住地',
      dataIndex: 'address',
      key: 'address',
      width: 150,
      ellipsis: true,
      responsive: ['md'],
      render: (val: string) => val || '-',
    },
    {
      title: '籍贯',
      dataIndex: 'native_place',
      key: 'native_place',
      width: 120,
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

  // --- Mobile patient card ---
  const renderMobilePatientCard = (patient: PatientItem) => {
    const genderIcon = patient.gender === 1
      ? <ManOutlined style={{ color: '#1890ff' }} />
      : patient.gender === 2
      ? <WomanOutlined style={{ color: '#eb2f96' }} />
      : null;
    return (
      <Card
        key={patient.id}
        size="small"
        style={{ marginBottom: 8 }}
        styles={{ body: { padding: '10px 12px' } }}
        onClick={() => navigate(`/patients/${patient.id}`)}
      >
        {/* Row 1: name + gender/age */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{patient.name}</span>
            {genderIcon}
            <Tag color={patient.gender === 1 ? 'blue' : patient.gender === 2 ? 'pink' : 'default'} style={{ margin: 0 }}>
              {patient.age}岁
            </Tag>
          </div>
          {patient.phone && (
            <span style={{ fontSize: 12, color: '#888' }}>
              <PhoneOutlined style={{ marginRight: 2 }} />{patient.phone}
            </span>
          )}
        </div>
        {/* Row 2: extra info */}
        <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>
          {patient.address && <span>{patient.address}</span>}
          {patient.address && patient.notes && <span> · </span>}
          {patient.notes && <span>{patient.notes.length > 20 ? patient.notes.slice(0, 20) + '...' : patient.notes}</span>}
          {!patient.address && !patient.notes && <span>暂无备注</span>}
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
      </Card>
    );
  };

  return (
    <Card styles={isMobile ? { body: { padding: 12 } } : undefined}>
      {/* Search bar */}
      {isMobile ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <Input
              placeholder="搜索患者姓名"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              onPressEnter={handleSearch}
              allowClear
              style={{ flex: 1 }}
            />
            <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
              搜索
            </Button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={handleReset}>重置</Button>
            <div style={{ flex: 1 }} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/patients/new')}>
              新增
            </Button>
          </div>
        </div>
      ) : (
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
            <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
              搜索
            </Button>
            <Button onClick={handleReset}>重置</Button>
          </Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/patients/new')}
          >
            新增患者
          </Button>
        </div>
      )}

      {/* Patient list */}
      {isMobile ? (
        <>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#999' }}>加载中...</div>
          ) : data.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#999' }}>暂无患者记录</div>
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
                  setParams(prev => ({ ...prev, page, size: pageSize }));
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </div>
          )}
        </>
      ) : (
        <Table<PatientItem>
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
            emptyText: '暂无患者记录',
          }}
        />
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
  );
}
