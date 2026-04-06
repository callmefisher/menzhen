import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Modal, Breadcrumb, Typography, Spin, Space, Alert } from 'antd'
import { FolderOutlined } from '@ant-design/icons'
import { browseFS } from '../../api/disk'
import type { DirEntry } from '../../api/disk'

interface Props {
  open: boolean
  onSelect: (path: string) => void
  onClose: () => void
}

const DirBrowser: React.FC<Props> = ({ open, onSelect, onClose }) => {
  const [currentPath, setCurrentPath] = useState('/')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const load = useCallback((path: string) => {
    setLoading(true)
    setError(null)
    browseFS(path)
      .then(res => {
        if (!mountedRef.current) return
        setEntries(res.data.data ?? [])
        setCurrentPath(path)
      })
      .catch(() => {
        if (!mountedRef.current) return
        setEntries([])
        setError('加载目录失败，请重试')
      })
      .finally(() => {
        if (!mountedRef.current) return
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (open) {
      setCurrentPath('/')
      load('/')
    }
  }, [open, load])

  // Build breadcrumb segments: "/" -> ["opt"] -> ["opt", "local"] etc.
  const segments = currentPath === '/' ? ['/'] : ['/', ...currentPath.slice(1).split('/')]
  const pathForSegment = (i: number) =>
    i === 0 ? '/' : '/' + segments.slice(1, i + 1).join('/')

  const directories = entries.filter(e => e.is_dir)

  return (
    <Modal
      title="选择目标目录"
      open={open}
      onCancel={onClose}
      onOk={() => onSelect(currentPath)}
      okText="选择此目录"
      cancelText="取消"
      width={480}
      destroyOnHidden
    >
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={segments.map((seg, i) => ({
          key: pathForSegment(i),
          title: (
            <span
              style={{ cursor: 'pointer', color: '#1677ff' }}
              onClick={() => load(pathForSegment(i))}
            >
              {seg}
            </span>
          ),
        }))}
      />
      {loading ? (
        <Spin style={{ display: 'block', textAlign: 'center', padding: 24 }} />
      ) : error ? (
        <Alert type="error" message={error} />
      ) : directories.length === 0 ? (
        <Typography.Text type="secondary">（空目录或无子目录）</Typography.Text>
      ) : (
        <div>
          {directories.map(entry => (
            <div
              key={entry.path}
              style={{ cursor: 'pointer', padding: '6px 4px' }}
              onClick={() => load(entry.path)}
            >
              <Space>
                <FolderOutlined />
                <Typography.Text>{entry.name}</Typography.Text>
              </Space>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

export default DirBrowser
