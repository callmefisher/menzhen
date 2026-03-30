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
  Checkbox,
  message,
  Pagination,
} from 'antd';
import {
  SearchOutlined,
  DeleteOutlined,
  ArrowRightOutlined,
  CheckSquareOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { listOpLogs, deleteOpLog, batchDeleteOpLogs } from '../api/oplog';
import type { OpLogItem, OpLogListParams } from '../api/oplog';
import { useAuth } from '../store/auth';
import useIsMobile from '../hooks/useIsMobile';
import { useAccessibleColumns, type AccessibleColumnsType } from '../hooks/useAccessibleColumns';
import HiddenColumnsHint from '../components/HiddenColumnsHint';

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
  stock_in: { label: '入库', color: 'cyan' },
  stock_out: { label: '出库', color: 'orange' },
  batch_stock_in: { label: '批量入库', color: 'cyan' },
  batch_stock_out: { label: '批量出库', color: 'orange' },
  deduct_stock: { label: '扣减库存', color: 'orange' },
  backup: { label: '备份', color: 'purple' },
  restore: { label: '恢复', color: 'magenta' },
};

const RESOURCE_TYPE_MAP: Record<string, string> = {
  patient: '患者',
  record: '诊疗记录',
  medical_record: '诊疗记录',
  attachment: '附件',
  prescription: '处方',
  user: '用户',
  inventory_drug: '库存药物',
  follow_up: '回访',
  billing: '收费',
  system: '系统操作',
};

// Resource types that are associated with a patient
const PATIENT_RELATED = new Set(['record', 'medical_record', 'prescription', 'attachment', 'follow_up', 'billing']);

