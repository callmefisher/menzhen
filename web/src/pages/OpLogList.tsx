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
  Pagination,
} from 'antd';
import {
  SearchOutlined,
  DeleteOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import { listOpLogs, deleteOpLog, batchDeleteOpLogs } from '../api/oplog';
import type { OpLogItem, OpLogListParams } from '../api/oplog';
import { useAuth } from '../store/auth';
import useIsMobile from '../hooks/useIsMobile';

const { RangePicker } = DatePicker;

/** Format timestamp to "YYYY-MM-DD HH:mm:ss". If short=true, omit year. */
function formatTime(val: string, short?: boolean): string {
  if (!val) return '-';
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  const pad = (n: number) => String(n).padStart(2, '0');
  const full = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return short ? full.slice(5) : full;
}

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
  inventory_drug: '库存药物',
};

// Resource types that are associated with a patient
const PATIENT_RELATED = new Set(['record', 'medical_record', 'prescription', 'attachment']);

/** Extract patient name from oplog record data */
function getPatientName(record: OpLogItem): string | undefined {
  const data = record.new_data || record.old_data;
  if (!data) return undefined;
  // patient resource: name is a direct field
  if (record.resource_type === 'patient') return data.name || undefined;
  if (!PATIENT_RELATED.has(record.resource_type)) return undefined;
  // medical_record/attachment: patient is directly nested
  // prescription: patient is nested inside record
  return data.patient?.name || data.record?.patient?.name || undefined;
}

// Human-readable field name mapping
const FIELD_LABEL_MAP: Record<string, string> = {
  // 患者
  name: '姓名', gender: '性别', age: '年龄', birthday: '出生日期',
  phone: '电话', id_card: '身份证', address: '住址', native_place: '籍贯',
  notes: '备注', weight: '体重',
  // 病历
  patient_id: '患者ID', diagnosis: '诊断', treatment: '治疗方案',
  visit_date: '就诊日期', chief_complaint: '主诉',
  pulse_id: '脉象ID', pulse_name: '脉象名称',
  tongue_image: '舌象图片', tongue_description: '舌象描述', tongue_analysis: '舌象分析',
  // 处方
  record_id: '病历ID', formula_name: '方剂名称', total_doses: '总剂数',
  prescription_id: '处方ID', herb_name: '中药名称', dosage: '用量', sort_order: '排序',
  // 用户
  username: '用户名', real_name: '真实姓名', role_id: '角色ID', status: '状态',
  password: '密码',
  // 库存
  stock: '库存', purchase_price: '进货价', selling_price: '出售价',
  category: '类别', alert_threshold: '预警阈值', remark: '备注',
  // 系统
  created_by: '创建人ID',
  // 处方明细
  items: '处方明细',
};

// Fields to always skip in display
const SKIP_FIELDS = new Set([
  'id', 'tenant_id', 'created_at', 'updated_at', 'deleted_at',
  'CreatedAt', 'UpdatedAt', 'DeletedAt', 'ID',
  // GORM 关联对象（嵌套），不属于字段变更
  'patient', 'tenant', 'creator', 'pulse', 'attachments', 'prescriptions',
  'record',
]);

// Fields whose label depends on resource type
const FIELD_LABEL_OVERRIDES: Record<string, Record<string, string>> = {
  inventory_drug: { name: '名称' },
};

function getFieldLabel(key: string, resourceType?: string): string {
  if (resourceType && FIELD_LABEL_OVERRIDES[resourceType]?.[key]) {
    return FIELD_LABEL_OVERRIDES[resourceType][key];
  }
  return FIELD_LABEL_MAP[key] || key;
}

/** Format prescription items array as readable text */
function formatItems(items: any[]): string {
  if (!items || items.length === 0) return '(空)';
  return items
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map(i => {
      let s = i.herb_name || '?';
      if (i.dosage) s += ` ${i.dosage}`;
      if (i.notes) s += `(${i.notes})`;
      return s;
    })
    .join('、');
}

