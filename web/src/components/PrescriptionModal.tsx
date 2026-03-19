import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Modal,
  Tabs,
  Form,
  Input,
  InputNumber,
  Button,
  Table,
  Space,
  Select,
  AutoComplete,
  message,
  Tag,
} from 'antd';
import { PlusOutlined, DeleteOutlined, SearchOutlined, InfoCircleOutlined } from '@ant-design/icons';
import HerbDetailModal from './HerbDetailModal';
import { listInventoryDrugs } from '../api/inventory';
import type { InventoryDrug } from '../api/inventory';
import { listFormulas } from '../api/formula';
import type { FormulaItem, FormulaCompositionItem } from '../api/formula';
import {
  createPrescription,
  updatePrescription,
} from '../api/prescription';
import type {
  PrescriptionItemReq,
  PrescriptionData,
} from '../api/prescription';
import useIsMobile from '../hooks/useIsMobile';

interface PrescriptionModalProps {
  open: boolean;
  recordId: number;
  editData?: PrescriptionData | null;
  onClose: () => void;
  onSuccess: (prescriptionId: number) => void;
}

interface HerbRow {
  key: number;
  herb_name: string;
  dosage: string;
  notes: string;
}

interface PatentRow {
  key: number;
  name: string;
  effects: string;
  indications: string;
  stock: number | null;
  needed_quantity: string;
  notes: string;
}

const DEFAULT_PRESCRIPTION_NOTES = `注意事项：
1. 每副药用【不锈钢】的汤锅，放9碗水，共约1800毫升水，中大火煮50分钟左右，一次性煮成两份药，两份药共约400毫升，每份200毫升。
2. 每天早晚饭前30分钟，分别温服一份。
3. 要用明火，不能用电煮药。
4. 如果不小心熬干了，中间加开水，后续适当调节加水量。
5. 服药期间，忌酒、烟，饮食上减少过于油腻食物。`;

/** 解析剂量字符串：支持阿拉伯数字 + 中文数字+古代单位(经方: 1两≈3g, 1钱≈3g, 1分≈0.3g) */
function parseDosage(raw: string): string {
  if (!raw) return '';
  // 优先提取阿拉伯数字
  const m = raw.match(/[\d.]+/);
  if (m) return m[0];
  // 中文数字映射
  const CN: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  };
  // 单位换算 (经方常用临床换算)
  const UNIT: Record<string, number> = {
    '两': 3, '钱': 3, '分': 0.3,
    '克': 1, '枚': 1, '个': 1, '升': 200, '合': 20,
  };
  // 查找单位
  let factor = 1;
  let numPart = raw.trim();
  for (const [u, f] of Object.entries(UNIT)) {
    const idx = numPart.lastIndexOf(u);
    if (idx > 0) { // 单位不在首位
      factor = f;
      const after = numPart.slice(idx + 1);
      numPart = numPart.slice(0, idx);
      if (after.includes('半')) numPart += '半'; // "一两半" → numPart="一半"
      break;
    }
    if (idx === 0 && u !== '两') continue; // "分寸" 等不处理
    if (idx === 0 && numPart.length === 1) { // 独立 "两" = 不明确，跳过
      continue;
    }
  }
  // 解析中文数字
  let num = 0;
  for (const c of numPart) {
    if (c === '十') {
      num = num === 0 ? 10 : num * 10;
    } else if (c === '半') {
      num += 0.5;
    } else if (c in CN) {
      if (num >= 10 && num % 10 === 0) num += CN[c]; // 十二 = 12
      else num = CN[c];
    }
  }
  if (num <= 0) return '';
  const result = Math.round(num * factor * 10) / 10;
  return String(result);
}

function initHerbRows(editData?: PrescriptionData | null): HerbRow[] {
  if (!editData?.items) return [{ key: 0, herb_name: '', dosage: '', notes: '' }];
  const herbItems = editData.items.filter((i) => !i.category || i.category === 'herb');
  if (herbItems.length === 0) return [{ key: 0, herb_name: '', dosage: '', notes: '' }];
  return herbItems.map((item, idx) => ({
    key: idx,
    herb_name: item.herb_name,
    dosage: parseDosage(item.dosage),
    notes: item.notes || '',
  }));
}

function initPatentRows(editData?: PrescriptionData | null): PatentRow[] {
  if (!editData?.items) return [];
  const patentItems = editData.items.filter((i) => i.category === 'patent');
  return patentItems.map((item, idx) => ({
    key: idx,
    name: item.herb_name,
    effects: '',
    indications: '',
    stock: null,
    needed_quantity: parseDosage(item.dosage),
    notes: item.notes || '',
  }));
}