/** Extract a display name from oplog record data (patient name, drug name, etc.) */
function getResourceDisplayName(record: OpLogItem): string | undefined {
  const data = record.new_data || record.old_data;
  if (!data) return undefined;
  // system resource (backup/restore): show tenant name
  if (record.resource_type === 'system') return data.tenant_name || undefined;
  // patient resource: name is a direct field
  if (record.resource_type === 'patient') return data.name || undefined;
  // user resource: show username / real_name
  if (record.resource_type === 'user') {
    const username = data.username;
    const realName = data.real_name;
    if (username && realName) return `${username} / ${realName}`;
    return username || realName || undefined;
  }
  // inventory_drug: drug name is a direct field
  if (record.resource_type === 'inventory_drug') return data.name || undefined;
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
  // 回访
  is_recovered: '是否康复', planned_date: '计划回访日期', actual_date: '实际回访日期',
  method: '回访方式', content: '回访内容',
  // 收费
  consultation_fee: '诊金', drug_cost_total: '药费合计',
  total_amount: '总金额', actual_paid: '实付金额', stock_deducted: '已扣库存',
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

// Value translations for specific fields
const VALUE_LABEL_MAP: Record<string, Record<string, string>> = {
  status: { pending: '待回访', completed: '已完成', cancelled: '已取消', active: '启用', disabled: '禁用' },
  method: { phone: '电话', visit: '上门', online: '线上' },
  gender: { male: '男', female: '女' },
};

function formatValue(val: unknown, key?: string): string {
  if (val === null || val === undefined || val === '') return '(空)';
  if (key === 'items' && Array.isArray(val)) return formatItems(val);
  if (typeof val === 'boolean') return val ? '是' : '否';
  if (typeof val === 'object') return JSON.stringify(val);
  // Translate known enum values
  if (key && VALUE_LABEL_MAP[key]) {
    const mapped = VALUE_LABEL_MAP[key][String(val)];
    if (mapped) return mapped;
  }
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

  // deduct_stock / stock_in / stock_out / batch_stock_in: old_data may be null, treat like create
  if (!oldData && newData && action !== 'create') {
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

/** Special view for deduct_stock action showing drug deductions clearly */
function DeductStockView({ record, isMobile }: { record: OpLogItem; isMobile: boolean }) {
  const data = record.new_data;
  if (!data) return <div style={{ color: '#999', padding: 8 }}>无变更数据</div>;

  const patientName = data.patient?.name;
  const formulaName = data.formula_name;
  const totalDoses = data.total_doses;
  const items: any[] = data.items || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Summary */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: isMobile ? 6 : 12,
        padding: '6px 10px', background: '#fff7e6', borderRadius: 4, fontSize: 13,
      }}>
        {patientName && <span><b>患者：</b>{patientName}</span>}
        {formulaName && <span><b>方剂：</b>{formulaName}</span>}
        {totalDoses > 0 && <span><b>剂数：</b>{totalDoses}</span>}
        {data.drug_cost_total != null && <span><b>药费：</b>¥{Number(data.drug_cost_total).toFixed(2)}</span>}
        {data.total_amount != null && <span><b>总额：</b>¥{Number(data.total_amount).toFixed(2)}</span>}
      </div>
      {/* Drug items */}
      {items.length > 0 && (
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            display: 'flex', padding: '6px 10px', background: '#fafafa',
            fontWeight: 600, fontSize: 12, color: '#666',
          }}>
            <span style={{ flex: 2 }}>药材</span>
            <span style={{ flex: 1 }}>用量</span>
            <span style={{ flex: 1 }}>类别</span>
          </div>
          {items
            .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
            .map((item: any, idx: number) => (
              <div key={idx} style={{
                display: 'flex', padding: '5px 10px', fontSize: 13,
                borderTop: '1px solid #f0f0f0',
                background: idx % 2 === 0 ? '#fff' : '#fafafa',
              }}>
                <span style={{ flex: 2, fontWeight: 500 }}>{item.herb_name || '-'}</span>
                <span style={{ flex: 1, color: '#d4380d' }}>{item.dosage || '-'}</span>
                <span style={{ flex: 1, color: '#888' }}>
                  {item.category === 'patent' ? '成药' : '中药'}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/** Special view for batch_stock_in action showing imported items */
function BatchStockInView({ record, isMobile }: { record: OpLogItem; isMobile: boolean }) {
  const data = record.new_data;
  if (!data) return <div style={{ color: '#999', padding: 8 }}>无变更数据</div>;

  const items: any[] = data.items || [];
  const created = data.created ?? 0;
  const updated = data.updated ?? 0;
  const total = data.total ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Summary */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: isMobile ? 6 : 12,
        padding: '6px 10px', background: '#e6f7ff', borderRadius: 4, fontSize: 13,
      }}>
        <span><b>总计：</b>{total} 项</span>
        {created > 0 && <span><b>新增：</b>{created}</span>}
        {updated > 0 && <span><b>追加：</b>{updated}</span>}
        {data.alert_threshold != null && <span><b>预警阈值：</b>{data.alert_threshold}</span>}
      </div>
      {/* Drug items */}
      {items.length > 0 && (
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            display: 'flex', padding: '6px 10px', background: '#fafafa',
            fontWeight: 600, fontSize: 12, color: '#666',
          }}>
            <span style={{ flex: 2 }}>药材</span>
            <span style={{ flex: 1, textAlign: 'right' }}>数量</span>
            <span style={{ flex: 1, textAlign: 'right' }}>进价</span>
            <span style={{ flex: 1, textAlign: 'right' }}>售价</span>
            {!isMobile && <span style={{ flex: 1, textAlign: 'center' }}>货架</span>}
          </div>
          {items.map((item: any, idx: number) => (
            <div key={idx} style={{
              display: 'flex', padding: '5px 10px', fontSize: 13,
              borderTop: '1px solid #f0f0f0',
              background: idx % 2 === 0 ? '#fff' : '#fafafa',
            }}>
              <span style={{ flex: 2, fontWeight: 500 }}>{item.name || '-'}</span>
              <span style={{ flex: 1, textAlign: 'right', color: '#1890ff' }}>{item.quantity || '-'}</span>
              <span style={{ flex: 1, textAlign: 'right' }}>{item.purchase_price ? `¥${Number(item.purchase_price).toFixed(2)}` : '-'}</span>
              <span style={{ flex: 1, textAlign: 'right' }}>{item.selling_price ? `¥${Number(item.selling_price).toFixed(2)}` : '-'}</span>
              {!isMobile && <span style={{ flex: 1, textAlign: 'center', color: '#888' }}>{item.shelf_no || '-'}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Special view for batch_stock_out action showing deducted items */
function BatchStockOutView({ record, isMobile }: { record: OpLogItem; isMobile: boolean }) {
  const data = record.new_data;
  if (!data) return <div style={{ color: '#999', padding: 8 }}>无变更数据</div>;

  const items: any[] = data.items || [];
  const succeeded = data.succeeded ?? 0;
  const failed = data.failed ?? 0;
  const total = data.total ?? 0;
  const errors: any[] = data.errors || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Summary line */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: isMobile ? 6 : 12, alignItems: 'center',
        padding: '5px 10px', background: failed > 0 ? '#fff7e6' : '#f6ffed', borderRadius: 4, fontSize: 13,
      }}>
        <span><b>总计</b> {total} 种</span>
        <span style={{ color: '#52c41a' }}><b>成功</b> {succeeded}</span>
        {failed > 0 && <span style={{ color: '#ff4d4f' }}><b>失败</b> {failed}</span>}
        {data.reason && <span style={{ color: '#666' }}>原因：{data.reason}</span>}
      </div>
      {/* Drug items — compact inline tags */}
      {items.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '2px 0' }}>
          {items.map((item: any, idx: number) => (
            <span key={idx} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 10px', borderRadius: 4, fontSize: 13,
              background: '#fafafa', border: '1px solid #f0f0f0',
            }}>
              <span style={{ fontWeight: 500 }}>{item.name}</span>
              <span style={{ color: '#eb6b3d', fontWeight: 600 }}>{item.quantity}g</span>
            </span>
          ))}
        </div>
      )}
      {/* Errors — compact */}
      {errors.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '2px 0' }}>
          {errors.map((e: any, idx: number) => (
            <span key={idx} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 10px', borderRadius: 4, fontSize: 13,
              background: '#fff2f0', border: '1px solid #ffccc7', color: '#ff4d4f',
            }}>
              <b>{e.name}</b>
              {e.reason === 'not_found' ? `未找到（请求${e.need}g）` : e.reason === 'db_error' ? 'DB错误' : `需${e.need}g/存${e.current}g`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Check if a record has expandable detail */
function hasExpandableDetail(record: OpLogItem): boolean {
  if (record.action === 'backup' || record.action === 'restore' || record.action === 'deduct_stock' || record.action === 'batch_stock_in' || record.action === 'batch_stock_out') {
    return !!(record.new_data);
  }
  return computeDiff(record.action, record.old_data, record.new_data, record.resource_type).length > 0;
}

/** Special view for backup/restore actions showing operation details */
function BackupRestoreView({ record, isMobile }: { record: OpLogItem; isMobile: boolean }) {
  const data = record.new_data;
  if (!data) return <div style={{ color: '#999', padding: 8 }}>无变更数据</div>;

  const isBackup = record.action === 'backup';
  const statusColor = data.status === 'success' ? '#52c41a' : '#ff4d4f';
  const statusText = data.status === 'success' ? '成功' : '失败';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: isMobile ? 6 : 12,
        padding: '6px 10px',
        background: isBackup ? '#f9f0ff' : '#fff0f6',
        borderRadius: 4, fontSize: 13,
      }}>
        {data.tenant_name && <span><b>诊所：</b>{data.tenant_name}</span>}
        {isBackup ? (
          <span><b>备份类型：</b>{data.backup_type_label || data.backup_type}</span>
        ) : (
          <>
            <span><b>恢复来源：</b>{data.source_label || data.source}</span>
            {data.mysql_file && <span><b>MySQL文件：</b>{data.mysql_file}</span>}
            {data.minio_file && <span><b>MinIO文件：</b>{data.minio_file}</span>}
          </>
        )}
        <span><b>状态：</b><span style={{ color: statusColor, fontWeight: 600 }}>{statusText}</span></span>
      </div>
    </div>
  );
}

