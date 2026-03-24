import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Input,
  Select,
  Modal,
  Form,
  InputNumber,
  Popconfirm,
  message,
  Tag,
  Tabs,
  Statistic,
  Row,
  Col,
  Tooltip,
  Pagination,
  Dropdown,
} from 'antd';
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined, ImportOutlined, ExportOutlined, DownOutlined } from '@ant-design/icons';
import {
  listInventoryDrugs,
  createInventoryDrug,
  updateInventoryDrug,
  deleteInventoryDrug,
  stockInDrug,
  batchStockIn,
  stockOutDrug,
  batchStockOut,
  findDrugPage,
} from '../../api/inventory';
import type { InventoryDrug, CreateInventoryDrugReq, BatchStockInItem, BatchStockOutItem } from '../../api/inventory';
import useIsMobile from '../../hooks/useIsMobile';
import useRowHighlight from '../../hooks/useRowHighlight';
import { useAccessibleColumns, type AccessibleColumnsType } from '../../hooks/useAccessibleColumns';
import HiddenColumnsHint from '../../components/HiddenColumnsHint';
import DispenseNotification from '../../components/DispenseNotification';

const getDefaultThreshold = (category: string): number => {
  const config = JSON.parse(localStorage.getItem('inventory-alert-config') || '{}');
  return category === 'herb' ? (config.herbThreshold ?? 500) : (config.patentThreshold ?? 10);
};

type StockStatus = 'sufficient' | 'low' | 'insufficient';

const getStockStatus = (drug: InventoryDrug): StockStatus => {
  const threshold = drug.alert_threshold ?? getDefaultThreshold(drug.category);
  if (drug.stock <= threshold) return 'insufficient';
  if (drug.stock <= threshold * 1.5) return 'low';
  return 'sufficient';
};

const statusConfig: Record<StockStatus, { label: string; color: string }> = {
  sufficient: { label: '充足', color: '#52c41a' },
  low: { label: '偏低', color: '#fa8c16' },
  insufficient: { label: '不足', color: '#ff4d4f' },
};

interface ParsedBatchItem {
  name: string;
  quantity: number;
  price: number;
  sellingPrice: number;
  shelfNo: string;
}

function parseBatchText(text: string): ParsedBatchItem[] {
  const lines = text.trim().split('\n').filter(Boolean);
  const items: ParsedBatchItem[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      const name = parts[0];
      const quantity = parseFloat(parts[1]);
      const price = parts.length >= 3 ? parseFloat(parts[2]) : 0;
      const sellingPrice = parts.length >= 4 ? parseFloat(parts[3]) : 0;
      const shelfNo = parts.length >= 5 ? parts[4] : '';
      if (name && !isNaN(quantity) && quantity > 0) {
        items.push({
          name,
          quantity,
          price: isNaN(price) ? 0 : price,
          sellingPrice: isNaN(sellingPrice) ? 0 : sellingPrice,
          shelfNo,
        });
      }
    }
  }
  return items;
}

interface ParsedBatchOutItem {
  name: string;
  quantity: number;
}

function parseBatchOutText(text: string): ParsedBatchOutItem[] {
  const lines = text.trim().split('\n').filter(Boolean);
  const items: ParsedBatchOutItem[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      const name = parts[0];
      const quantity = parseFloat(parts[1]);
      if (name && !isNaN(quantity) && quantity > 0) {
        items.push({ name, quantity });
      }
    }
  }
  return items;
}