export default function PrescriptionModal({
  open,
  recordId,
  editData,
  onClose,
  onSuccess,
}: PrescriptionModalProps) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const isMobile = useIsMobile();
  const [herbRows, setHerbRows] = useState<HerbRow[]>(() => initHerbRows(editData));
  const [nextKey, setNextKey] = useState(() => {
    const herbCount = editData?.items?.filter((i) => !i.category || i.category === 'herb').length || 1;
    return herbCount;
  });
  const [herbDetailOpen, setHerbDetailOpen] = useState(false);
  const [herbDetailName, setHerbDetailName] = useState('');

  // Patent medicine rows
  const [patentRows, setPatentRows] = useState<PatentRow[]>(() => initPatentRows(editData));
  const [patentNextKey, setPatentNextKey] = useState(() => {
    const patentCount = editData?.items?.filter((i) => i.category === 'patent').length || 0;
    return patentCount;
  });

  // Inventory stock lookup
  const [inventoryMap, setInventoryMap] = useState<Record<string, InventoryDrug>>({});
  const inventoryMapRef = useRef<Record<string, InventoryDrug>>({});
  const watchedTotalDoses = Form.useWatch('total_doses', form);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await listInventoryDrugs({ size: 9999 });
        const body = res as unknown as { data: { list: InventoryDrug[] } };
        const drugs = body.data?.list || [];
        const map: Record<string, InventoryDrug> = {};
        drugs.forEach((d) => { map[d.name] = d; });
        setInventoryMap(map);
        inventoryMapRef.current = map;
      } catch { /* ignore */ }
    })();
  }, [open]);

  // Formula search state
  const [formulaOptions, setFormulaOptions] = useState<FormulaItem[]>([]);
  const [formulaLoading, setFormulaLoading] = useState(false);
  const [selectedFormula, setSelectedFormula] = useState<FormulaItem | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 编辑模式：根据方剂名加载方剂详情（功效/主治/备注）
  useEffect(() => {
    if (open && editData?.formula_name && !selectedFormula) {
      (async () => {
        try {
          const res = await listFormulas({ name: editData.formula_name, page: 1, size: 10 });
          const body = res as unknown as { data: { list: FormulaItem[]; total: number } };
          const list = body.data.list || [];
          const match = list.find((f) => f.name === editData.formula_name);
          if (match) {
            setSelectedFormula(match);
          }
        } catch {
          // ignore
        }
      })();
    }
  }, [open, editData?.formula_name]); // eslint-disable-line react-hooks/exhaustive-deps

  // 编辑模式：补充中成药行的功效/主治信息（使用函数式更新避免覆盖库存数据）
  useEffect(() => {
    if (!open || patentRows.length === 0) return;
    const rowsNeedingUpdate = patentRows.filter((r) => r.name && !r.effects && !r.indications);
    if (rowsNeedingUpdate.length === 0) return;
    (async () => {
      const updates: Record<number, { effects: string; indications: string }> = {};
      for (const row of rowsNeedingUpdate) {
        try {
          const res = await listFormulas({ name: row.name, page: 1, size: 5 });
          const body = res as unknown as { data: { list: FormulaItem[] } };
          const match = (body.data.list || []).find((f) => f.name === row.name);
          if (match) {
            updates[row.key] = { effects: match.effects || '', indications: match.indications || '' };
          }
        } catch { /* ignore */ }
      }
      if (Object.keys(updates).length > 0) {
        setPatentRows((prev) => prev.map((r) => {
          const update = updates[r.key];
          return update ? { ...r, ...update } : r;
        }));
      }
    })();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // 渲染时从 inventoryMap 实时读取库存（消除竞态）
  const getPatentStock = (name?: string): number | null => {
    if (!name?.trim()) return null;
    const inv = inventoryMap[name.trim()];
    return inv ? inv.stock : null;
  };

  const searchFormulas = useCallback(async (name: string) => {
    if (!name) return;
    setFormulaLoading(true);
    try {
      const res = await listFormulas({ name, page: 1, size: 10 });
      const body = res as unknown as {
        data: { list: FormulaItem[]; total: number };
      };
      setFormulaOptions(body.data.list || []);
    } catch {
      // handled by interceptor
    } finally {
      setFormulaLoading(false);
    }
  }, []);

  const handleFormulaSearch = (value: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      searchFormulas(value);
    }, 300);
  };

  const handleFormulaSelect = (formulaId: number) => {
    const formula = formulaOptions.find((f) => f.id === formulaId);
    if (!formula) return;

    setSelectedFormula(formula);
    form.setFieldValue('formula_name', formula.name);

    // 如果方剂有备注，追加到医嘱末尾
    if (formula.notes && formula.notes.trim()) {
      const currentNotes: string = form.getFieldValue('notes') || '';
      const separator = currentNotes.trim() ? '\n6. ' : '';
      form.setFieldValue('notes', currentNotes.trimEnd() + separator + formula.notes.trim());
    }

    const newRows: HerbRow[] = (formula.composition || []).map(
      (c: FormulaCompositionItem, idx: number) => ({
        key: idx,
        herb_name: c.herb_name,
        dosage: parseDosage(c.default_dosage),
        notes: '',
      })
    );
    setHerbRows(newRows.length > 0 ? newRows : [{ key: 0, herb_name: '', dosage: '', notes: '' }]);
    setNextKey(newRows.length > 0 ? newRows.length : 1);
  };

  // Duplicate highlight state: "herb-3" or "patent-5" to avoid cross-table collision
  const [duplicateHighlightTag, setDuplicateHighlightTag] = useState<string | null>(null);
  const duplicateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patentSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Block submit when onBlur just found a duplicate (blur fires before click)
  const validationBlockRef = useRef(false);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (duplicateTimerRef.current) clearTimeout(duplicateTimerRef.current);
      if (patentSearchTimerRef.current) clearTimeout(patentSearchTimerRef.current);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);

  const highlightRow = (tag: string) => {
    setDuplicateHighlightTag(tag);
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      const el = document.querySelector(`[data-dup-tag="${tag}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
    if (duplicateTimerRef.current) clearTimeout(duplicateTimerRef.current);
    duplicateTimerRef.current = setTimeout(() => setDuplicateHighlightTag(null), 3000);
  };

  const flashDuplicateRow = (tag: string, name: string) => {
    message.warning({ content: `「${name}」已存在，已定位到该药物`, style: { marginTop: isMobile ? '40vh' : undefined } });
    highlightRow(tag);
  };

  const checkHerbDuplicate = (key: number, name: string) => {
    if (!name.trim()) return;
    const dup = herbRows.find((r) => r.key !== key && r.herb_name.trim() === name.trim());
    if (!dup) return;
    setHerbRows((prev) => prev.map((r) => (r.key === key ? { ...r, herb_name: '' } : r)));
    validationBlockRef.current = true;
    flashDuplicateRow(`herb-${dup.key}`, name.trim());
  };

  const checkPatentDuplicate = (key: number, name: string) => {
    if (!name.trim()) return;
    const dup = patentRows.find((r) => r.key !== key && r.name.trim() === name.trim());
    if (!dup) return;
    setPatentRows((prev) => prev.map((r) => (r.key === key ? { ...r, name: '' } : r)));
    validationBlockRef.current = true;
    flashDuplicateRow(`patent-${dup.key}`, name.trim());
  };

  const addHerbRow = () => {
    setHerbRows([...herbRows, { key: nextKey, herb_name: '', dosage: '', notes: '' }]);
    setNextKey(nextKey + 1);
  };

  const removeHerbRow = (key: number) => {
    const updated = herbRows.filter((r) => r.key !== key);
    setHerbRows(updated.length > 0 ? updated : [{ key: nextKey, herb_name: '', dosage: '', notes: '' }]);
    if (updated.length === 0) setNextKey(nextKey + 1);
  };

  const updateHerbRow = (key: number, field: keyof HerbRow, value: string) => {
    if (field === 'herb_name') validationBlockRef.current = false;
    setHerbRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  };

  // --- Patent medicine handlers ---
  const [patentSearchOptions, setPatentSearchOptions] = useState<{ value: string; label: string; effects?: string; indications?: string; stockVal?: number | null }[]>([]);

  const addPatentRow = () => {
    setPatentRows([...patentRows, { key: patentNextKey, name: '', effects: '', indications: '', stock: null, needed_quantity: '1', notes: '' }]);
    setPatentNextKey(patentNextKey + 1);
  };

  const removePatentRow = (key: number) => {
    setPatentRows(patentRows.filter((r) => r.key !== key));
  };

  const updatePatentRow = (key: number, field: keyof PatentRow, value: string | number | null) => {
    if (field === 'name') validationBlockRef.current = false;
    setPatentRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  };

  const handlePatentNameSearch = (key: number, name: string) => {
    updatePatentRow(key, 'name', name);
    if (patentSearchTimerRef.current) clearTimeout(patentSearchTimerRef.current);
    if (!name.trim()) {
      setPatentSearchOptions([]);
      return;
    }
    patentSearchTimerRef.current = setTimeout(async () => {
      const results = new Map<string, { effects: string; indications: string; stock: number | null }>();

      // Search inventory drugs (local, instant)
      const keyword = name.trim().toLowerCase();
      Object.values(inventoryMapRef.current).forEach((inv) => {
        if (inv.name.toLowerCase().includes(keyword)) {
          results.set(inv.name, { effects: '', indications: '', stock: inv.stock });
        }
      });

      // Search formula database (remote)
      try {
        const res = await listFormulas({ name: name.trim(), page: 1, size: 10 });
        const body = res as unknown as { data: { list: FormulaItem[] } };
        (body.data.list || []).forEach((f) => {
          const existing = results.get(f.name);
          if (existing) {
            existing.effects = f.effects || '';
            existing.indications = f.indications || '';
          } else {
            const inv = inventoryMapRef.current[f.name];
            results.set(f.name, { effects: f.effects || '', indications: f.indications || '', stock: inv ? inv.stock : null });
          }
        });
      } catch { /* ignore */ }

      // Build options for AutoComplete
      const options = Array.from(results.entries()).map(([drugName, info]) => ({
        value: drugName,
        label: drugName,
        effects: info.effects,
        indications: info.indications,
        stockVal: info.stock,
      }));
      setPatentSearchOptions(options);

      // Update current row stock
      const inv = inventoryMapRef.current[name.trim()];
      setPatentRows((prev) =>
        prev.map((r) => r.key === key ? { ...r, stock: inv ? inv.stock : null } : r)
      );
    }, 300);
  };

  const handlePatentSelect = (key: number, value: string) => {
    const opt = patentSearchOptions.find((o) => o.value === value);
    const inv = inventoryMapRef.current[value];
    const existing = patentRows.find((r) => r.key !== key && r.name.trim() === value.trim());
    if (existing) {
      setPatentRows((prev) => prev.map((r) => r.key === key ? { ...r, name: '' } : r));
      flashDuplicateRow(`patent-${existing.key}`, value.trim());
    } else {
      setPatentRows((prev) => prev.map((r) => r.key === key ? {
        ...r,
        name: value,
        effects: opt?.effects || '',
        indications: opt?.indications || '',
        stock: inv ? inv.stock : null,
      } : r));
    }
    setPatentSearchOptions([]);
  };

  const handleSubmit = async () => {
    // Block if onBlur/onSelect just detected a duplicate (blur fires before click)
    const wasBlocked = validationBlockRef.current;
    validationBlockRef.current = false;
    if (wasBlocked) return;
    try {
      const values = await form.validateFields();
      const validHerbs = herbRows.filter((r) => r.herb_name.trim());
      const validPatents = patentRows.filter((r) => r.name.trim());

      // Duplicate check first (more severe issue)
      const herbNames = validHerbs.map((r) => r.herb_name.trim());
      const herbDup = herbNames.find((n, i) => herbNames.indexOf(n) !== i);
      if (herbDup) {
        const first = validHerbs.find((r) => r.herb_name.trim() === herbDup);
        setHerbRows((prev) => {
          let kept = false;
          return prev.map((r) => {
            if (r.herb_name.trim() !== herbDup) return r;
            if (!kept) { kept = true; return r; }
            return { ...r, herb_name: '' };
          });
        });
        if (first) flashDuplicateRow(`herb-${first.key}`, herbDup);
        return;
      }
      const patentNames = validPatents.map((r) => r.name.trim());
      const patentDup = patentNames.find((n, i) => patentNames.indexOf(n) !== i);
      if (patentDup) {
        const first = validPatents.find((r) => r.name.trim() === patentDup);
        setPatentRows((prev) => {
          let kept = false;
          return prev.map((r) => {
            if (r.name.trim() !== patentDup) return r;
            if (!kept) { kept = true; return r; }
            return { ...r, name: '' };
          });
        });
        if (first) flashDuplicateRow(`patent-${first.key}`, patentDup);
        return;
      }

      // Zero dosage check
      const zeroDosageHerb = validHerbs.find((r) => !r.dosage.trim() || Number(r.dosage) <= 0);
      if (zeroDosageHerb) {
        message.warning({ content: `「${zeroDosageHerb.herb_name}」用量为0，请填写用量`, style: { marginTop: isMobile ? '40vh' : undefined } });
        highlightRow(`herb-${zeroDosageHerb.key}`);
        return;
      }
      const zeroQtyPatent = validPatents.find((r) => !r.needed_quantity.trim() || Number(r.needed_quantity) <= 0);
      if (zeroQtyPatent) {
        message.warning({ content: `「${zeroQtyPatent.name}」数量为0，请填写数量`, style: { marginTop: isMobile ? '40vh' : undefined } });
        highlightRow(`patent-${zeroQtyPatent.key}`);
        return;
      }

      setSubmitting(true);

      const herbItems: PrescriptionItemReq[] = validHerbs.map((r, idx) => ({
        herb_name: r.herb_name.trim(),
        dosage: r.dosage.trim(),
        sort_order: idx,
        notes: r.notes.trim(),
        category: 'herb' as const,
      }));

      const patentItems: PrescriptionItemReq[] = validPatents.map((r, idx) => ({
        herb_name: r.name.trim(),
        dosage: r.needed_quantity.trim(),
        sort_order: herbItems.length + idx,
        notes: r.notes.trim(),
        category: 'patent' as const,
      }));

      const items = [...herbItems, ...patentItems];

      let savedPrescriptionId: number;

      if (editData) {
        await updatePrescription(editData.id, {
          formula_name: values.formula_name || '',
          total_doses: values.total_doses || 7,
          notes: values.notes || '',
          items,
        });
        savedPrescriptionId = editData.id;
        message.success('处方更新成功');
      } else {
        const res = await createPrescription({
          record_id: recordId,
          formula_name: values.formula_name || '',
          total_doses: values.total_doses || 7,
          notes: values.notes || '',
          items,
        });
        const body = res as unknown as { data: { id: number } };
        savedPrescriptionId = body.data?.id || 0;
        message.success('处方创建成功');
      }

      onSuccess(savedPrescriptionId);
      onClose();
    } catch {
      // validation error
    } finally {
      setSubmitting(false);
    }
  };

  const renderStockHint = (row: HerbRow): React.ReactNode => {
    const inv = inventoryMap[row.herb_name?.trim()];
    const unit = inv ? (inv.category === 'herb' ? '克' : '盒') : '';
    const totalDoses = watchedTotalDoses || 7;
    const dosageNum = row.dosage ? Number(row.dosage) || 0 : 0;
    const needed = totalDoses * dosageNum;

    if (!row.herb_name?.trim()) return null;

    if (inv) {
      if (needed > 0) {
        return inv.stock < needed
          ? <span style={{ fontSize: 11, color: '#ff4d4f' }}>库存不足: 需{needed}{unit}, 库存{inv.stock}{unit}</span>
          : <span style={{ fontSize: 11, color: '#52c41a' }}>库存充足: 需{needed}{unit}, 库存{inv.stock}{unit}</span>;
      }
      return <span style={{ fontSize: 11, color: '#999' }}>库存: {inv.stock}{unit}</span>;
    }
    return <span style={{ fontSize: 11, color: '#999' }}>未录入库存</span>;
  };

  const herbColumns = [
    {
      title: '药名',
      dataIndex: 'herb_name',
      key: 'herb_name',
      render: (_: string, record: HerbRow) => {
        return (
          <div>
            <Space>
              <Input value={record.herb_name} onChange={(e) => updateHerbRow(record.key, 'herb_name', e.target.value)} onBlur={(e) => checkHerbDuplicate(record.key, e.target.value)} placeholder="药名" />
              <Button type="text" size="small" icon={<InfoCircleOutlined />}
                onClick={() => { if (record.herb_name.trim()) { setHerbDetailName(record.herb_name.trim()); setHerbDetailOpen(true); } }}
                disabled={!record.herb_name.trim()} />
            </Space>
            {renderStockHint(record) && <div style={{ marginTop: 2 }}>{renderStockHint(record)}</div>}
          </div>
        );
      },
    },
    {
      title: '用量',
      dataIndex: 'dosage',
      key: 'dosage',
      width: 140,
      render: (_: string, record: HerbRow) => (
        <Space.Compact>
          <InputNumber
            value={record.dosage ? Number(record.dosage) || undefined : undefined}
            onChange={(val) => updateHerbRow(record.key, 'dosage', val != null ? String(val) : '')}
            placeholder="用量"
            min={0}
            max={999}
            style={{ width: 80 }}
          />
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 8px', background: '#fafafa', border: '1px solid #d9d9d9', borderLeft: 'none', borderRadius: '0 6px 6px 0', color: '#666', fontSize: 14 }}>克</span>
        </Space.Compact>
      ),
    },
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      width: 150,
      render: (_: string, record: HerbRow) => (
        <Input
          value={record.notes}
          onChange={(e) => updateHerbRow(record.key, 'notes', e.target.value)}
          placeholder="先煎/后下等"
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 60,
      render: (_: unknown, record: HerbRow) => (
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => removeHerbRow(record.key)}
        />
      ),
    },
  ];

  const patentColumns = [
    {
      title: '中成药名',
      dataIndex: 'name',
      key: 'name',
      render: (_: string, record: PatentRow) => {
        const qty = record.needed_quantity ? Number(record.needed_quantity) || 0 : 0;
        const stockVal = getPatentStock(record.name);
        return (
          <div>
            <AutoComplete
              value={record.name}
              options={patentSearchOptions}
              onSearch={(val) => handlePatentNameSearch(record.key, val)}
              onSelect={(val) => handlePatentSelect(record.key, val)}
              onChange={(val) => updatePatentRow(record.key, 'name', val)}
              onBlur={(e) => checkPatentDuplicate(record.key, (e.target as HTMLInputElement).value)}
              placeholder="搜索中成药名称"
              style={{ width: '100%' }}
              optionRender={(option) => (
                <div>
                  <div style={{ fontWeight: 500 }}>{option.data.value}</div>
                  <div style={{ fontSize: 11, color: '#888', display: 'flex', gap: 8 }}>
                    {option.data.effects && <span>功效：{(option.data.effects as string).length > 15 ? (option.data.effects as string).slice(0, 15) + '...' : option.data.effects}</span>}
                    {option.data.stockVal != null ? (
                      <span style={{ color: (option.data.stockVal as number) > 0 ? '#52c41a' : '#ff4d4f' }}>库存：{option.data.stockVal}盒</span>
                    ) : (
                      <span style={{ color: '#999' }}>未录入库存</span>
                    )}
                  </div>
                </div>
              )}
            />
            {(record.effects || record.name?.trim()) && (
              <div style={{ fontSize: 11, marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '2px 8px', lineHeight: '18px' }}>
                {record.effects && (
                  <span style={{ color: '#888' }}>功效：{record.effects.length > 20 ? record.effects.slice(0, 20) + '...' : record.effects}</span>
                )}
                {record.name?.trim() && (
                  stockVal != null ? (
                    qty > 0 ? (
                      stockVal >= qty
                        ? <span style={{ color: '#52c41a' }}>库存充足：需{qty}盒, 库存{stockVal}盒</span>
                        : <span style={{ color: '#ff4d4f' }}>库存不足：需{qty}盒, 库存{stockVal}盒</span>
                    ) : (
                      <span style={{ color: '#999' }}>库存：{stockVal}盒</span>
                    )
                  ) : (
                    <span style={{ color: '#999' }}>未录入库存</span>
                  )
                )}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: '数量',
      dataIndex: 'needed_quantity',
      key: 'needed_quantity',
      width: 120,
      onCell: () => ({ style: { verticalAlign: 'top', paddingTop: 12 } }),
      render: (_: string, record: PatentRow) => (
        <Space.Compact>
          <InputNumber
            value={record.needed_quantity ? Number(record.needed_quantity) || undefined : undefined}
            onChange={(val) => updatePatentRow(record.key, 'needed_quantity', val != null ? String(val) : '')}
            placeholder="数量"
            min={0}
            max={999}
            style={{ width: 70 }}
          />
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 6px', background: '#fafafa', border: '1px solid #d9d9d9', borderLeft: 'none', borderRadius: '0 6px 6px 0', color: '#666', fontSize: 13 }}>盒</span>
        </Space.Compact>
      ),
    },
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      width: 130,
      onCell: () => ({ style: { verticalAlign: 'top', paddingTop: 12 } }),
      render: (_: string, record: PatentRow) => (
        <Input
          value={record.notes}
          onChange={(e) => updatePatentRow(record.key, 'notes', e.target.value)}
          placeholder="备注"
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 60,
      onCell: () => ({ style: { verticalAlign: 'top', paddingTop: 12 } }),
      render: (_: unknown, record: PatentRow) => (
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => removePatentRow(record.key)}
        />
      ),
    },
  ];

  // --- Patent medicine mobile card ---
  const renderPatentMobileCard = (row: PatentRow) => {
    const qty = row.needed_quantity ? Number(row.needed_quantity) || 0 : 0;
    const stockVal = getPatentStock(row.name);
    return (
      <div key={row.key} data-dup-tag={`patent-${row.key}`} className={duplicateHighlightTag === `patent-${row.key}` ? 'duplicate-highlight' : ''} style={{ background: '#f0f5ff', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <AutoComplete
            value={row.name}
            options={patentSearchOptions}
            onSearch={(val) => handlePatentNameSearch(row.key, val)}
            onSelect={(val) => handlePatentSelect(row.key, val)}
            onChange={(val) => updatePatentRow(row.key, 'name', val)}
            onBlur={(e) => checkPatentDuplicate(row.key, (e.target as HTMLInputElement).value)}
            placeholder="搜索中成药名称"
            style={{ flex: 1 }}
            optionRender={(option) => (
              <div>
                <div style={{ fontWeight: 500 }}>{option.data.value}</div>
                <div style={{ fontSize: 11, color: '#888', display: 'flex', gap: 8 }}>
                  {option.data.effects && <span>功效：{(option.data.effects as string).length > 15 ? (option.data.effects as string).slice(0, 15) + '...' : option.data.effects}</span>}
                  {option.data.stockVal != null ? (
                    <span style={{ color: (option.data.stockVal as number) > 0 ? '#52c41a' : '#ff4d4f' }}>库存：{option.data.stockVal}盒</span>
                  ) : (
                    <span style={{ color: '#999' }}>未录入库存</span>
                  )}
                </div>
              </div>
            )}
          />
          <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removePatentRow(row.key)} />
        </div>
        {(row.effects || row.indications) && (
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
            {row.effects && <span>功效：{row.effects.length > 30 ? row.effects.slice(0, 30) + '...' : row.effects}</span>}
            {row.effects && row.indications && <span> | </span>}
            {row.indications && <span>主治：{row.indications.length > 30 ? row.indications.slice(0, 30) + '...' : row.indications}</span>}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <Space.Compact style={{ flexShrink: 0 }}>
            <InputNumber
              value={row.needed_quantity ? Number(row.needed_quantity) || undefined : undefined}
              onChange={(val) => updatePatentRow(row.key, 'needed_quantity', val != null ? String(val) : '')}
              placeholder="数量"
              min={0} max={999}
              style={{ width: 70 }}
            />
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 6px', background: '#fafafa', border: '1px solid #d9d9d9', borderLeft: 'none', borderRadius: '0 6px 6px 0', color: '#666', fontSize: 13 }}>盒</span>
          </Space.Compact>
          <Input
            value={row.notes}
            onChange={(e) => updatePatentRow(row.key, 'notes', e.target.value)}
            placeholder="备注"
            style={{ flex: 1 }}
          />
        </div>
        {row.name?.trim() && (
          <div style={{ marginTop: 4, fontSize: 11 }}>
            {stockVal != null ? (
              qty > 0 ? (
                stockVal >= qty
                  ? <span style={{ color: '#52c41a' }}>库存充足：需{qty}盒, 库存{stockVal}盒</span>
                  : <span style={{ color: '#ff4d4f' }}>库存不足：需{qty}盒, 库存{stockVal}盒</span>
              ) : (
                <span style={{ color: '#999' }}>库存：{stockVal}盒</span>
              )
            ) : (
              <span style={{ color: '#999' }}>未录入库存</span>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Modal
      title={editData ? '编辑处方' : '开方'}
      open={open}
      onOk={handleSubmit}
      onCancel={onClose}
      confirmLoading={submitting}
      okText="保存"
      cancelText="取消"
      width={isMobile ? '100%' : 700}
      destroyOnClose
    >
      <Tabs
        defaultActiveKey="formula"
        items={[
          {
            key: 'formula',
            label: '按方开药',
            children: (
              <div style={{ marginBottom: 16 }}>
                <Space.Compact style={{ width: '100%' }}>
                  <Select
                    showSearch
                    placeholder="搜索方剂名称"
                    filterOption={false}
                    onSearch={handleFormulaSearch}
                    loading={formulaLoading}
                    style={{ width: '100%' }}
                    onSelect={handleFormulaSelect}
                    optionLabelProp="label"
                    options={formulaOptions.map((f) => ({
                      value: f.id,
                      label: f.name,
                      desc: [f.effects, f.indications].filter(Boolean).join(' | '),
                    }))}
                    optionRender={(option) => (
                      <div>
                        <div style={{ fontWeight: 500 }}>{option.label}</div>
                        {option.data.desc && (
                          <div style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {option.data.desc}
                          </div>
                        )}
                      </div>
                    )}
                    notFoundContent={formulaLoading ? '搜索中...' : '输入方剂名搜索'}
                    suffixIcon={<SearchOutlined />}
                  />
                </Space.Compact>
                {selectedFormula && (selectedFormula.effects || selectedFormula.indications || selectedFormula.notes) && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: '8px 12px',
                      background: '#fafbfc',
                      borderRadius: 8,
                      border: '1px solid #e8e8e8',
                      display: 'flex',
                      gap: 24,
                      flexWrap: 'wrap',
                      fontSize: 13,
                      lineHeight: '20px',
                    }}
                  >
                    {selectedFormula.effects && (
                      <span><span style={{ fontWeight: 500, color: '#555' }}>功效：</span><span style={{ color: '#333' }}>{selectedFormula.effects}</span></span>
                    )}
                    {selectedFormula.indications && (
                      <span><span style={{ fontWeight: 500, color: '#555' }}>主治：</span><span style={{ color: '#333' }}>{selectedFormula.indications}</span></span>
                    )}
                    {selectedFormula.notes && (
                      <span><span style={{ fontWeight: 500, color: '#555' }}>备注：</span><span style={{ color: '#333' }}>{selectedFormula.notes}</span></span>
                    )}
                  </div>
                )}
                <p style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
                  选择方剂后将自动填充药物列表，您可以调整剂量
                </p>
              </div>
            ),
          },
          {
            key: 'free',
            label: '自由开方',
            children: (
              <p style={{ color: '#888', fontSize: 12 }}>
                在下方药物列表中直接添加药物和剂量
              </p>
            ),
          },
        ]}
      />

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          formula_name: editData?.formula_name || '',
          total_doses: editData?.total_doses || 7,
          notes: editData?.notes ?? DEFAULT_PRESCRIPTION_NOTES,
        }}
      >
        <Form.Item label="方剂名" name="formula_name">
          <Input placeholder="方剂名称（可选）" />
        </Form.Item>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong>药物列表</strong>
            {!isMobile && <Button type="dashed" icon={<PlusOutlined />} onClick={addHerbRow} size="small">添加药物</Button>}
          </div>
          {isMobile ? (
            <div>
              {herbRows.map((row) => {
                const stockHint = renderStockHint(row);
                return (
                  <div key={row.key} data-dup-tag={`herb-${row.key}`} className={duplicateHighlightTag === `herb-${row.key}` ? 'duplicate-highlight' : ''} style={{ background: '#fafafa', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                      <Input
                        value={row.herb_name}
                        onChange={(e) => updateHerbRow(row.key, 'herb_name', e.target.value)}
                        onBlur={(e) => checkHerbDuplicate(row.key, e.target.value)}
                        placeholder="药名"
                        style={{ flex: 1 }}
                      />
                      <Button type="text" size="small" icon={<InfoCircleOutlined />}
                        onClick={() => { if (row.herb_name.trim()) { setHerbDetailName(row.herb_name.trim()); setHerbDetailOpen(true); } }}
                        disabled={!row.herb_name.trim()} />
                      <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeHerbRow(row.key)} />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Space.Compact style={{ flexShrink: 0 }}>
                        <InputNumber
                          value={row.dosage ? Number(row.dosage) || undefined : undefined}
                          onChange={(val) => updateHerbRow(row.key, 'dosage', val != null ? String(val) : '')}
                          placeholder="用量"
                          min={0} max={999}
                          style={{ width: 70 }}
                        />
                        <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 6px', background: '#fafafa', border: '1px solid #d9d9d9', borderLeft: 'none', borderRadius: '0 6px 6px 0', color: '#666', fontSize: 13 }}>克</span>
                      </Space.Compact>
                      <Input
                        value={row.notes}
                        onChange={(e) => updateHerbRow(row.key, 'notes', e.target.value)}
                        placeholder="先煎/后下等"
                        style={{ flex: 1 }}
                      />
                    </div>
                    {stockHint && <div style={{ marginTop: 4 }}>{stockHint}</div>}
                  </div>
                );
              })}
              <Button type="dashed" block icon={<PlusOutlined />} onClick={addHerbRow} style={{ marginTop: 4 }}>添加药物</Button>
            </div>
          ) : (
            <>
            <Table
              dataSource={herbRows}
              columns={herbColumns}
              rowKey="key"
              pagination={false}
              size="small"
              bordered
              rowClassName={(record: HerbRow) => duplicateHighlightTag === `herb-${record.key}` ? 'duplicate-highlight' : ''}
              onRow={(record: HerbRow) => ({ 'data-dup-tag': `herb-${record.key}` } as React.HTMLAttributes<HTMLElement>)}
            />
            <Button type="dashed" block icon={<PlusOutlined />} onClick={addHerbRow} style={{ marginTop: 8 }}>添加药物</Button>
            </>
          )}
        </div>

        <Form.Item label="总付数" name="total_doses">
          <InputNumber min={1} max={99} style={{ width: 120 }} />
        </Form.Item>

        {/* Patent medicine section */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong>
              中成药 <Tag color="blue" style={{ marginLeft: 4 }}>成药</Tag>
            </strong>
            {!isMobile && <Button type="dashed" icon={<PlusOutlined />} onClick={addPatentRow} size="small">添加中成药</Button>}
          </div>
          {patentRows.length === 0 ? (
            <div
              style={{
                border: '1px dashed #d9d9d9',
                borderRadius: 8,
                padding: '16px 0',
                textAlign: 'center',
                color: '#999',
                cursor: 'pointer',
              }}
              onClick={addPatentRow}
            >
              <PlusOutlined style={{ marginRight: 4 }} />
              点击添加中成药
            </div>
          ) : isMobile ? (
            <div>
              {patentRows.map(renderPatentMobileCard)}
              <Button type="dashed" block icon={<PlusOutlined />} onClick={addPatentRow} style={{ marginTop: 4 }}>添加中成药</Button>
            </div>
          ) : (
            <>
            <Table
              dataSource={patentRows}
              columns={patentColumns}
              rowKey="key"
              pagination={false}
              size="small"
              bordered
              rowClassName={(record: PatentRow) => duplicateHighlightTag === `patent-${record.key}` ? 'duplicate-highlight' : ''}
              onRow={(record: PatentRow) => ({ 'data-dup-tag': `patent-${record.key}` } as React.HTMLAttributes<HTMLElement>)}
            />
            <Button type="dashed" block icon={<PlusOutlined />} onClick={addPatentRow} style={{ marginTop: 8 }}>添加中成药</Button>
            </>
          )}
        </div>

        <Form.Item label="注意事项/医嘱" name="notes">
          <Input.TextArea rows={6} placeholder="如：饭后服用、忌辛辣等" />
        </Form.Item>
      </Form>
      <HerbDetailModal
        open={herbDetailOpen}
        herbName={herbDetailName}
        onClose={() => setHerbDetailOpen(false)}
      />
    </Modal>
  );
}