function formatValue(val: unknown, key?: string): string {
  if (val === null || val === undefined || val === '') return '(空)';
  if (key === 'items' && Array.isArray(val)) return formatItems(val);
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

/** Mask sensitive fields */
function displayValue(key: string, val: unknown): string {
  if (key === 'password' && val) return '******';
  return formatValue(val, key);
}

interface DiffField {
  key: string;
  label: string;
  oldVal?: string;
  newVal?: string;
  type: 'added' | 'removed' | 'changed';
}

function computeDiff(action: string, oldData: any, newData: any, resourceType?: string): DiffField[] {
  const fields: DiffField[] = [];

  if (action === 'create' && newData) {
    for (const key of Object.keys(newData)) {
      if (SKIP_FIELDS.has(key)) continue;
      const val = newData[key];
      if (val === null || val === undefined || val === '' || val === 0) continue;
      fields.push({
        key,
        label: getFieldLabel(key, resourceType),
        newVal: displayValue(key, val),
        type: 'added',
      });
    }
    return fields;
  }

  if (action === 'delete' && oldData) {
    for (const key of Object.keys(oldData)) {
      if (SKIP_FIELDS.has(key)) continue;
      const val = oldData[key];
      if (val === null || val === undefined || val === '' || val === 0) continue;
      fields.push({
        key,
        label: getFieldLabel(key, resourceType),
        oldVal: displayValue(key, val),
        type: 'removed',
      });
    }
    return fields;
  }

  // update: only show changed fields
  if (oldData && newData) {
    const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
    for (const key of allKeys) {
      if (SKIP_FIELDS.has(key)) continue;
      const ov = oldData[key];
      const nv = newData[key];
      const ovStr = formatValue(ov, key);
      const nvStr = formatValue(nv, key);
      if (ovStr === nvStr) continue;
      fields.push({
        key,
        label: getFieldLabel(key, resourceType),
        oldVal: displayValue(key, ov),
        newVal: displayValue(key, nv),
        type: 'changed',
      });
    }
  }

  return fields;
}

// --- Diff rendering ---
function DiffView({ record, isMobile }: { record: OpLogItem; isMobile: boolean }) {
  const fields = computeDiff(record.action, record.old_data, record.new_data, record.resource_type);

  if (fields.length === 0) {
    return <div style={{ color: '#999', padding: 8 }}>无变更数据</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {fields.map((f) => (
        <div
          key={f.key}
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'flex-start' : 'center',
            gap: isMobile ? 2 : 8,
            padding: '4px 8px',
            borderRadius: 4,
            background:
              f.type === 'added' ? '#f6ffed' :
              f.type === 'removed' ? '#fff1f0' :
              '#e6f7ff',
            fontSize: 13,
          }}
        >
          <span style={{
            fontWeight: 600,
            color: '#333',
            minWidth: isMobile ? undefined : 80,
            flexShrink: 0,
          }}>
            {f.label}
          </span>
          {f.type === 'added' && (
            <span style={{ color: '#389e0d' }}>{f.newVal}</span>
          )}
          {f.type === 'removed' && (
            <span style={{ color: '#cf1322', textDecoration: 'line-through' }}>{f.oldVal}</span>
          )}
          {f.type === 'changed' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <span style={{ color: '#cf1322', textDecoration: 'line-through' }}>{f.oldVal}</span>
              <ArrowRightOutlined style={{ color: '#999', fontSize: 11 }} />
              <span style={{ color: '#389e0d', fontWeight: 500 }}>{f.newVal}</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

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
  const isMobile = useIsMobile();

  // Expanded rows for mobile card view
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

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
      render: (val: string) => formatTime(val),
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
      width: 160,
      render: (_: string, rec: OpLogItem) => {
        const label = RESOURCE_TYPE_MAP[rec.resource_type] || rec.resource_type;
        const pName = getPatientName(rec);
        if (!pName) return label;
        return <>{label} <span style={{ color: '#1677ff' }}>({pName})</span></>;
      },
    },
    {
      title: '资源ID',
      dataIndex: 'resource_id',
      key: 'resource_id',
      width: 100,
      responsive: ['md'] as any,
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

  // --- Mobile card ---
  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const renderMobileCard = (record: OpLogItem) => {
    const actionCfg = ACTION_MAP[record.action];
    const resourceLabel = RESOURCE_TYPE_MAP[record.resource_type] || record.resource_type;
    const patientName = getPatientName(record);
    const expanded = expandedIds.has(record.id);
    const diffFields = computeDiff(record.action, record.old_data, record.new_data, record.resource_type);
    const hasDetail = diffFields.length > 0;

    return (
      <Card
        key={record.id}
        size="small"
        style={{ marginBottom: 8, cursor: hasDetail ? 'pointer' : undefined }}
        styles={{ body: { padding: '10px 12px' } }}
        onClick={() => hasDetail && toggleExpand(record.id)}
      >
        {/* Row 1: action tag + resource type + patient name + time */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {actionCfg && (
              <Tag color={actionCfg.color} style={{ margin: 0, flexShrink: 0 }}>{actionCfg.label}</Tag>
            )}
            <span style={{ fontWeight: 600, fontSize: 14 }}>{resourceLabel}</span>
            {patientName && (
              <span style={{ color: '#1677ff', fontSize: 13, flexShrink: 0 }}>({patientName})</span>
            )}
          </div>
          <span style={{ fontSize: 12, color: '#999', flexShrink: 0 }}>
            {formatTime(record.created_at, true)}
          </span>
        </div>
        {/* Row 2: operator */}
        <div style={{ fontSize: 12, color: '#888', marginBottom: expanded ? 8 : 0 }}>
          {record.user_name} · #{record.resource_id}
          {hasDetail && !expanded && (
            <span style={{ color: '#1677ff', marginLeft: 8 }}>展开详情</span>
          )}
        </div>
        {/* Expanded diff */}
        {expanded && (
          <div style={{ marginTop: 8, borderTop: '1px solid #f0f0f0', paddingTop: 8 }} onClick={e => e.stopPropagation()}>
            <DiffView record={record} isMobile />
            {canDelete && (
              <div style={{ marginTop: 8, textAlign: 'right' }}>
                <Popconfirm
                  title="确定删除此日志？"
                  onConfirm={(e) => { e?.stopPropagation(); handleDelete(record.id); }}
                  okText="删除"
                  cancelText="取消"
                >
                  <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={e => e.stopPropagation()}>
                    删除
                  </Button>
                </Popconfirm>
              </div>
            )}
          </div>
        )}
      </Card>
    );
  };

  // --- Search bar ---
  const renderSearchBar = () => {
    if (isMobile) {
      return (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <Input
              placeholder="操作人姓名"
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
        </div>
      );
    }

    return (
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
    );
  };

  return (
    <Card styles={isMobile ? { body: { padding: 12 } } : undefined}>
      {renderSearchBar()}

      {isMobile ? (
        <>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#999' }}>加载中...</div>
          ) : data.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#999' }}>暂无操作日志</div>
          ) : (
            data.map(renderMobileCard)
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
                  setExpandedIds(new Set());
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </div>
          )}
        </>
      ) : (
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
            expandedRowRender: (record) => (
              <DiffView record={record} isMobile={false} />
            ),
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
      )}
    </Card>
  );
}