// --- Diff rendering ---
function DiffView({ record, isMobile }: { record: OpLogItem; isMobile: boolean }) {
  // Special rendering for backup/restore
  if (record.action === 'backup' || record.action === 'restore') {
    return <BackupRestoreView record={record} isMobile={isMobile} />;
  }
  // Special rendering for deduct_stock
  if (record.action === 'deduct_stock') {
    return <DeductStockView record={record} isMobile={isMobile} />;
  }
  // Special rendering for batch_stock_in
  if (record.action === 'batch_stock_in') {
    return <BatchStockInView record={record} isMobile={isMobile} />;
  }
  // Special rendering for batch_stock_out
  if (record.action === 'batch_stock_out') {
    return <BatchStockOutView record={record} isMobile={isMobile} />;
  }

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
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
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
  // Mobile batch selection mode
  const [mobileSelecting, setMobileSelecting] = useState(false);

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
          is_super_admin: boolean;
        };
      };
      setData(body.data.list ?? []);
      setTotal(body.data.total ?? 0);
      setIsSuperAdmin(body.data.is_super_admin ?? false);
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

  const allColumns: AccessibleColumnsType<OpLogItem> = [
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
      a11yPriority: 2,
      render: (_: string, rec: OpLogItem) => {
        const label = RESOURCE_TYPE_MAP[rec.resource_type] || rec.resource_type;
        const displayName = getResourceDisplayName(rec);
        if (!displayName) return label;
        return <>{label} <span style={{ color: '#1677ff' }}>({displayName})</span></>;
      },
    },
    ...(isSuperAdmin
      ? [
          {
            title: '所属租户',
            key: 'tenant_name',
            width: 120,
            render: (_: unknown, record: OpLogItem) => record.tenant?.name || '-',
          } as AccessibleColumnsType<OpLogItem>[number],
        ]
      : []),
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
          } as AccessibleColumnsType<OpLogItem>[number],
        ]
      : []),
  ];

  const { columns, hiddenColumnTitles, hasHiddenColumns, restoreAll } = useAccessibleColumns(allColumns);

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
    const displayName = getResourceDisplayName(record);
    const expanded = expandedIds.has(record.id);
    const hasDetail = hasExpandableDetail(record);

    const isSelected = selectedRowKeys.includes(record.id);

    return (
      <Card
        key={record.id}
        size="small"
        style={{
          marginBottom: 8,
          cursor: mobileSelecting ? 'pointer' : hasDetail ? 'pointer' : undefined,
          border: isSelected && mobileSelecting ? '1px solid #1677ff' : undefined,
          background: isSelected && mobileSelecting ? '#e6f4ff' : undefined,
        }}
        styles={{ body: { padding: '10px 12px' } }}
        onClick={() => {
          if (mobileSelecting) {
            setSelectedRowKeys(prev =>
              prev.includes(record.id)
                ? prev.filter(k => k !== record.id)
                : [...prev, record.id]
            );
          } else if (hasDetail) {
            toggleExpand(record.id);
          }
        }}
      >
        {/* Row 1: action tag + resource type + patient name + time */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {mobileSelecting && (
              <Checkbox
                checked={isSelected}
                onClick={e => e.stopPropagation()}
                onChange={() => {
                  setSelectedRowKeys(prev =>
                    prev.includes(record.id)
                      ? prev.filter(k => k !== record.id)
                      : [...prev, record.id]
                  );
                }}
                style={{ flexShrink: 0 }}
              />
            )}
            {actionCfg && (
              <Tag color={actionCfg.color} style={{ margin: 0, flexShrink: 0 }}>{actionCfg.label}</Tag>
            )}
            <span style={{ fontWeight: 600, fontSize: 14 }}>{resourceLabel}</span>
            {displayName && (
              <span style={{ color: '#1677ff', fontSize: 13, flexShrink: 0 }}>({displayName})</span>
            )}
          </div>
          <span style={{ fontSize: 12, color: '#999', flexShrink: 0 }}>
            {formatTime(record.created_at, true)}
          </span>
        </div>
        {/* Row 2: operator + tenant (super admin) */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, fontSize: 12, color: '#888', marginBottom: expanded ? 8 : 0 }}>
          <span>{record.user_name}</span>
          {isSuperAdmin && record.tenant?.name && (
            <Tag color="geekblue" style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}>
              {record.tenant.name}
            </Tag>
          )}
          {hasDetail && !expanded && (
            <span style={{ color: '#1677ff', marginLeft: 4 }}>展开详情</span>
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
            {canDelete && (
              <Button
                icon={mobileSelecting ? <CloseOutlined /> : <CheckSquareOutlined />}
                onClick={() => {
                  setMobileSelecting(prev => !prev);
                  if (mobileSelecting) setSelectedRowKeys([]);
                }}
              >
                {mobileSelecting ? '取消' : '选择'}
              </Button>
            )}
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
            <div style={{ textAlign: 'center', paddingTop: mobileSelecting ? 60 : 12 }}>
              <Pagination
                current={params.page}
                pageSize={params.size}
                total={total}
                size="small"
                simple
                onChange={(page, pageSize) => {
                  setParams(prev => ({ ...prev, page, size: pageSize }));
                  setExpandedIds(new Set());
                  setSelectedRowKeys([]);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </div>
          )}
          {/* Floating batch action bar */}
          {mobileSelecting && (
            <div style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              background: '#fff',
              borderTop: '1px solid #f0f0f0',
              padding: '10px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              zIndex: 100,
              boxShadow: '0 -2px 8px rgba(0,0,0,0.08)',
            }}>
              <Checkbox
                checked={data.length > 0 && selectedRowKeys.length === data.length}
                indeterminate={selectedRowKeys.length > 0 && selectedRowKeys.length < data.length}
                onChange={(e) => {
                  setSelectedRowKeys(e.target.checked ? data.map(d => d.id) : []);
                }}
              >
                全选
              </Checkbox>
              <Popconfirm
                title={`确定删除选中的 ${selectedRowKeys.length} 条日志？`}
                onConfirm={handleBatchDelete}
                okText="删除"
                cancelText="取消"
                disabled={selectedRowKeys.length === 0}
              >
                <Button
                  danger
                  type="primary"
                  icon={<DeleteOutlined />}
                  disabled={selectedRowKeys.length === 0}
                >
                  删除 ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            </div>
          )}
        </>
      ) : (
        <>
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
            rowExpandable: (record) => hasExpandableDetail(record),
          }}
          pagination={{
            current: params.page,
            pageSize: params.size,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条记录`,
            onChange: (page, pageSize) => {
              setParams((prev) => ({ ...prev, page, size: pageSize }));
              setSelectedRowKeys([]);
            },
          }}
          locale={{
            emptyText: '暂无操作日志',
          }}
        />
        {hasHiddenColumns && <HiddenColumnsHint titles={hiddenColumnTitles} onRestoreAll={restoreAll} />}
        </>
      )}
    </Card>
  );
}