export default function DrugList() {
  const isMobile = useIsMobile();
  const [drugs, setDrugs] = useState<InventoryDrug[]>([]);
  const [allDrugs, setAllDrugs] = useState<InventoryDrug[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [params, setParams] = useState({ page: 1, size: 20, name: '', category: '', status: '' });
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDrug, setEditingDrug] = useState<InventoryDrug | null>(null);
  const [modalCategory, setModalCategory] = useState<'herb' | 'patent'>('herb');
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [form] = Form.useForm();

  // Stock-in modal state
  const [stockInModalOpen, setStockInModalOpen] = useState(false);
  const [stockInTab, setStockInTab] = useState<'single' | 'batch'>('single');
  const [stockInDrugTarget, setStockInDrugTarget] = useState<InventoryDrug | null>(null);
  const [stockInForm] = Form.useForm();
  const [batchText, setBatchText] = useState('');
  const [stockInLoading, setStockInLoading] = useState(false);

  // Stock-out modal state
  const [stockOutModalOpen, setStockOutModalOpen] = useState(false);
  const [stockOutMode, setStockOutMode] = useState<'single' | 'batch'>('single');
  const [stockOutDrugTarget, setStockOutDrugTarget] = useState<InventoryDrug | null>(null);
  const [stockOutForm] = Form.useForm();
  const [stockOutQty, setStockOutQty] = useState<number>(0);
  const [batchOutText, setBatchOutText] = useState('');
  const [stockOutLoading, setStockOutLoading] = useState(false);

  // Search local state
  const [searchName, setSearchName] = useState('');
  const [searchCategory, setSearchCategory] = useState('');
  const [searchStatus, setSearchStatus] = useState('');

  const highlight = useRowHighlight({
    data: drugs,
    page: params.page,
    pageSize: params.size,
    loading,
    onPageChange: (page) => setParams(prev => ({ ...prev, page })),
    findPage: findDrugPage,
    idPrefix: 'drug',
  });

  // Auto-search with debounce when status filter changes (clear = reset query)
  const [statusInited, setStatusInited] = useState(false);
  const statusHandledRef = useRef(false);
  useEffect(() => {
    if (!statusInited) { setStatusInited(true); return; }
    if (statusHandledRef.current) { statusHandledRef.current = false; return; }
    const timer = setTimeout(() => {
      setParams((prev) => ({
        ...prev,
        page: 1,
        name: searchStatus === '' ? '' : searchName,
        category: searchStatus === '' ? '' : searchCategory,
        status: searchStatus,
      }));
      if (searchStatus === '') {
        setSearchName('');
        setSearchCategory('');
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [searchStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch all drugs for statistics (unfiltered)
  const fetchAllDrugs = useCallback(async () => {
    try {
      const res = await listInventoryDrugs({ size: 9999 });
      const body = res as any;
      setAllDrugs(body.data?.list || []);
    } catch {
      // ignore
    }
  }, []);

  const fetchDrugs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listInventoryDrugs({
        page: params.page,
        size: params.size,
        name: params.name,
        category: params.category,
      });
      const body = res as any;
      let list: InventoryDrug[] = body.data?.list || [];

      // Client-side status filter
      if (params.status) {
        list = list.filter((d) => getStockStatus(d) === params.status);
      }

      setDrugs(list);
      setTotal(params.status ? list.length : (body.data?.total || 0));
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    fetchDrugs();
    fetchAllDrugs();
  }, [fetchDrugs, fetchAllDrugs]);

  // Statistics
  const stats = useMemo(() => {
    const result = { total: allDrugs.length, sufficient: 0, low: 0, insufficient: 0 };
    for (const drug of allDrugs) {
      const status = getStockStatus(drug);
      result[status]++;
    }
    return result;
  }, [allDrugs]);

  const handleSearch = () => {
    setParams((prev) => ({
      ...prev,
      page: 1,
      name: searchName,
      category: searchCategory,
      status: searchStatus,
    }));
  };

  const handleReset = () => {
    setSearchName('');
    setSearchCategory('');
    setSearchStatus('');
    setParams({ page: 1, size: 20, name: '', category: '', status: '' });
  };

  const handleAdd = () => {
    setEditingDrug(null);
    setModalCategory('herb');
    form.resetFields();
    form.setFieldsValue({ category: 'herb' });
    setModalOpen(true);
  };

  const handleEdit = (record: InventoryDrug) => {
    setEditingDrug(record);
    setModalCategory(record.category);
    form.setFieldsValue({
      name: record.name,
      category: record.category,
      stock: record.stock,
      purchase_price: record.purchase_price,
      selling_price: record.selling_price,
      alert_threshold: record.alert_threshold,
      remark: record.remark,
      shelf_no: record.shelf_no,
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteInventoryDrug(id);
      message.success('删除成功');
      fetchDrugs();
      fetchAllDrugs();
      window.dispatchEvent(new Event('inventory-data-changed'));
    } catch {
      // handled by interceptor
    }
  };

  const handleModalOk = async () => {
    try {
      const values = await form.validateFields();
      setConfirmLoading(true);
      const payload: CreateInventoryDrugReq = {
        name: values.name,
        category: values.category,
        stock: values.stock,
        purchase_price: values.purchase_price,
        selling_price: values.selling_price,
        alert_threshold: values.alert_threshold ?? null,
        remark: values.remark || '',
        shelf_no: values.shelf_no || '',
      };
      if (editingDrug) {
        await updateInventoryDrug(editingDrug.id, payload);
        message.success('更新成功');
        setModalOpen(false);
        fetchDrugs();
        fetchAllDrugs();
        highlight.setHighlightId(editingDrug.id);
      } else {
        const res = await createInventoryDrug(payload) as any;
        const newId = res.data?.id || res.data?.ID;
        message.success('新增成功');
        setModalOpen(false);
        fetchDrugs();
        fetchAllDrugs();
        if (newId) highlight.setHighlightId(newId);
      }
      window.dispatchEvent(new Event('inventory-data-changed'));
    } catch {
      // Validation error or API error handled by interceptor
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleModalCancel = () => {
    setModalOpen(false);
    setEditingDrug(null);
    form.resetFields();
  };

  // --- Stock-in modal ---
  const handleOpenStockIn = (drug?: InventoryDrug) => {
    setStockInDrugTarget(drug || null);
    setStockInTab(drug ? 'single' : 'batch');
    stockInForm.resetFields();
    if (drug) {
      stockInForm.setFieldsValue({
        name: drug.name,
        purchase_price: drug.purchase_price || undefined,
        selling_price: drug.selling_price || undefined,
      });
    }
    setBatchText('');
    setStockInModalOpen(true);
  };

  const handleStockInOk = async () => {
    setStockInLoading(true);
    try {
      if (stockInTab === 'single' && stockInDrugTarget) {
        const values = await stockInForm.validateFields();
        await stockInDrug(stockInDrugTarget.id, {
          quantity: values.quantity,
          purchase_price: values.purchase_price || 0,
          selling_price: values.selling_price || 0,
          alert_threshold: values.alert_threshold ?? undefined,
          shelf_no: values.shelf_no || undefined,
        });
        message.success('入库成功');
        highlight.setHighlightId(stockInDrugTarget.id);
      } else if (stockInTab === 'batch') {
        const items = parseBatchText(batchText);
        if (items.length === 0) {
          message.error('请输入有效的批量入库数据');
          setStockInLoading(false);
          return;
        }
        const batchItems: BatchStockInItem[] = items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          purchase_price: i.price,
          selling_price: i.sellingPrice,
          shelf_no: i.shelfNo || undefined,
        }));
        const res = await batchStockIn({ items: batchItems });
        const body = res as any;
        const data = body.data;
        message.success(`批量入库完成：新增 ${data?.created || 0} 种，更新 ${data?.updated || 0} 种`);
        // Highlight all batch-processed drugs
        if (data?.drug_ids?.length) {
          highlight.setHighlightIds(data.drug_ids);
        }
      } else {
        // Single mode without target — use the form name to find or create
        const values = await stockInForm.validateFields();
        const batchItems: BatchStockInItem[] = [{
          name: values.name,
          quantity: values.quantity,
          purchase_price: values.purchase_price || 0,
          selling_price: values.selling_price || 0,
        }];
        await batchStockIn({
          items: batchItems,
          alert_threshold: values.alert_threshold ?? undefined,
        });
        message.success('入库成功');
      }
      setStockInModalOpen(false);
      fetchDrugs();
      fetchAllDrugs();
      window.dispatchEvent(new Event('inventory-data-changed'));
    } catch {
      // handled
    } finally {
      setStockInLoading(false);
    }
  };

  // --- Stock-out modal ---
  const handleOpenStockOut = (drug?: InventoryDrug) => {
    // Refresh allDrugs for latest stock data before opening modal
    fetchAllDrugs();
    if (drug) {
      setStockOutDrugTarget(drug);
      setStockOutMode('single');
      setStockOutQty(0);
      stockOutForm.resetFields();
    } else {
      setStockOutDrugTarget(null);
      setStockOutMode('batch');
      setBatchOutText('');
    }
    setStockOutModalOpen(true);
  };

  const stockOutExceeds = stockOutDrugTarget ? stockOutQty > stockOutDrugTarget.stock : false;
  const stockOutRemaining = stockOutDrugTarget ? stockOutDrugTarget.stock - stockOutQty : 0;

  const handleStockOutOk = async () => {
    setStockOutLoading(true);
    try {
      if (stockOutMode === 'single' && stockOutDrugTarget) {
        const values = await stockOutForm.validateFields();
        if (values.quantity > stockOutDrugTarget.stock) {
          message.error('出库数量超出库存');
          setStockOutLoading(false);
          return;
        }
        await stockOutDrug(stockOutDrugTarget.id, { quantity: values.quantity });
        message.success('出库成功');
        highlight.setHighlightId(stockOutDrugTarget.id);
      } else if (stockOutMode === 'batch') {
        const items = parseBatchOutText(batchOutText);
        if (items.length === 0) {
          message.error('请输入有效的批量出库数据');
          setStockOutLoading(false);
          return;
        }
        const batchItems: BatchStockOutItem[] = items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
        }));
        const res = await batchStockOut({ items: batchItems });
        const body = res as any;
        const data = body.data;
        const failedCount = data?.failed || 0;
        if (failedCount > 0) {
          const errors: { name: string; reason: string; need: number; current: number }[] = data?.errors || [];
          const errMsgs = errors.map((e) =>
            e.reason === 'not_found'
              ? `${e.name}: 未找到`
              : `${e.name}: 需${e.need}g, 库存${e.current}g`
          );
          message.warning(`批量出库：成功 ${data?.succeeded || 0} 种，失败 ${failedCount} 种\n${errMsgs.join('；')}`, 6);
          // Keep modal open on partial failure so user can fix
          if (data?.drug_ids?.length) {
            highlight.setHighlightIds(data.drug_ids);
          }
          fetchDrugs();
          fetchAllDrugs();
          window.dispatchEvent(new Event('inventory-data-changed'));
          setStockOutLoading(false);
          return;
        } else {
          message.success(`批量出库完成：${data?.succeeded || 0} 种`);
        }
        if (data?.drug_ids?.length) {
          highlight.setHighlightIds(data.drug_ids);
        }
      }
      setStockOutModalOpen(false);
      fetchDrugs();
      fetchAllDrugs();
      window.dispatchEvent(new Event('inventory-data-changed'));
    } catch {
      // handled
    } finally {
      setStockOutLoading(false);
    }
  };

  // Batch out validation: check each item against allDrugs
  const parsedBatchOut = useMemo(() => parseBatchOutText(batchOutText), [batchOutText]);
  const batchOutTotalQty = useMemo(() => parsedBatchOut.reduce((sum, i) => sum + i.quantity, 0), [parsedBatchOut]);
  const batchOutErrors = useMemo(() => {
    if (parsedBatchOut.length === 0) return [];
    const drugMap = new Map(allDrugs.map((d) => [d.name, d]));
    const errors: { name: string; reason: string; need: number; current: number }[] = [];
    for (const item of parsedBatchOut) {
      const drug = drugMap.get(item.name);
      if (!drug) {
        errors.push({ name: item.name, reason: 'not_found', need: item.quantity, current: 0 });
      } else if (item.quantity > drug.stock) {
        errors.push({ name: item.name, reason: 'insufficient', need: item.quantity, current: drug.stock });
      }
    }
    return errors;
  }, [parsedBatchOut, allDrugs]);

  const parsedBatch = useMemo(() => parseBatchText(batchText), [batchText]);
  const batchTotalQty = useMemo(() => parsedBatch.reduce((sum, i) => sum + i.quantity, 0), [parsedBatch]);

  const unitLabel = modalCategory === 'herb' ? '克' : '盒';
  const priceUnit = <span style={{ whiteSpace: 'nowrap' }}>{modalCategory === 'herb' ? '元/500克' : '元/盒'}</span>;

  const allColumns: AccessibleColumnsType<InventoryDrug> = [
    {
      title: '药材名称',
      dataIndex: 'name',
      key: 'name',
      width: 120,
    },
    {
      title: '货架号',
      dataIndex: 'shelf_no',
      key: 'shelf_no',
      width: 80,
      a11yPriority: 1,
      render: (val: string) => val || 'H1',
    },
    {
      title: '库存',
      dataIndex: 'stock',
      key: 'stock',
      width: 100,
      render: (val: number, record: InventoryDrug) => {
        const status = getStockStatus(record);
        const color = status === 'sufficient' ? undefined : statusConfig[status].color;
        const unit = record.category === 'herb' ? 'g' : '盒';
        return <span style={color ? { color, fontWeight: 500 } : undefined}>{val}{unit}</span>;
      },
    },
    {
      title: '进货价 (元/500克)',
      dataIndex: 'purchase_price',
      key: 'purchase_price',
      width: 150,
      a11yPriority: 2,
      render: (val: number, record: InventoryDrug) =>
        record.category === 'patent' ? `¥${val}/盒` : `¥${val}`,
    },
    {
      title: '出售价 (元/500克)',
      dataIndex: 'selling_price',
      key: 'selling_price',
      width: 150,
      a11yPriority: 1,
      render: (val: number, record: InventoryDrug) =>
        record.category === 'patent' ? `¥${val}/盒` : `¥${val}`,
    },
    {
      title: '状态',
      key: 'status',
      width: 70,
      render: (_, record: InventoryDrug) => {
        const status = getStockStatus(record);
        const cfg = statusConfig[status];
        return <Tag color={cfg.color} style={{ color: cfg.color, background: `${cfg.color}10`, borderColor: cfg.color }}>{cfg.label}</Tag>;
      },
    },
    {
      title: '备注',
      dataIndex: 'remark',
      key: 'remark',
      width: 100,
      ellipsis: true,
      responsive: ['md'] as any,
      a11yPriority: 2,
      render: (val: string) => {
        if (!val) return '-';
        return (
          <Tooltip title={val}>
            <span style={{ display: 'inline-block', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>{val}</span>
          </Tooltip>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: isMobile ? 160 : 210,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            onClick={() => handleOpenStockIn(record)}
          >
            入库
          </Button>
          <Button
            type="link"
            size="small"
            style={{ color: '#eb6b3d' }}
            onClick={() => handleOpenStockOut(record)}
          >
            出库
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
            title="确定删除此药物？"
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

  // --- Mobile card view ---
  const renderMobileDrugCard = (drug: InventoryDrug) => {
    const status = getStockStatus(drug);
    const cfg = statusConfig[status];
    const unit = drug.category === 'herb' ? 'g' : '盒';
    const pUnit = drug.category === 'herb' ? '/500g' : '/盒';
    const threshold = drug.alert_threshold ?? getDefaultThreshold(drug.category);
    return (
      <Card
        key={drug.id}
        id={`drug-row-${drug.id}`}
        size="small"
        className={highlight.isHighlighted(drug.id) ? 'row-highlight' : undefined}
        style={{ marginBottom: 8 }}
        styles={{ body: { padding: '10px 12px' } }}
      >
        {/* Row 1: name + category tag + status */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{drug.name}</span>
            <Tag color={drug.category === 'herb' ? 'green' : 'blue'} style={{ margin: 0, flexShrink: 0 }}>
              {drug.category === 'herb' ? '草' : '成'}
            </Tag>
            <Tag style={{ margin: 0, flexShrink: 0 }}>{drug.shelf_no || 'H1'}</Tag>
          </div>
          <Tag
            color={cfg.color}
            style={{ color: cfg.color, background: `${cfg.color}10`, borderColor: cfg.color, margin: 0, flexShrink: 0 }}
          >
            {cfg.label}
          </Tag>
        </div>
        {/* Row 2: stock info */}
        <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#888', marginBottom: 6 }}>
          <span>
            库存{' '}
            <span style={{ color: status !== 'sufficient' ? cfg.color : '#333', fontWeight: 500 }}>
              {drug.stock}{unit}
            </span>
          </span>
          <span>阈值 {threshold}{unit}</span>
        </div>
        {/* Row 3: prices */}
        <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#888', marginBottom: 8 }}>
          <span>进 ¥{drug.purchase_price}{pUnit}</span>
          <span>售 ¥{drug.selling_price}{pUnit}</span>
        </div>
        {/* Row 4: actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" type="primary" ghost onClick={() => handleOpenStockIn(drug)}>
            入库
          </Button>
          <Button size="small" ghost style={{ color: '#eb6b3d', borderColor: '#eb6b3d' }} onClick={() => handleOpenStockOut(drug)}>
            出库
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(drug)}>
            编辑
          </Button>
          <Popconfirm
            title="确定删除此药物？"
            onConfirm={() => handleDelete(drug.id)}
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

  // --- Mobile search bar ---
  const renderMobileSearchBar = () => (
    <div style={{ marginBottom: 12 }}>
      {/* Row 1: search input + status */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <Input
          placeholder="搜索药材..."
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
          onPressEnter={handleSearch}
          allowClear
          style={{ flex: 1 }}
        />
        <Select
          value={searchStatus || undefined}
          placeholder="状态"
          style={{ width: 100 }}
          allowClear
          onChange={(val) => setSearchStatus(val || '')}
          options={[
            { value: 'sufficient', label: '充足' },
            { value: 'low', label: '偏低' },
            { value: 'insufficient', label: '不足' },
          ]}
        />
      </div>
      {/* Row 2: action buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
          搜索
        </Button>
        <Button onClick={handleReset}>重置</Button>
        <div style={{ flex: 1 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          入库
        </Button>
        <Dropdown
          menu={{
            items: [
              { key: 'batch-in', label: '批量入库', icon: <ImportOutlined />, onClick: () => handleOpenStockIn() },
              { key: 'batch-out', label: '批量出库', icon: <ExportOutlined />, onClick: () => handleOpenStockOut() },
            ],
          }}
        >
          <Button icon={<DownOutlined />}>批量</Button>
        </Dropdown>
      </div>
    </div>
  );

  // --- Desktop search bar ---
  const renderDesktopSearchBar = () => (
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
          placeholder="搜索药材名称..."
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
          onPressEnter={handleSearch}
          style={{ width: 160 }}
          allowClear
        />
        <Select
          value={searchStatus || undefined}
          placeholder="全部状态"
          style={{ width: 120 }}
          allowClear
          onChange={(val) => setSearchStatus(val || '')}
          options={[
            { value: 'sufficient', label: '充足' },
            { value: 'low', label: '偏低' },
            { value: 'insufficient', label: '不足' },
          ]}
        />
        <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
          搜索
        </Button>
        <Button onClick={handleReset}>重置</Button>
      </Space>
      <Space wrap>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          + 入库
        </Button>
        <Button icon={<ImportOutlined />} onClick={() => handleOpenStockIn()}>
          批量入库
        </Button>
        <Button icon={<ExportOutlined />} style={{ color: '#eb6b3d', borderColor: '#eb6b3d' }} onClick={() => handleOpenStockOut()}>
          批量出库
        </Button>
      </Space>
    </div>
  );

  // --- Mobile stats ---
  const handleStatsClick = (status: string) => {
    const newStatus = searchStatus === status ? '' : status;
    statusHandledRef.current = true;
    setSearchStatus(newStatus);
    // Bypass debounce — apply filter immediately on click
    setParams((prev) => ({
      ...prev,
      page: 1,
      name: newStatus === '' ? '' : searchName,
      category: newStatus === '' ? '' : searchCategory,
      status: newStatus,
    }));
    if (newStatus === '') {
      setSearchName('');
      setSearchCategory('');
    }
  };

  const renderMobileStats = () => (
    <div style={{ display: 'flex', gap: 8, marginBottom: 12, textAlign: 'center' }}>
      {[
        { label: '总数', value: stats.total, color: undefined, status: '' },
        { label: '充足', value: stats.sufficient, color: '#52c41a', status: 'sufficient' },
        { label: '偏低', value: stats.low, color: '#fa8c16', status: 'low' },
        { label: '不足', value: stats.insufficient, color: '#ff4d4f', status: 'insufficient' },
      ].map((item) => (
        <div
          key={item.label}
          onClick={() => handleStatsClick(item.status)}
          style={{
            flex: 1,
            background: searchStatus === item.status ? (item.color ? `${item.color}15` : '#e6f7ff') : '#fafafa',
            borderRadius: 6,
            padding: '6px 0',
            cursor: 'pointer',
            border: searchStatus === item.status ? `1px solid ${item.color || '#1890ff'}` : '1px solid transparent',
            transition: 'all 0.2s',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600, color: item.color }}>{item.value}</div>
          <div style={{ fontSize: 11, color: item.color || '#999' }}>{item.label}</div>
        </div>
      ))}
    </div>
  );

  // --- Stock-out drug info panel ---
  const renderStockOutDrugInfo = () => {
    if (!stockOutDrugTarget) return null;
    const drug = stockOutDrugTarget;
    const status = getStockStatus(drug);
    const cfg = statusConfig[status];
    const unit = drug.category === 'herb' ? 'g' : '盒';
    const pUnit = drug.category === 'herb' ? '/500g' : '/盒';
    return (
      <div style={{
        background: '#fafafa',
        borderRadius: 8,
        padding: isMobile ? 12 : 16,
        marginBottom: 20,
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: isMobile ? '8px' : '12px 24px',
      }}>
        <div style={{ gridColumn: '1 / -1', fontSize: 16, fontWeight: 600, paddingBottom: 8, borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 8 }}>
          {drug.name}
          <Tag color={drug.category === 'herb' ? 'green' : 'blue'} style={{ margin: 0 }}>
            {drug.category === 'herb' ? '草' : '成'}
          </Tag>
          <Tag style={{ margin: 0, background: '#e6f4ff', color: '#1677ff', borderColor: '#91caff' }}>
            {drug.shelf_no || 'H1'}
          </Tag>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#8c8c8c', minWidth: 56 }}>当前库存</span>
          <span style={{ fontSize: 18, fontWeight: 600, color: cfg.color }}>{drug.stock}{unit}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#8c8c8c', minWidth: 56 }}>状态</span>
          <Tag color={cfg.color} style={{ color: cfg.color, background: `${cfg.color}10`, borderColor: cfg.color }}>{cfg.label}</Tag>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#8c8c8c', minWidth: 56 }}>进货价</span>
          <span style={{ fontSize: 14, fontWeight: 500 }}>¥{drug.purchase_price}{pUnit}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#8c8c8c', minWidth: 56 }}>出售价</span>
          <span style={{ fontSize: 14, fontWeight: 500 }}>¥{drug.selling_price}{pUnit}</span>
        </div>
      </div>
    );
  };

  return (
    <>
      <Card styles={isMobile ? { body: { padding: 12 } } : undefined}>
        {/* Prescription dispense notifications */}
        <DispenseNotification />

        {/* Search bar */}
        {isMobile ? renderMobileSearchBar() : renderDesktopSearchBar()}

        {/* Statistics */}
        {isMobile ? renderMobileStats() : (
          <Row gutter={16} style={{ marginBottom: 16 }}>
            {[
              { title: '药材总数', value: stats.total, color: undefined, status: '' },
              { title: '库存充足', value: stats.sufficient, color: '#52c41a', status: 'sufficient' },
              { title: '库存偏低', value: stats.low, color: '#fa8c16', status: 'low' },
              { title: '库存不足', value: stats.insufficient, color: '#ff4d4f', status: 'insufficient' },
            ].map((item) => (
              <Col xs={12} sm={6} key={item.status}>
                <Card
                  size="small"
                  hoverable
                  onClick={() => handleStatsClick(item.status)}
                  style={{
                    textAlign: 'center',
                    cursor: 'pointer',
                    borderColor: searchStatus === item.status ? (item.color || '#1890ff') : undefined,
                    background: searchStatus === item.status ? (item.color ? `${item.color}08` : '#e6f7ff') : undefined,
                    transition: 'all 0.2s',
                  }}
                >
                  <Statistic
                    title={item.color ? <span style={{ color: item.color }}>{item.title}</span> : item.title}
                    value={item.value}
                    valueStyle={item.color ? { color: item.color } : undefined}
                  />
                </Card>
              </Col>
            ))}
          </Row>
        )}

        {/* Drug list */}
        {isMobile ? (
          <>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 32, color: '#999' }}>加载中...</div>
            ) : drugs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 32, color: '#999' }}>暂无药物记录</div>
            ) : (
              drugs.map(renderMobileDrugCard)
            )}
            {!params.status && total > 0 && (
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
          <Table<InventoryDrug>
            rowKey="id"
            columns={columns}
            dataSource={drugs}
            loading={loading}
            rowClassName={highlight.rowClassName}
            onRow={highlight.onRow}
            pagination={
              params.status
                ? false
                : {
                    current: params.page,
                    pageSize: params.size,
                    total,
                    showSizeChanger: true,
                    showTotal: (t) => `共 ${t} 种药材`,
                    onChange: (page, pageSize) => {
                      highlight.setHighlightId(null);
                      setParams((prev) => ({ ...prev, page, size: pageSize }));
                    },
                  }
            }
            locale={{ emptyText: '暂无药物记录' }}
          />
          {hasHiddenColumns && <HiddenColumnsHint titles={hiddenColumnTitles} onRestoreAll={restoreAll} />}
          </>
        )}
      </Card>

      {/* Add/Edit drug modal */}
      <Modal
        title={editingDrug ? '编辑药物' : '新增药物'}
        open={modalOpen}
        onOk={handleModalOk}
        onCancel={handleModalCancel}
        confirmLoading={confirmLoading}
        okText={editingDrug ? '保存' : '新增'}
        cancelText="取消"
        destroyOnClose
        width={isMobile ? 'calc(100% - 16px)' : 520}
        style={isMobile ? { top: 16, maxWidth: '100%', margin: '0 8px' } : undefined}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ category: 'herb' }}
        >
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: '请输入药物名称' }]}
          >
            <Input placeholder="请输入药物名称" autoComplete="off" />
          </Form.Item>

          <Form.Item
            label="种类"
            name="category"
            rules={[{ required: true, message: '请选择种类' }]}
          >
            <Select
              options={[
                { value: 'herb', label: '本草' },
                { value: 'patent', label: '成药' },
              ]}
              onChange={(val) => setModalCategory(val as 'herb' | 'patent')}
            />
          </Form.Item>

          <Form.Item
            label="库存量"
            name="stock"
            rules={[{ required: true, message: '请输入库存量' }]}
          >
            <InputNumber
              min={0}
              precision={2}
              addonAfter={unitLabel}
              style={{ width: '100%' }}
              placeholder="请输入库存量"
            />
          </Form.Item>

          <Form.Item
            label="进货价"
            name="purchase_price"
            rules={[{ required: true, message: '请输入进货价' }]}
          >
            <InputNumber
              min={0}
              precision={2}
              addonAfter={priceUnit}
              style={{ width: '100%' }}
              placeholder="请输入进货价"
            />
          </Form.Item>

          <Form.Item
            label="出售价"
            name="selling_price"
            rules={[{ required: true, message: '请输入出售价' }]}
          >
            <InputNumber
              min={0}
              precision={2}
              addonAfter={priceUnit}
              style={{ width: '100%' }}
              placeholder="请输入出售价"
            />
          </Form.Item>

          <Form.Item
            label="预警阈值"
            name="alert_threshold"
            tooltip="留空则使用全局默认值"
          >
            <InputNumber
              min={0}
              precision={2}
              style={{ width: '100%' }}
              placeholder="留空使用默认值"
            />
          </Form.Item>

          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={3} placeholder="备注（可选）" />
          </Form.Item>

          <Form.Item label="货架号" name="shelf_no">
            <Input placeholder="默认 H1" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Stock-in modal */}
      <Modal
        title="药材入库"
        open={stockInModalOpen}
        onOk={handleStockInOk}
        onCancel={() => setStockInModalOpen(false)}
        confirmLoading={stockInLoading}
        okText="确认入库"
        cancelText="取消"
        destroyOnClose
        width={isMobile ? 'calc(100% - 16px)' : 520}
        style={isMobile ? { top: 16, maxWidth: '100%', margin: '0 8px' } : undefined}
      >
        <Tabs
          activeKey={stockInTab}
          onChange={(key) => setStockInTab(key as 'single' | 'batch')}
          items={[
            {
              key: 'single',
              label: '单个入库',
              children: (
                <Form form={stockInForm} layout="vertical">
                  <Form.Item
                    label="药材名称"
                    name="name"
                    rules={[{ required: true, message: '请输入药材名称' }]}
                  >
                    <Input
                      placeholder="请输入药材名称"
                      disabled={!!stockInDrugTarget}
                      autoComplete="off"
                    />
                  </Form.Item>
                  {(() => {
                    const isPatent = stockInDrugTarget?.category === 'patent';
                    const qtyUnit = isPatent ? '盒' : 'g';
                    const priceAddon = <span style={{ whiteSpace: 'nowrap' }}>{isPatent ? '元/盒' : '元/500克'}</span>;
                    return (
                      <>
                        <Form.Item
                          label="入库数量"
                          name="quantity"
                          rules={[{ required: true, message: '请输入数量' }]}
                        >
                          <InputNumber min={0.01} precision={2} addonAfter={qtyUnit} style={{ width: '100%' }} placeholder="请输入入库数量" />
                        </Form.Item>
                        <Form.Item label="进货价" name="purchase_price">
                          <InputNumber min={0} precision={2} addonAfter={priceAddon} style={{ width: '100%' }} placeholder="请输入进货价" />
                        </Form.Item>
                        <Form.Item label="出售价" name="selling_price">
                          <InputNumber min={0} precision={2} addonAfter={priceAddon} style={{ width: '100%' }} placeholder="请输入出售价" />
                        </Form.Item>
                        <Form.Item
                          label="预警阈值"
                          name="alert_threshold"
                          tooltip="留空不修改"
                        >
                          <InputNumber min={0} precision={2} addonAfter={qtyUnit} style={{ width: '100%' }} placeholder="留空不修改" />
                        </Form.Item>
                        <Form.Item
                          label="货架号"
                          name="shelf_no"
                          tooltip="留空不修改"
                        >
                          <Input placeholder="留空不修改" />
                        </Form.Item>
                      </>
                    );
                  })()}
                  {stockInDrugTarget && (
                    <div style={{
                      background: '#f6ffed',
                      border: '1px solid #b7eb8f',
                      borderRadius: 6,
                      padding: '8px 12px',
                      color: '#389e0d',
                      fontSize: 13,
                    }}>
                      当前库存: {stockInDrugTarget.stock}{stockInDrugTarget.category === 'patent' ? '盒' : 'g'}
                    </div>
                  )}
                </Form>
              ),
            },
            {
              key: 'batch',
              label: '批量入库',
              children: (
                <div>
                  <div style={{ color: '#666', marginBottom: 8, fontSize: 13 }}>
                    每行一味药，格式：药名 数量(g) 进货价(元/500克) 出售价(元/500克) [货架号]
                  </div>
                  <Input.TextArea
                    rows={8}
                    value={batchText}
                    onChange={(e) => setBatchText(e.target.value)}
                    placeholder={'当归 500 60 80 A-01\n黄芪 1000 40 60 A-02\n白术 500 50 70 B-01\n陈皮 300 30 45'}
                    style={{ fontFamily: 'monospace' }}
                  />
                  {parsedBatch.length > 0 && (
                    <div style={{
                      background: '#f6ffed',
                      border: '1px solid #b7eb8f',
                      borderRadius: 6,
                      padding: '8px 12px',
                      color: '#389e0d',
                      fontSize: 13,
                      marginTop: 8,
                    }}>
                      已识别 {parsedBatch.length} 味药材，合计入库 {batchTotalQty}g
                    </div>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Modal>

      {/* Stock-out modal */}
      <Modal
        title="药材出库"
        open={stockOutModalOpen}
        onOk={handleStockOutOk}
        onCancel={() => setStockOutModalOpen(false)}
        confirmLoading={stockOutLoading}
        okText="确认出库"
        okButtonProps={{
          danger: true,
          disabled: stockOutMode === 'single'
            ? (!stockOutQty || stockOutExceeds)
            : parsedBatchOut.length === 0,
        }}
        cancelText="取消"
        destroyOnClose
        width={isMobile ? 'calc(100% - 16px)' : 520}
        style={isMobile ? { top: 16, maxWidth: '100%', margin: '0 8px' } : undefined}
      >
        {stockOutMode === 'single' ? (
          <>
            {renderStockOutDrugInfo()}
            <Form form={stockOutForm} layout="vertical">
              <Form.Item
                label="出库数量"
                name="quantity"
                rules={[{ required: true, message: '请输入出库数量' }]}
              >
                <InputNumber
                  min={0.01}
                  precision={2}
                  addonAfter={stockOutDrugTarget?.category === 'patent' ? '盒' : 'g'}
                  style={{ width: '100%' }}
                  placeholder="请输入出库数量"
                  status={stockOutExceeds ? 'error' : undefined}
                  onChange={(val) => setStockOutQty(val || 0)}
                />
              </Form.Item>
            </Form>
            {stockOutDrugTarget && stockOutQty > 0 && !stockOutExceeds && (
              <div style={{
                background: '#f6ffed',
                border: '1px solid #b7eb8f',
                borderRadius: 6,
                padding: '8px 12px',
                color: '#389e0d',
                fontSize: 13,
              }}>
                出库后剩余: <strong>{stockOutRemaining}{stockOutDrugTarget.category === 'patent' ? '盒' : 'g'}</strong>
                {(() => {
                  const remaining = { ...stockOutDrugTarget, stock: stockOutRemaining };
                  const s = getStockStatus(remaining);
                  return <span>（{statusConfig[s].label}）</span>;
                })()}
              </div>
            )}
            {stockOutExceeds && (
              <div style={{
                background: '#fff2f0',
                border: '1px solid #ffccc7',
                borderRadius: 6,
                padding: '8px 12px',
                color: '#ff4d4f',
                fontSize: 13,
                fontWeight: 500,
              }}>
                出库数量 ({stockOutQty}{stockOutDrugTarget?.category === 'patent' ? '盒' : 'g'}) 超出当前库存 ({stockOutDrugTarget?.stock}{stockOutDrugTarget?.category === 'patent' ? '盒' : 'g'})！
              </div>
            )}
          </>
        ) : (
          <div>
            <div style={{ color: '#666', marginBottom: 8, fontSize: 13 }}>
              每行一味药，格式：药名 数量(g)
            </div>
            <Input.TextArea
              rows={8}
              value={batchOutText}
              onChange={(e) => setBatchOutText(e.target.value)}
              placeholder={'当归 100\n黄芪 200\n白术 50'}
              style={{ fontFamily: 'monospace' }}
            />
            {parsedBatchOut.length > 0 && batchOutErrors.length === 0 && (
              <div style={{
                background: '#f6ffed',
                border: '1px solid #b7eb8f',
                borderRadius: 6,
                padding: '8px 12px',
                color: '#389e0d',
                fontSize: 13,
                marginTop: 8,
              }}>
                已识别 {parsedBatchOut.length} 味药材，合计出库 {batchOutTotalQty}g — 全部库存充足
              </div>
            )}
            {parsedBatchOut.length > 0 && batchOutErrors.length > 0 && (
              <div style={{
                background: '#fff7e6',
                border: '1px solid #ffd591',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 13,
                marginTop: 8,
              }}>
                <div style={{ color: '#d46b08' }}>已识别 {parsedBatchOut.length} 味药材，其中 <strong>{batchOutErrors.length} 项有问题</strong>（提交后将跳过失败项）：</div>
                <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                  {batchOutErrors.map((e) => (
                    <li key={e.name} style={{ padding: '2px 0', color: '#ff4d4f' }}>
                      <strong>{e.name}</strong>：{e.reason === 'not_found' ? '未找到此药材' : `需要 ${e.need}g，库存仅 ${e.current}g（差 ${(e.need - e.current).toFixed(1)}g）`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
