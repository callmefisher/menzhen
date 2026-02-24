import { useState } from 'react';
import { Input, Table, Tag, message } from 'antd';
import { SearchOutlined, RobotOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { listFormulas } from '../../api/formula';
import type { FormulaItem, FormulaCompositionItem } from '../../api/formula';

export default function FormulaSearch() {
  const [formulas, setFormulas] = useState<FormulaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [searchName, setSearchName] = useState('');

  const fetchFormulas = async (name: string, p: number, s: number) => {
    setLoading(true);
    try {
      const res = await listFormulas({ name, page: p, size: s });
      const body = res as unknown as {
        data: { list: FormulaItem[]; total: number };
      };
      setFormulas(body.data.list || []);
      setTotal(body.data.total || 0);
    } catch {
      message.error('查询方剂失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearchName(value);
    setPage(1);
    fetchFormulas(value, 1, size);
  };

  const handleTableChange = (pagination: { current?: number; pageSize?: number }) => {
    const newPage = pagination.current || 1;
    const newSize = pagination.pageSize || 20;
    setPage(newPage);
    setSize(newSize);
    fetchFormulas(searchName, newPage, newSize);
  };

  const columns: ColumnsType<FormulaItem> = [
    {
      title: '方剂名',
      dataIndex: 'name',
      key: 'name',
      width: 150,
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
      title: '组成',
      key: 'composition',
      width: 300,
      render: (_: unknown, record: FormulaItem) => {
        const comp = record.composition || [];
        if (comp.length === 0) return '无';
        return comp.map((c: FormulaCompositionItem) => `${c.herb_name} ${c.default_dosage}`).join('、');
      },
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
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="输入方剂名称搜索（支持AI查询）"
          allowClear
          enterButton={<><SearchOutlined /> 搜索</>}
          size="large"
          onSearch={handleSearch}
          style={{ maxWidth: 500 }}
        />
      </div>

      <Table<FormulaItem>
        columns={columns}
        dataSource={formulas}
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
          expandedRowRender: (record) => {
            const comp = record.composition || [];
            return (
              <div style={{ padding: '8px 0' }}>
                <p><strong>功效：</strong>{record.effects || '无'}</p>
                <p><strong>主治：</strong>{record.indications || '无'}</p>
                <p><strong>组成：</strong></p>
                {comp.length > 0 ? (
                  <Table
                    dataSource={comp.map((c: FormulaCompositionItem, idx: number) => ({ ...c, key: idx }))}
                    columns={[
                      { title: '药物', dataIndex: 'herb_name', key: 'herb_name' },
                      { title: '用量', dataIndex: 'default_dosage', key: 'default_dosage' },
                    ]}
                    pagination={false}
                    size="small"
                    bordered
                  />
                ) : (
                  <span>无组成信息</span>
                )}
                {record.source === 'deepseek' && (
                  <Tag icon={<RobotOutlined />} color="blue" style={{ marginTop: 8 }}>
                    数据来源：DeepSeek AI（仅供参考，请结合临床经验）
                  </Tag>
                )}
              </div>
            );
          },
        }}
      />
    </div>
  );
}
