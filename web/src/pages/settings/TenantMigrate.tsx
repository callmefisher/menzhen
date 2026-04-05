import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Card, Steps, Button, Upload, Radio, List, InputNumber, Input,
  Alert, Space, Typography, Tag, Table, Spin, message, Modal, Result,
} from 'antd';
import {
  SwapOutlined, UploadOutlined, DatabaseOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd';
import useIsMobile from '../../hooks/useIsMobile';
import {
  uploadMigrateFile, parseMigrateFromBackup, getMigrateStatus, executeMigrate,
  listMigrateBackupFiles,
} from '../../api/tenantMigrate';
import type { MigrateTask, TenantTableCount, BackupFileItem } from '../../api/tenantMigrate';

const { Text } = Typography;
const { Dragger } = Upload;

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('zh-CN');
}

export default function TenantMigrate() {
  const isMobile = useIsMobile();
  const [step, setStep] = useState(0); // 0=选文件, 1=选诊所, 2=确认执行

  // ── Step 0: file source ──────────────────────────────────────────────────
  const [sourceMode, setSourceMode] = useState<'upload' | 'backup'>('upload');
  const [backupFiles, setBackupFiles] = useState<BackupFileItem[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [selectedBackupFile, setSelectedBackupFile] = useState('');
  const [uploading, setUploading] = useState(false);

  // ── Task / parse state ───────────────────────────────────────────────────
  const [taskId, setTaskId] = useState('');
  const [task, setTask] = useState<MigrateTask | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const termRef = useRef<HTMLDivElement>(null);

  // ── Step 1: tenant selection ─────────────────────────────────────────────
  const [selectedTenant, setSelectedTenant] = useState<TenantTableCount | null>(null);
  const [targetIdMode, setTargetIdMode] = useState<'keep' | 'custom'>('keep');
  const [targetId, setTargetId] = useState<number>(0);

  // ── Step 2: confirm ───────────────────────────────────────────────────────
  const [confirmInput, setConfirmInput] = useState('');
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Auto-scroll terminal.
  useEffect(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [task?.output]);

  // ── Polling ───────────────────────────────────────────────────────────────
  const startPolling = useCallback((tid: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = (await getMigrateStatus(tid)) as unknown as { code: number; data: MigrateTask };
        setTask(res.data);
        if (res.data.status !== 'parsing' && res.data.status !== 'running') {
          clearInterval(pollRef.current!);
          if (res.data.status === 'parsed') {
            setStep(1);
          } else if (res.data.status === 'success') {
            setExecuting(false);
          } else if (res.data.status === 'failed') {
            setExecuting(false);
            setUploading(false);
          }
        }
      } catch { /* ignore */ }
    }, 1500);
  }, []);

  // ── Load backup files when switching to backup mode ───────────────────────
  useEffect(() => {
    if (sourceMode !== 'backup') return;
    setBackupLoading(true);
    (listMigrateBackupFiles() as unknown as Promise<{ code: number; data: { files: BackupFileItem[] } }>)
      .then(res => setBackupFiles(res.data.files))
      .catch(() => message.error('获取备份文件列表失败'))
      .finally(() => setBackupLoading(false));
  }, [sourceMode]);

  // ── Upload handler ────────────────────────────────────────────────────────
  const handleUpload = useCallback(async (file: UploadFile) => {
    const raw = file.originFileObj ?? (file as unknown as File);
    setUploading(true);
    setTask(null);
    try {
      const res = (await uploadMigrateFile(raw as File)) as unknown as {
        code: number; data: { task_id: string; file_name: string };
      };
      setTaskId(res.data.task_id);
      setTask({ task_id: res.data.task_id, status: 'parsing', output: '', file_name: res.data.file_name, start_at: '' });
      startPolling(res.data.task_id);
    } catch {
      setUploading(false);
    }
    return false; // prevent antd default upload
  }, [startPolling]);

  // ── Parse from backup ─────────────────────────────────────────────────────
  const handleParseBackup = useCallback(async () => {
    if (!selectedBackupFile) { message.warning('请先选择备份文件'); return; }
    setUploading(true);
    setTask(null);
    try {
      const res = (await parseMigrateFromBackup(selectedBackupFile)) as unknown as {
        code: number; data: { task_id: string; file_name: string };
      };
      setTaskId(res.data.task_id);
      setTask({ task_id: res.data.task_id, status: 'parsing', output: '', file_name: res.data.file_name, start_at: '' });
      startPolling(res.data.task_id);
    } catch {
      setUploading(false);
    }
  }, [selectedBackupFile, startPolling]);

  // ── Tenant selection ──────────────────────────────────────────────────────
  const handleSelectTenant = useCallback((t: TenantTableCount) => {
    setSelectedTenant(t);
    setTargetIdMode('keep');
    setTargetId(t.tenant_id);
  }, []);

  const effectiveTargetId = targetIdMode === 'keep' ? (selectedTenant?.tenant_id ?? 0) : targetId;
  const confirmCode = selectedTenant
    ? `MIGRATE-${selectedTenant.tenant_id}-TO-${effectiveTargetId}`
    : '';
  const confirmValid = confirmInput === confirmCode && confirmCode !== '';

  // ── Execute ───────────────────────────────────────────────────────────────
  const doExecute = useCallback(async () => {
    if (!selectedTenant || !taskId) return;
    setExecuting(true);
    setConfirmInput('');
    try {
      await executeMigrate({
        task_id: taskId,
        source_tenant_id: selectedTenant.tenant_id,
        target_tenant_id: effectiveTargetId,
        confirm_code: confirmCode,
      });
      startPolling(taskId);
    } catch {
      setExecuting(false);
    }
  }, [selectedTenant, taskId, effectiveTargetId, confirmCode, startPolling]);

  const handleExecuteClick = useCallback(() => {
    Modal.confirm({
      title: '危险操作确认',
      icon: <ExclamationCircleOutlined />,
      content: `将清除目标诊所 ID=${effectiveTargetId} 的全部数据，写入源诊所 ID=${selectedTenant?.tenant_id} 的数据，此操作不可撤销！`,
      okText: '确认执行',
      okButtonProps: { danger: true },
      cancelText: '取消',
      centered: true,
      onOk: doExecute,
    });
  }, [effectiveTargetId, selectedTenant, doExecute]);

  // ── Reset ─────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setStep(0);
    setTask(null);
    setTaskId('');
    setSelectedTenant(null);
    setTargetId(0);
    setTargetIdMode('keep');
    setConfirmInput('');
    setExecuting(false);
    setUploading(false);
    setSelectedBackupFile('');
  }, []);

  // ── Terminal log panel ────────────────────────────────────────────────────
  const terminalPanel = task && (
    <div
      ref={termRef}
      style={{
        background: '#0d1117',
        border: '1px solid #2a3441',
        borderRadius: 6,
        padding: '10px 14px',
        fontFamily: 'monospace',
        fontSize: isMobile ? 10 : 11,
        lineHeight: 1.7,
        maxHeight: 160,
        overflowY: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        color: '#8b949e',
        marginTop: 12,
      }}
    >
      {task.output || '等待执行...'}
    </div>
  );

  // ── Step 0: Select File ───────────────────────────────────────────────────
  const step0 = (
    <div>
      <Alert
        type="info"
        showIcon
        message="仅恢复指定诊所的业务数据（患者/病历/处方/收费等），不影响其他诊所。适用于跨站点迁移单个诊所。"
        style={{ marginBottom: 16 }}
      />

      <div style={{ marginBottom: 12 }}>
        <Radio.Group
          value={sourceMode}
          onChange={e => { setSourceMode(e.target.value); setTask(null); setUploading(false); }}
          buttonStyle="solid"
          size="small"
        >
          <Radio.Button value="upload">上传本地 SQL 文件</Radio.Button>
          <Radio.Button value="backup">从现有备份选择</Radio.Button>
        </Radio.Group>
      </div>

      {sourceMode === 'upload' ? (
        <Dragger
          accept=".sql,.sql.gz"
          showUploadList={false}
          disabled={uploading}
          beforeUpload={(file) => { handleUpload(file as unknown as UploadFile); return false; }}
          style={{ marginBottom: 8 }}
        >
          <p style={{ fontSize: 28 }}>📂</p>
          <p>点击或拖拽 SQL / SQL.GZ 文件到此处</p>
          <p style={{ color: '#8b949e', fontSize: 12 }}>最大 500MB</p>
        </Dragger>
      ) : (
        <Spin spinning={backupLoading}>
          <List
            size="small"
            bordered
            dataSource={backupFiles}
            locale={{ emptyText: '暂无 SQL 备份文件' }}
            style={{ marginBottom: 12, maxHeight: 220, overflowY: 'auto' }}
            renderItem={item => (
              <List.Item
                key={item.filename}
                style={{
                  cursor: 'pointer',
                  background: selectedBackupFile === item.filename ? '#e6f7ff' : undefined,
                  padding: '8px 12px',
                }}
                onClick={() => setSelectedBackupFile(item.filename)}
              >
                <Radio checked={selectedBackupFile === item.filename} style={{ marginRight: 8 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text ellipsis style={{ display: 'block', fontSize: 12, fontFamily: 'monospace' }}>
                    {item.filename}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {formatSize(item.size)} · {formatTime(item.modified)}
                  </Text>
                </div>
              </List.Item>
            )}
          />
          <Button
            type="primary"
            disabled={!selectedBackupFile || uploading}
            loading={uploading}
            onClick={handleParseBackup}
          >
            解析选中文件
          </Button>
        </Spin>
      )}

      {task && (
        <div style={{ marginTop: 12 }}>
          {task.status === 'parsing' && (
            <Alert
              type="info"
              showIcon
              icon={<Spin size="small" />}
              message={`正在解析：${task.file_name}`}
            />
          )}
          {task.status === 'failed' && (
            <Alert type="error" showIcon message="解析失败，请检查文件格式" />
          )}
          {terminalPanel}
        </div>
      )}
    </div>
  );

  // ── Step 1: Select Tenant ─────────────────────────────────────────────────
  const tenants = task?.parse_result?.tenants ?? [];

  const tenantColumns = [
    {
      title: '诊所 ID',
      dataIndex: 'tenant_id',
      width: 90,
      render: (id: number) => (
        <Tag color="cyan" style={{ fontFamily: 'monospace' }}>{id}</Tag>
      ),
    },
    {
      title: '诊所名称',
      dataIndex: 'tenant_name',
      render: (name: string) => name || <Text type="secondary">（未知）</Text>,
    },
    {
      title: '患者',
      dataIndex: ['counts', 'patients'],
      width: 70,
      render: (v: number) => <Text style={{ fontFamily: 'monospace' }}>{v ?? 0}</Text>,
    },
    {
      title: '病历',
      dataIndex: ['counts', 'medical_records'],
      width: 70,
      render: (v: number) => <Text style={{ fontFamily: 'monospace' }}>{v ?? 0}</Text>,
    },
    {
      title: '总行数',
      dataIndex: 'total_rows',
      width: 80,
      render: (v: number) => <Text strong style={{ fontFamily: 'monospace' }}>{v}</Text>,
    },
  ];

  const step1 = (
    <div>
      <Alert
        type="warning"
        showIcon
        message={`在 ${task?.file_name} 中发现 ${tenants.length} 个诊所，请选择要迁移的诊所：`}
        style={{ marginBottom: 12 }}
      />

      <Table
        size="small"
        dataSource={tenants}
        columns={tenantColumns}
        rowKey="tenant_id"
        pagination={false}
        rowSelection={{
          type: 'radio',
          selectedRowKeys: selectedTenant ? [selectedTenant.tenant_id] : [],
          onChange: (_, rows) => { if (rows[0]) handleSelectTenant(rows[0] as TenantTableCount); },
        }}
        onRow={t => ({ onClick: () => handleSelectTenant(t as TenantTableCount) })}
        style={{ marginBottom: 16 }}
        scroll={{ y: 200 }}
      />

      {selectedTenant && (
        <div
          style={{
            border: '1px solid #d9d9d9',
            borderRadius: 6,
            padding: '12px 16px',
            background: '#fafafa',
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 10 }}>
            目标诊所 ID
            <Text type="secondary" style={{ fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
              （将恢复到此 ID）
            </Text>
          </div>
          <Radio.Group
            value={targetIdMode}
            onChange={e => {
              setTargetIdMode(e.target.value);
              if (e.target.value === 'keep') setTargetId(selectedTenant.tenant_id);
            }}
            style={{ marginBottom: 10 }}
          >
            <Radio value="keep">保持原 ID（{selectedTenant.tenant_id}）</Radio>
            <Radio value="custom">指定新 ID</Radio>
          </Radio.Group>

          <Space align="center">
            <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>目标 tenant_id：</Text>
            <InputNumber
              value={effectiveTargetId}
              min={1}
              disabled={targetIdMode === 'keep'}
              onChange={v => { if (v) setTargetId(v); }}
              style={{ width: 80 }}
            />
            {targetIdMode === 'custom' && targetId !== selectedTenant.tenant_id && (
              <Alert
                type="warning"
                showIcon={false}
                message={`ID 将被映射：${selectedTenant.tenant_id} → ${targetId}`}
                style={{ padding: '2px 10px', fontSize: 12 }}
              />
            )}
          </Space>
        </div>
      )}

      <div style={{ textAlign: 'right' }}>
        <Space>
          <Button onClick={() => setStep(0)}>上一步</Button>
          <Button
            type="primary"
            disabled={!selectedTenant}
            onClick={() => setStep(2)}
          >
            下一步
          </Button>
        </Space>
      </div>
    </div>
  );

  // ── Step 2: Confirm & Execute ─────────────────────────────────────────────
  const isSuccess = task?.status === 'success';
  const isFailed = task?.status === 'failed' && step === 2;

  const summaryItems = selectedTenant
    ? [
        { key: '源文件', value: task?.file_name },
        {
          key: '源诊所',
          value: (
            <Space size={4}>
              <Tag color="cyan" style={{ fontFamily: 'monospace' }}>
                ID: {selectedTenant.tenant_id}
              </Tag>
              {selectedTenant.tenant_name || '（未知）'}
            </Space>
          ),
        },
        {
          key: '目标诊所',
          value: (
            <Space size={4}>
              <Tag color={selectedTenant.tenant_id === effectiveTargetId ? 'orange' : 'green'} style={{ fontFamily: 'monospace' }}>
                ID: {effectiveTargetId}
              </Tag>
              {selectedTenant.tenant_id === effectiveTargetId
                ? <Text type="warning" style={{ fontSize: 12 }}>覆盖原数据</Text>
                : <Text type="success" style={{ fontSize: 12 }}>映射到新 ID</Text>}
            </Space>
          ),
        },
        {
          key: '数据量',
          value: (
            <Space size={4} wrap>
              {(['patients', 'medical_records', 'prescriptions', 'billings'] as const).map(k => (
                <Tag key={k} color="blue">
                  {k === 'patients' ? '患者' : k === 'medical_records' ? '病历' : k === 'prescriptions' ? '处方' : '收费'}
                  {' '}{selectedTenant.counts[k] ?? 0}
                </Tag>
              ))}
            </Space>
          ),
        },
      ]
    : [];

  // Extract last error line from output for failure subtitle
  const lastErrorLine = task?.output
    ? task.output.split('\n').filter(l => l.includes('失败') || l.includes('错误')).pop()?.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '') ?? ''
    : '';

  const step2 = (
    <div>
      {isSuccess ? (
        <>
          <Result
            status="success"
            title="迁移完成！"
            subTitle={
              `${selectedTenant?.tenant_name || `诊所 ${selectedTenant?.tenant_id}`} 的数据已成功迁移至目标诊所 ID=${effectiveTargetId}`
            }
            extra={[
              <Button key="reset" type="primary" onClick={reset}>
                重新迁移
              </Button>,
            ]}
          />
          {terminalPanel}
        </>
      ) : isFailed ? (
        <>
          <Result
            status="error"
            title="迁移失败"
            subTitle={lastErrorLine || '请查看下方日志了解详情，数据已自动回滚。'}
            extra={[
              <Button key="retry" type="primary" danger onClick={() => {
                setConfirmInput('');
                setExecuting(false);
                // keep task output visible but allow retry
                setTask(prev => prev ? { ...prev, status: 'parsed' } : prev);
              }}>
                重试
              </Button>,
              <Button key="reset" onClick={reset}>重新开始</Button>,
            ]}
          />
          {terminalPanel}
        </>
      ) : (
        <>
          {/* Summary table */}
          <div
            style={{
              border: '1px solid #d9d9d9',
              borderRadius: 6,
              overflow: 'hidden',
              marginBottom: 16,
            }}
          >
            <div
              style={{
                padding: '8px 14px',
                background: '#fafafa',
                borderBottom: '1px solid #d9d9d9',
                fontSize: 12,
                fontFamily: 'monospace',
                color: '#8b949e',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              迁移配置摘要
            </div>
            {summaryItems.map(item => (
              <div
                key={item.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 14px',
                  borderBottom: '1px solid #f0f0f0',
                  gap: 12,
                  fontSize: 13,
                }}
              >
                <span style={{ width: 80, color: '#8b949e', fontFamily: 'monospace', fontSize: 11, flexShrink: 0 }}>
                  {item.key}
                </span>
                <span>{item.value}</span>
              </div>
            ))}
          </div>

          {/* Confirm code input */}
          <div
            style={{
              border: '1px solid #ffa39e',
              borderRadius: 6,
              padding: '12px 16px',
              background: '#fff1f0',
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
              <span>输入以下确认码后才可执行，防止误操作：</span>
              <code
                style={{
                  background: '#fff2f0',
                  border: '1px solid #ffa39e',
                  padding: '1px 8px',
                  borderRadius: 3,
                  fontFamily: 'monospace',
                  color: '#cf1322',
                  fontSize: 12,
                }}
              >
                {confirmCode}
              </code>
            </div>
            <Input
              value={confirmInput}
              onChange={e => setConfirmInput(e.target.value)}
              placeholder="输入确认码..."
              style={{
                fontFamily: 'monospace',
                borderColor: confirmInput
                  ? (confirmValid ? '#52c41a' : '#ff4d4f')
                  : undefined,
              }}
              disabled={executing || isSuccess}
              autoComplete="off"
            />
          </div>

          {/* Terminal (running) */}
          {(executing || task?.status === 'running') && terminalPanel}

          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setStep(1)} disabled={executing}>上一步</Button>
              <Button
                danger
                type="primary"
                disabled={!confirmValid || executing}
                loading={executing}
                onClick={handleExecuteClick}
              >
                确认执行迁移
              </Button>
            </Space>
          </div>
        </>
      )}
    </div>
  );

  return (
    <Card
      title={
        <Space>
          <SwapOutlined style={{ color: '#13c2c2' }} />
          <span>按诊所迁移恢复</span>
          <Tag color="cyan" style={{ fontSize: 10 }}>迁移工具</Tag>
        </Space>
      }
      style={{ marginTop: 16 }}
    >
      <Alert
        type="warning"
        showIcon
        icon={<DatabaseOutlined />}
        message="此功能用于将某个诊所的数据从一个站点迁移到当前站点，源数据来自全量 SQL 备份文件，不影响其他诊所。"
        style={{ marginBottom: 20 }}
      />

      <Steps
        current={step}
        size="small"
        style={{ marginBottom: 24 }}
        items={[
          {
            title: '选择文件',
            description: task?.file_name
              ? <Text type="secondary" style={{ fontSize: 11 }}>{task.file_name}</Text>
              : undefined,
            icon: step > 0 ? undefined : (uploading ? <Spin size="small" /> : <UploadOutlined />),
          },
          {
            title: '选择诊所',
            description: selectedTenant
              ? <Text type="secondary" style={{ fontSize: 11 }}>
                  {selectedTenant.tenant_name || `ID: ${selectedTenant.tenant_id}`}
                  {' → '} ID: {effectiveTargetId}
                </Text>
              : undefined,
          },
          {
            title: '确认执行',
            description: isSuccess
              ? <Text type="success" style={{ fontSize: 11 }}>迁移完成</Text>
              : undefined,
          },
        ]}
      />

      {step === 0 && step0}
      {step === 1 && step1}
      {step === 2 && step2}
    </Card>
  );
}
