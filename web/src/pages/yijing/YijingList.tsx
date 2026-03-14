import { useState, useEffect } from 'react';
import {
  Input,
  Select,
  Button,
  Card,
  Row,
  Col,
  Pagination,
  Spin,
  Empty,
  Modal,
  Form,
  message,
  Tag,
} from 'antd';
import { SearchOutlined, PlusOutlined } from '@ant-design/icons';
import { listHexagrams, listTrigrams, createHexagram } from '../../api/yijing';
import type { HexagramItem } from '../../api/yijing';
import HexagramDrawer from './HexagramDrawer';
import { useAuth } from '../../store/auth';
import useIsMobile from '../../hooks/useIsMobile';

export default function YijingList() {
  const [hexagrams, setHexagrams] = useState<HexagramItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size] = useState(64);
  const [searchName, setSearchName] = useState('');
  const [upperTrigram, setUpperTrigram] = useState<string | undefined>(undefined);
  const [lowerTrigram, setLowerTrigram] = useState<string | undefined>(undefined);
  const [trigrams, setTrigrams] = useState<string[]>([]);
  const [selectedHexagram, setSelectedHexagram] = useState<HexagramItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);

  const { hasPermission } = useAuth();
  const isAdmin = hasPermission('role:manage');
  const isMobile = useIsMobile();
  const [createForm] = Form.useForm();

  useEffect(() => {
    listTrigrams()
      .then((res) => {
        const body = res as unknown as { data: string[] };
        setTrigrams(body.data || []);
      })
      .catch(() => {
        // ignore
      });
    fetchHexagrams('', undefined, undefined, 1, size);
  }, []);

  const fetchHexagrams = async (
    name: string,
    upper: string | undefined,
    lower: string | undefined,
    p: number,
    s: number
  ) => {
    setLoading(true);
    try {
      const res = await listHexagrams({ name, upper_trigram: upper, lower_trigram: lower, page: p, size: s });
      const body = res as unknown as { data: { list: HexagramItem[]; total: number } };
      setHexagrams(body.data.list || []);
      setTotal(body.data.total || 0);
    } catch {
      message.error('查询卦象失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearchName(value);
    setPage(1);
    fetchHexagrams(value, upperTrigram, lowerTrigram, 1, size);
  };

  const handleUpperChange = (value: string | undefined) => {
    setUpperTrigram(value);
    setPage(1);
    fetchHexagrams(searchName, value, lowerTrigram, 1, size);
  };

  const handleLowerChange = (value: string | undefined) => {
    setLowerTrigram(value);
    setPage(1);
    fetchHexagrams(searchName, upperTrigram, value, 1, size);
  };

  const handlePageChange = (p: number) => {
    setPage(p);
    fetchHexagrams(searchName, upperTrigram, lowerTrigram, p, size);
  };

  const handleCardClick = (hexagram: HexagramItem) => {
    setSelectedHexagram(hexagram);
    setDrawerOpen(true);
  };

  const handleNavigate = (name: string) => {
    const target = hexagrams.find((h) => h.name === name);
    if (target) {
      setSelectedHexagram(target);
    } else {
      // Name not in current page results — search for it
      listHexagrams({ name, size: 1 })
        .then((res) => {
          const body = res as unknown as { data: { list: HexagramItem[]; total: number } };
          const list = body.data.list || [];
          if (list.length > 0) {
            setSelectedHexagram(list[0]);
          } else {
            message.info(`未找到"${name}"卦`);
          }
        })
        .catch(() => {
          message.error('查询失败');
        });
    }
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setCreateLoading(true);
      await createHexagram({
        number: Number(values.number),
        name: values.name,
        symbol: values.symbol,
        upper_trigram: values.upper_trigram,
        lower_trigram: values.lower_trigram,
        judgment: values.judgment,
      });
      message.success('新增卦象成功');
      setCreateModalOpen(false);
      createForm.resetFields();
      fetchHexagrams(searchName, upperTrigram, lowerTrigram, page, size);
    } catch {
      // Validation or API error
    } finally {
      setCreateLoading(false);
    }
  };

  const trigramOptions = trigrams.map((t) => ({ label: t, value: t }));

  return (
    <div>
      {/* Top bar */}
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          gap: 12,
          flexDirection: isMobile ? 'column' : 'row',
          flexWrap: 'wrap',
          alignItems: isMobile ? 'stretch' : 'center',
        }}
      >
        <Input.Search
          placeholder="输入卦名搜索"
          allowClear
          enterButton={<><SearchOutlined /> 搜索</>}
          size="large"
          onSearch={handleSearch}
          style={{ maxWidth: isMobile ? '100%' : 360 }}
        />
        <Select
          placeholder="上卦筛选"
          allowClear
          size="large"
          style={{ minWidth: isMobile ? '100%' : 140 }}
          value={upperTrigram}
          onChange={handleUpperChange}
          options={trigramOptions}
        />
        <Select
          placeholder="下卦筛选"
          allowClear
          size="large"
          style={{ minWidth: isMobile ? '100%' : 140 }}
          value={lowerTrigram}
          onChange={handleLowerChange}
          options={trigramOptions}
        />
        {isAdmin && (
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalOpen(true)}
          >
            新增
          </Button>
        )}
      </div>

      {/* Card grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 64 }}>
          <Spin size="large" />
        </div>
      ) : hexagrams.length === 0 ? (
        <Empty description="暂无卦象数据" />
      ) : (
        <Row gutter={[16, 16]}>
          {hexagrams.map((hexagram) => (
            <Col key={hexagram.id} xs={12} md={6}>
              <Card
                hoverable
                onClick={() => handleCardClick(hexagram)}
                bodyStyle={{ padding: '16px 12px', textAlign: 'center' }}
              >
                <div style={{ fontSize: 32, lineHeight: 1.2, marginBottom: 4 }}>
                  {hexagram.symbol}
                </div>
                <div style={{ fontWeight: 'bold', fontSize: 15, marginBottom: 4 }}>
                  {hexagram.name}
                </div>
                <div style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>
                  第 {hexagram.number} 卦
                </div>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {hexagram.upper_trigram && (
                    <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>{hexagram.upper_trigram}</Tag>
                  )}
                  {hexagram.lower_trigram && (
                    <Tag color="geekblue" style={{ margin: 0, fontSize: 11 }}>{hexagram.lower_trigram}</Tag>
                  )}
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* Pagination */}
      {total > size && (
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Pagination
            current={page}
            pageSize={size}
            total={total}
            onChange={handlePageChange}
            {...(isMobile ? { size: 'small', simple: true } : { showTotal: (t) => `共 ${t} 卦` })}
          />
        </div>
      )}

      {/* Detail drawer */}
      <HexagramDrawer
        hexagram={selectedHexagram}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onUpdate={() => fetchHexagrams(searchName, upperTrigram, lowerTrigram, page, size)}
        onNavigate={handleNavigate}
      />

      {/* Create modal */}
      <Modal
        title="新增卦象"
        open={createModalOpen}
        onOk={handleCreate}
        onCancel={() => {
          setCreateModalOpen(false);
          createForm.resetFields();
        }}
        confirmLoading={createLoading}
        okText="确认"
        cancelText="取消"
        destroyOnClose
        width={isMobile ? 'calc(100vw - 32px)' : 480}
      >
        <Form form={createForm} layout="vertical" autoComplete="off">
          <Form.Item
            label="卦序（第几卦）"
            name="number"
            rules={[{ required: true, message: '请输入卦序' }]}
          >
            <Input type="number" min={1} max={64} placeholder="1-64" />
          </Form.Item>
          <Form.Item
            label="卦名"
            name="name"
            rules={[{ required: true, message: '请输入卦名' }]}
          >
            <Input placeholder="如：乾" />
          </Form.Item>
          <Form.Item label="卦符" name="symbol">
            <Input placeholder="如：☰" />
          </Form.Item>
          <Form.Item label="上卦" name="upper_trigram">
            <Input placeholder="如：乾" />
          </Form.Item>
          <Form.Item label="下卦" name="lower_trigram">
            <Input placeholder="如：坤" />
          </Form.Item>
          <Form.Item label="卦辞" name="judgment">
            <Input.TextArea rows={3} placeholder="请输入卦辞" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
