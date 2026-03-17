import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Card, Button, Space, Typography, Alert, Modal, Drawer,
  Radio, List, Tag, message, Spin,
} from 'antd';
import {
  ExclamationCircleOutlined,
  CloudUploadOutlined, DatabaseOutlined, CloudDownloadOutlined,
  DesktopOutlined, CloudServerOutlined, ReloadOutlined,
} from '@ant-design/icons';
import useIsMobile from '../../hooks/useIsMobile';
import {
  triggerBackup, getBackupStatus, listLocalFiles, listCloudFiles,
  triggerRestore, getRestoreStatus,
} from '../../api/backup';
import type { BackupFileInfo, BackupFileList, TaskStatus } from '../../api/backup';

const { Title, Text } = Typography;

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('zh-CN');
}

export default function BackupRestore() {
  const isMobile = useIsMobile();

  const [backupLoading, setBackupLoading] = useState<string | null>(null);
  const [backupResult, setBackupResult] = useState<{ status: string; output: string } | null>(null);
  const [taskOutput, setTaskOutput] = useState<string>('');
  const taskOutputTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [backupLocalFiles, setBackupLocalFiles] = useState<BackupFileList | null>(null);
  const [backupCloudFiles, setBackupCloudFiles] = useState<BackupFileList | null>(null);
  const fileRefreshRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreSource, setRestoreSource] = useState<'local' | 'cloud'>('local');
  const [localFiles, setLocalFiles] = useState<BackupFileList | null>(null);
  const [cloudFiles, setCloudFiles] = useState<BackupFileList | null>(null);
  const [fileListLoading, setFileListLoading] = useState(false);
  const [selectedMySQL, setSelectedMySQL] = useState<string>('');
  const [selectedMinIO, setSelectedMinIO] = useState<string>('');
  const [restoreLoading, setRestoreLoading] = useState(false);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (fileRefreshRef.current) clearInterval(fileRefreshRef.current);
    };
  }, []);

  const pollTaskStatus = useCallback(
    (
      taskId: string,
      getter: (id: string) => Promise<unknown>,
      onDone: (s: TaskStatus) => void,
      onTimeout?: () => void,
    ) => {
      if (pollRef.current) clearInterval(pollRef.current);
      let count = 0;
      const maxPolls = 100;
      setTaskOutput('');
      if (taskOutputTimeoutRef.current) clearTimeout(taskOutputTimeoutRef.current);
      pollRef.current = setInterval(async () => {
        count++;
        if (count > maxPolls) {
          clearInterval(pollRef.current!);
          setTaskOutput('');
          onDone({ task_id: taskId, type: '', status: 'failed', output: '操作超时', start_at: '' });
          onTimeout?.();
          return;
        }
        try {
          const res = (await getter(taskId)) as unknown as { code: number; data: TaskStatus };
          if (res.data.output) {
            setTaskOutput(res.data.output);
          }
          if (res.data.status !== 'running') {
            clearInterval(pollRef.current!);
            onDone(res.data);
            taskOutputTimeoutRef.current = setTimeout(() => setTaskOutput(''), 5000);
          }
        } catch {
          clearInterval(pollRef.current!);
          onDone({ task_id: taskId, type: '', status: 'failed', output: '轮询失败', start_at: '' });
          taskOutputTimeoutRef.current = setTimeout(() => setTaskOutput(''), 5000);
        }
      }, 2000);
    },
    [],
  );

  // 备份弹窗文件列表定时刷新
  const startFileRefresh = useCallback(() => {
    if (fileRefreshRef.current) clearInterval(fileRefreshRef.current);
    const refresh = async () => {
      try {
        const [localRes, cloudRes] = await Promise.all([
          listLocalFiles() as unknown as Promise<{ code: number; data: BackupFileList }>,
          listCloudFiles() as unknown as Promise<{ code: number; data: BackupFileList }>,
        ]);
        setBackupLocalFiles(localRes.data);
        setBackupCloudFiles(cloudRes.data);
      } catch { /* ignore */ }
    };
    refresh();
    fileRefreshRef.current = setInterval(refresh, 5000);
  }, []);

  const stopFileRefresh = useCallback(() => {
    if (fileRefreshRef.current) {
      clearInterval(fileRefreshRef.current);
      fileRefreshRef.current = undefined;
    }
  }, []);

  const handleBackup = useCallback(
    async (type: 'mysql' | 'minio' | 'full') => {
      setBackupLoading(type);
      setBackupResult(null);
      setBackupLocalFiles(null);
      setBackupCloudFiles(null);
      setBackupModalOpen(true);
      startFileRefresh();
      try {
        const res = (await triggerBackup(type)) as unknown as { code: number; data: { task_id: string } };
        pollTaskStatus(res.data.task_id, getBackupStatus, async (status) => {
          setBackupLoading(null);
          setBackupResult({ status: status.status, output: status.output });
          // 最后刷新一次文件列表
          try {
            const [localRes, cloudRes] = await Promise.all([
              listLocalFiles() as unknown as Promise<{ code: number; data: BackupFileList }>,
              listCloudFiles() as unknown as Promise<{ code: number; data: BackupFileList }>,
            ]);
            setBackupLocalFiles(localRes.data);
            setBackupCloudFiles(cloudRes.data);
          } catch { /* ignore */ }
          stopFileRefresh();
          if (status.status === 'success') {
            message.success('备份完成');
          } else {
            message.error('备份失败');
          }
        });
      } catch {
        setBackupLoading(null);
        stopFileRefresh();
        message.error('启动备份失败');
      }
    },
    [pollTaskStatus, startFileRefresh, stopFileRefresh],
  );

  const confirmBackup = useCallback(
    (type: 'mysql' | 'minio' | 'full') => {
      const labels = { mysql: 'MySQL 数据库', minio: 'MinIO 文件存储', full: 'MySQL + MinIO 全量' };
      Modal.confirm({
        title: '确认备份',
        icon: <ExclamationCircleOutlined />,
        content: `即将执行 ${labels[type]} 备份，备份文件将上传到云端。确认继续？`,
        okText: '开始备份',
        cancelText: '取消',
        centered: true,
        onOk: () => handleBackup(type),
      });
    },
    [handleBackup],
  );

  const openCloudRestore = useCallback(async () => {
    setRestoreSource('cloud');
    setLocalFiles(null);
    setCloudFiles(null);
    setSelectedMySQL('');
    setSelectedMinIO('');
    setFileListLoading(true);
    setRestoreModalOpen(true);
    try {
      const res = (await listCloudFiles()) as unknown as { code: number; data: BackupFileList };
      setCloudFiles(res.data);
    } catch {
      message.error('获取云端备份列表失败');
    } finally {
      setFileListLoading(false);
    }
  }, []);

  const openLocalRestore = useCallback(async () => {
    setRestoreSource('local');
    setCloudFiles(null);
    setLocalFiles(null);
    setSelectedMySQL('');
    setSelectedMinIO('');
    setFileListLoading(true);
    setRestoreModalOpen(true);
    try {
      const res = (await listLocalFiles()) as unknown as { code: number; data: BackupFileList };
      setLocalFiles(res.data);
    } catch {
      message.error('获取本地备份列表失败');
    } finally {
      setFileListLoading(false);
    }
  }, []);

  const doRestore = useCallback(async () => {
    setRestoreLoading(true);
    setRestoreModalOpen(false);
    const source = restoreSource;
    try {
      const res = (await triggerRestore({
        source,
        mysql_file: selectedMySQL,
        minio_file: selectedMinIO || undefined,
      })) as unknown as { code: number; data: { task_id: string } };
      message.info(source === 'local' ? '恢复任务已启动' : '恢复任务已启动，正在下载并恢复...');
      pollTaskStatus(res.data.task_id, getRestoreStatus, (status) => {
        setRestoreLoading(false);
        if (status.status === 'success') {
          message.success('恢复完成');
        } else {
          message.error('恢复失败: ' + status.output.slice(0, 200));
        }
      });
    } catch {
      setRestoreLoading(false);
      message.error('启动恢复失败');
    }
  }, [selectedMySQL, selectedMinIO, restoreSource, pollTaskStatus]);

  const handleRestore = useCallback(() => {
    if (!selectedMySQL && !selectedMinIO) {
      message.warning('请至少选择一个备份文件');
      return;
    }
    const files = [selectedMySQL, selectedMinIO].filter(Boolean).join(' + ');
    Modal.confirm({
      title: '确认恢复数据',
      icon: <ExclamationCircleOutlined />,
      content: `即将恢复 ${files}，当前数据将被覆盖且不可撤销。确认继续？`,
      okText: '确认恢复',
      okButtonProps: { danger: true },
      cancelText: '取消',
      centered: true,
      onOk: doRestore,
    });
  }, [selectedMySQL, selectedMinIO, doRestore]);

  const renderFileList = (
    files: BackupFileInfo[],
    selected: string,
    onSelect: (f: string) => void,
    label: string,
    optional?: boolean,
  ) => (
    <div style={{ marginBottom: 16 }}>
      <Text strong>
        {label}
        {optional && <Text type="secondary">（可选）</Text>}
      </Text>
      <Radio.Group
        value={selected}
        onChange={(e) => onSelect(e.target.value)}
        style={{ display: 'block', marginTop: 8 }}
      >
        <List
          size="small"
          bordered
          dataSource={files}
          locale={{ emptyText: '暂无备份文件' }}
          renderItem={(item: BackupFileInfo) => (
            <List.Item
              key={item.filename}
              style={{
                cursor: 'pointer',
                background: selected === item.filename ? '#e6f7ff' : undefined,
                padding: isMobile ? '10px 12px' : '8px 12px',
              }}
              onClick={() => onSelect(item.filename)}
            >
              <Radio value={item.filename} style={{ marginRight: 8 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text ellipsis style={{ display: 'block' }}>
                  {item.filename}
                </Text>
                {isMobile && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {formatSize(item.size)} · {formatTime(item.modified)}
                  </Text>
                )}
              </div>
              {!isMobile && (
                <Text type="secondary">
                  {formatSize(item.size)} · {formatTime(item.modified)}
                </Text>
              )}
            </List.Item>
          )}
        />
      </Radio.Group>
    </div>
  );

  const backupModalTitle = '☁️ 备份到云端';
  const backupModalContent = (
    <div>
      {/* 本地备份区 — 蓝色边线 */}
      <div style={{
        borderLeft: isMobile ? '3px solid #1890ff' : '4px solid #1890ff',
        background: '#f0f5ff',
        borderRadius: '0 8px 8px 0',
        padding: isMobile ? 10 : 14,
        marginBottom: isMobile ? 10 : 12,
      }}>
        <div style={{ fontWeight: 'bold', color: '#1890ff', marginBottom: 8, fontSize: isMobile ? 12 : 14 }}>
          💻 本地备份 {backupLoading && <Tag color="processing" style={{ marginLeft: 6, fontSize: 11 }}>刷新中</Tag>}
        </div>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 6 : 8 }}>
          <div style={{ flex: 1, background: '#fff', borderRadius: 6, padding: isMobile ? '6px 8px' : '8px 10px', border: '1px solid #d9d9d9' }}>
            <div style={{ fontWeight: 600, fontSize: isMobile ? 11 : 12, marginBottom: 4 }}>🗄️ MySQL</div>
            {(backupLocalFiles?.mysql || []).length === 0
              ? <Text type="secondary" style={{ fontSize: isMobile ? 10 : 11 }}>暂无文件</Text>
              : (backupLocalFiles?.mysql || []).map(f => (
                <div key={f.filename} style={{ fontSize: isMobile ? 10 : 11, display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <Text ellipsis style={{ flex: 1, minWidth: 0 }}>{f.filename}</Text>
                  <Text type="secondary" style={{ flexShrink: 0, marginLeft: 6 }}>{formatSize(f.size)}</Text>
                </div>
              ))
            }
          </div>
          <div style={{ flex: 1, background: '#fff', borderRadius: 6, padding: isMobile ? '6px 8px' : '8px 10px', border: '1px solid #d9d9d9' }}>
            <div style={{ fontWeight: 600, fontSize: isMobile ? 11 : 12, marginBottom: 4 }}>📁 MinIO</div>
            {(backupLocalFiles?.minio || []).length === 0
              ? <Text type="secondary" style={{ fontSize: isMobile ? 10 : 11 }}>暂无文件</Text>
              : (backupLocalFiles?.minio || []).map(f => (
                <div key={f.filename} style={{ fontSize: isMobile ? 10 : 11, display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <Text ellipsis style={{ flex: 1, minWidth: 0 }}>{f.filename}</Text>
                  <Text type="secondary" style={{ flexShrink: 0, marginLeft: 6 }}>{formatSize(f.size)}</Text>
                </div>
              ))
            }
          </div>
        </div>
      </div>

      {/* 云端备份区 — 橙色边线 */}
      <div style={{
        borderLeft: isMobile ? '3px solid #fa8c16' : '4px solid #fa8c16',
        background: '#fff7e6',
        borderRadius: '0 8px 8px 0',
        padding: isMobile ? 10 : 14,
        marginBottom: isMobile ? 10 : 12,
      }}>
        <div style={{ fontWeight: 'bold', color: '#fa8c16', marginBottom: 8, fontSize: isMobile ? 12 : 14 }}>
          ☁️ 云端备份 {backupLoading && <Tag color="processing" style={{ marginLeft: 6, fontSize: 11 }}>刷新中</Tag>}
        </div>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 6 : 8 }}>
          <div style={{ flex: 1, background: '#fff', borderRadius: 6, padding: isMobile ? '6px 8px' : '8px 10px', border: '1px solid #d9d9d9' }}>
            <div style={{ fontWeight: 600, fontSize: isMobile ? 11 : 12, marginBottom: 4 }}>🗄️ MySQL</div>
            {(backupCloudFiles?.mysql || []).length === 0
              ? <Text type="secondary" style={{ fontSize: isMobile ? 10 : 11 }}>暂无文件</Text>
              : (backupCloudFiles?.mysql || []).map(f => (
                <div key={f.filename} style={{ fontSize: isMobile ? 10 : 11, display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <Text ellipsis style={{ flex: 1, minWidth: 0 }}>{f.filename}</Text>
                  <Text type="secondary" style={{ flexShrink: 0, marginLeft: 6 }}>{formatSize(f.size)}</Text>
                </div>
              ))
            }
          </div>
          <div style={{ flex: 1, background: '#fff', borderRadius: 6, padding: isMobile ? '6px 8px' : '8px 10px', border: '1px solid #d9d9d9' }}>
            <div style={{ fontWeight: 600, fontSize: isMobile ? 11 : 12, marginBottom: 4 }}>📁 MinIO</div>
            {(backupCloudFiles?.minio || []).length === 0
              ? <Text type="secondary" style={{ fontSize: isMobile ? 10 : 11 }}>暂无文件</Text>
              : (backupCloudFiles?.minio || []).map(f => (
                <div key={f.filename} style={{ fontSize: isMobile ? 10 : 11, display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <Text ellipsis style={{ flex: 1, minWidth: 0 }}>{f.filename}</Text>
                  <Text type="secondary" style={{ flexShrink: 0, marginLeft: 6 }}>{formatSize(f.size)}</Text>
                </div>
              ))
            }
          </div>
        </div>
      </div>

      {/* 终端日志 */}
      {taskOutput && (
        <div
          style={{
            background: '#1e1e1e',
            color: '#d4d4d4',
            borderRadius: 8,
            padding: isMobile ? '8px 10px' : '10px 14px',
            fontFamily: 'monospace',
            fontSize: isMobile ? 10 : 11,
            lineHeight: 1.5,
            maxHeight: isMobile ? 120 : 160,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            marginBottom: 12,
          }}
        >
          {taskOutput}
        </div>
      )}

      {backupResult && (
        <Alert
          type={backupResult.status === 'success' ? 'success' : 'error'}
          message={backupResult.status === 'success' ? '备份完成' : '备份失败'}
          showIcon
        />
      )}
    </div>
  );

  const restoreFiles = restoreSource === 'cloud' ? cloudFiles : localFiles;

  const restoreContent = (
    <Spin spinning={fileListLoading}>
      {restoreFiles && (
        <>
          {renderFileList(restoreFiles.mysql, selectedMySQL, setSelectedMySQL, '🗄️ MySQL 备份')}
          {renderFileList(restoreFiles.minio, selectedMinIO, setSelectedMinIO, '📁 MinIO 备份')}
        </>
      )}
      <Alert
        type="error"
        message="恢复将覆盖当前全部数据，此操作不可撤销！"
        showIcon
        style={{ marginBottom: 16 }}
      />
      {/* 恢复进度日志 */}
      {(restoreLoading || taskOutput) && (
        <div
          style={{
            marginBottom: 12,
            background: '#1e1e1e',
            color: '#d4d4d4',
            borderRadius: 8,
            padding: isMobile ? '8px 10px' : '10px 14px',
            fontFamily: 'monospace',
            fontSize: isMobile ? 10 : 11,
            lineHeight: 1.5,
            maxHeight: isMobile ? 120 : 160,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {taskOutput || '等待执行...'}
        </div>
      )}
      <div style={{ textAlign: isMobile ? 'center' : 'right' }}>
        <Space
          direction={isMobile ? 'vertical' : 'horizontal'}
          style={{ width: isMobile ? '100%' : undefined }}
        >
          <Button
            onClick={() => setRestoreModalOpen(false)}
            style={isMobile ? { width: '100%' } : undefined}
          >
            取消
          </Button>
          <Button
            danger
            type="primary"
            disabled={!selectedMySQL && !selectedMinIO}
            loading={restoreLoading}
            onClick={handleRestore}
            style={isMobile ? { width: '100%' } : undefined}
          >
            确认恢复
          </Button>
        </Space>
      </div>
    </Spin>
  );

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Title level={4}>备份与恢复</Title>

      {/* 数据备份区域 */}
      <Card
        title={
          <>
            <CloudUploadOutlined /> 数据备份
          </>
        }
        style={{ marginBottom: 16 }}
        extra={
          backupResult && (
            <Tag color={backupResult.status === 'success' ? 'green' : 'red'}>
              {backupResult.status === 'success' ? '备份成功' : '备份失败'}
            </Tag>
          )
        }
      >
        <Alert
          type="info"
          message="手动触发备份会立即执行备份脚本，并上传到云端。自动备份仍按配置间隔执行。"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Space
          direction={isMobile ? 'vertical' : 'horizontal'}
          style={{ width: isMobile ? '100%' : undefined }}
        >
          <Button
            type="primary"
            icon={<DatabaseOutlined />}
            loading={backupLoading === 'mysql'}
            disabled={!!backupLoading}
            onClick={() => confirmBackup('mysql')}
            style={isMobile ? { width: '100%' } : undefined}
          >
            备份 MySQL
          </Button>
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            loading={backupLoading === 'minio'}
            disabled={!!backupLoading}
            onClick={() => confirmBackup('minio')}
            style={isMobile ? { width: '100%' } : undefined}
          >
            备份 MinIO
          </Button>
          <Button
            type="primary"
            style={
              isMobile
                ? { width: '100%', background: '#52c41a', borderColor: '#52c41a' }
                : { background: '#52c41a', borderColor: '#52c41a' }
            }
            icon={<ReloadOutlined />}
            loading={backupLoading === 'full'}
            disabled={!!backupLoading}
            onClick={() => confirmBackup('full')}
          >
            全量备份
          </Button>
        </Space>
      </Card>

      {/* 数据恢复区域 */}
      <Card
        title={
          <>
            <CloudDownloadOutlined /> 数据恢复
          </>
        }
      >
        <Alert
          type="warning"
          message="恢复操作将覆盖当前数据，请确认后再操作"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            gap: 16,
          }}
        >
          <Card
            hoverable={!restoreLoading}
            style={{ flex: 1, textAlign: 'center', cursor: restoreLoading ? 'not-allowed' : 'pointer', opacity: restoreLoading ? 0.5 : 1 }}
            onClick={restoreLoading ? undefined : openLocalRestore}
          >
            <DesktopOutlined style={{ fontSize: 32, color: '#1890ff', marginBottom: 8 }} />
            <div>
              <Text strong>从本地恢复</Text>
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              选择本地备份文件恢复
            </Text>
          </Card>

          <Card
            hoverable={!restoreLoading}
            style={{ flex: 1, textAlign: 'center', cursor: restoreLoading ? 'not-allowed' : 'pointer', opacity: restoreLoading ? 0.5 : 1 }}
            onClick={restoreLoading ? undefined : openCloudRestore}
          >
            <CloudServerOutlined style={{ fontSize: 32, color: '#1890ff', marginBottom: 8 }} />
            <div>
              <Text strong>从云端恢复</Text>
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              从云端选择备份文件
            </Text>
          </Card>
        </div>
      </Card>

      {/* 恢复弹窗 — 桌面端 Modal / 移动端 Drawer */}
      {isMobile ? (
        <Drawer
          title={restoreSource === 'cloud' ? '☁️ 从云端恢复' : '💻 从本地恢复'}
          placement="bottom"
          height="85vh"
          open={restoreModalOpen}
          onClose={() => setRestoreModalOpen(false)}
          footer={null}
          destroyOnClose
        >
          {restoreContent}
        </Drawer>
      ) : (
        <Modal
          title={restoreSource === 'cloud' ? '☁️ 从云端恢复' : '💻 从本地恢复'}
          width={560}
          open={restoreModalOpen}
          onCancel={() => setRestoreModalOpen(false)}
          footer={null}
          destroyOnClose
        >
          {restoreContent}
        </Modal>
      )}
      {/* 备份监控弹窗 — 桌面端 Modal / 移动端 Drawer */}
      {isMobile ? (
        <Drawer
          title={backupModalTitle}
          placement="bottom"
          height="85vh"
          open={backupModalOpen}
          onClose={() => { setBackupModalOpen(false); stopFileRefresh(); if (pollRef.current) clearInterval(pollRef.current); }}
          footer={null}
          destroyOnClose
        >
          {backupModalContent}
        </Drawer>
      ) : (
        <Modal
          title={backupModalTitle}
          width={600}
          open={backupModalOpen}
          onCancel={() => { setBackupModalOpen(false); stopFileRefresh(); if (pollRef.current) clearInterval(pollRef.current); }}
          footer={null}
          destroyOnClose
        >
          {backupModalContent}
        </Modal>
      )}
    </div>
  );
}
