import React, { useState, useRef, useEffect } from 'react'
import {
  Modal, Form, Input, Button, Space, Alert, Steps, Typography, Progress, message
} from 'antd'
import { changeBackupDir, getBackupDirStatus } from '../../api/disk'
import type { DiskTask } from '../../api/disk'
import DirBrowser from './DirBrowser'

interface Props {
  open: boolean
  onClose: () => void
}

const STEP_LABELS = [
  '复制备份文件',
  '更新配置文件',
  '重启相关容器',
  '验证新目录',
]

const BackupDirChange: React.FC<Props> = ({ open, onClose }) => {
  const [newPath, setNewPath] = useState('')
  const [task, setTask] = useState<DiskTask | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  useEffect(() => () => stopPoll(), [])

  const handleStart = async () => {
    if (!newPath.trim()) { message.warning('请填写目标路径'); return }
    try {
      const res = await changeBackupDir(newPath.trim())
      const t = res.data.data
      setTask(t)
      pollRef.current = setInterval(async () => {
        try {
          const r = await getBackupDirStatus(t.task_id)
          const updated = r.data.data
          setTask(updated)
          if (updated.status !== 'running') stopPoll()
        } catch { stopPoll() }
      }, 2000)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } }
      message.error(axiosErr.response?.data?.error ?? '操作失败')
    }
  }

  const handleClose = () => {
    stopPoll(); setTask(null); setNewPath(''); onClose()
  }

  const isRunning = task?.status === 'running'

  return (
    <>
      <Modal
        title="更换备份目录"
        open={open}
        onCancel={handleClose}
        footer={null}
        width={500}
      >
        {!task ? (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Alert
              type="info"
              message="更换过程中 MySQL/MinIO 不停机。backup 和 api 容器将短暂重启（约 10 秒）。"
            />
            <Form layout="vertical">
              <Form.Item label="新备份目录（宿主机绝对路径）">
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    value={newPath}
                    onChange={e => setNewPath(e.target.value)}
                    placeholder="/new/backup/path"
                  />
                  <Button onClick={() => setBrowsing(true)}>📁 浏览</Button>
                </Space.Compact>
              </Form.Item>
            </Form>
            <Button type="primary" onClick={handleStart}>
              复制文件并应用 →
            </Button>
          </Space>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Steps
              current={task.step - 1}
              status={task.status === 'failed' ? 'error' : task.status === 'success' ? 'finish' : 'process'}
              items={STEP_LABELS.map(label => ({ title: label }))}
              direction="vertical"
              size="small"
            />
            {isRunning && (
              <Progress percent={Math.round((task.step / task.total) * 100)} status="active" />
            )}
            {task.status === 'success' && (
              <Alert type="success" message="备份目录更换成功！" />
            )}
            {task.status === 'failed' && (
              <Alert type="error" message={task.output.split('\n').pop() ?? '操作失败'} />
            )}
            <Typography.Text style={{ fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
              {task.output}
            </Typography.Text>
            {!isRunning && <Button onClick={handleClose}>关闭</Button>}
          </Space>
        )}
      </Modal>

      <DirBrowser
        open={browsing}
        onSelect={path => { setNewPath(path); setBrowsing(false) }}
        onClose={() => setBrowsing(false)}
      />
    </>
  )
}

export default BackupDirChange
