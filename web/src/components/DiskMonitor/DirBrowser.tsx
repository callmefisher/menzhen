import React, { useEffect, useState, useCallback } from 'react'
import { Modal, Breadcrumb, List, Typography, Spin, Space } from 'antd'
import { FolderOutlined } from '@ant-design/icons'
import { browseFS, DirEntry } from '../../api/disk'

interface Props {
  open: boolean
  onSelect: (path: string) => void
  onClose: () => void
}

const DirBrowser: React.FC<Props> = ({ open, onSelect, onClose }) => {
  const [currentPath, setCurrentPath] = useState('/')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback((path: string) => {
    setLoading(true)
    browseFS(path)
      .then(res => {
        setEntries(res.data.data ?? [])
        setCurrentPath(path)
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
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
      destroyOnClose
    >
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={segments.map((seg, i) => ({
          key: i,
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
      ) : directories.length === 0 ? (
        <Typography.Text type="secondary">（空目录或无子目录）</Typography.Text>
      ) : (
        <List
          size="small"
          dataSource={directories}
          renderItem={entry => (
            <List.Item
              key={entry.path}
              style={{ cursor: 'pointer' }}
              onClick={() => load(entry.path)}
            >
              <Space>
                <FolderOutlined />
                <Typography.Text>{entry.name}</Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      )}
    </Modal>
  )
}

export default DirBrowser
