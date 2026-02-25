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
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { listPatients, deletePatient } from '../../api/patient';
import { PatientFormModal } from './PatientForm';

interface PatientItem {
  id: number;
  name: string;
  gender: number;
  age: number;
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
      title: '体重(kg)',
      dataIndex: 'weight',
      key: 'weight',
      width: 100,
      render: (val: number) => (val ? `${val}` : '-'),
    },
    {
      title: '联系电话',
      dataIndex: 'phone',
      key: 'phone',
      width: 140,
      render: (val: string) => val || '-',
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
            onClick={() => navigate(`/patients/${record.id}`)}
          >
            查看
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除此患者？"
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
