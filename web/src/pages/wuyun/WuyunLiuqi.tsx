import { useState, useEffect, useRef, useCallback } from 'react';
import { InputNumber, Button, Spin, Input, Popconfirm, message, Space, Tag, Typography } from 'antd';
import { SearchOutlined, ReloadOutlined, EditOutlined, DeleteOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../../store/auth';
import { getWuyunLiuqi, updateWuyunLiuqi, deleteWuyunLiuqi } from '../../api/wuyunLiuqi';
import type { WuyunLiuqiItem } from '../../api/wuyunLiuqi';
import { streamWuyunLiuqiQuery } from '../../utils/sse';
import NotesPanel from './NotesPanel';

const { TextArea } = Input;
const { Title, Text } = Typography;

export default function WuyunLiuqi() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [record, setRecord] = useState<WuyunLiuqiItem | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const { hasPermission } = useAuth();
  const isAdmin = hasPermission('role:manage');

  // Load cached data for a year
  const loadCache = useCallback(async (y: number) => {
    setLoading(true);
    setContent('');
    setRecord(null);
    try {
      const res = (await getWuyunLiuqi(y)) as unknown as { data: WuyunLiuqiItem | null };
      if (res.data) {
        setRecord(res.data);
        setContent(res.data.content);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    loadCache(currentYear);
  }, [currentYear, loadCache]);

  // Query AI (streaming)
  const handleQuery = useCallback((force: boolean) => {
    if (streaming) return;
    // Cancel any previous stream
    abortRef.current?.abort();

    setStreaming(true);
    setContent('');
    setRecord(null);
    setEditing(false);

    let accumulated = '';

    const controller = streamWuyunLiuqiQuery(year, force, {
      onChunk: (text) => {
        accumulated += text;
        setContent(accumulated);
      },
      onDone: (evt) => {
        const e = evt as Record<string, unknown>;
        if (e.data) setRecord(e.data as WuyunLiuqiItem);
        setStreaming(false);
      },
      onCached: (evt) => {
        const e = evt as Record<string, unknown>;
        const item = e.data as WuyunLiuqiItem;
        setRecord(item);
        setContent(item.content);
        setStreaming(false);
      },
      onError: (error) => {
        message.error(error);
        setStreaming(false);
      },
    });

    abortRef.current = controller;
  }, [year, streaming]);

  // Cancel streaming
  const handleCancel = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  // Edit
  const handleEdit = () => {
    setEditContent(content);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!record) return;
    setSaving(true);
    try {
      await updateWuyunLiuqi(record.id, editContent);
      setContent(editContent);
      setRecord({ ...record, content: editContent, source: 'manual' });
      setEditing(false);
      message.success('保存成功');
    } catch {
      // error handled by interceptor
    } finally {
      setSaving(false);
    }
  };

  // Delete
  const handleDelete = async () => {
    if (!record) return;
    try {
      await deleteWuyunLiuqi(record.id);
      setRecord(null);
      setContent('');
      message.success('已删除');
    } catch {
      // error handled by interceptor
    }
  };

  // Year change
  const handleYearChange = (val: number | null) => {
    if (val && val > 0) {
      setYear(val);
      setEditing(false);
      abortRef.current?.abort();
      setStreaming(false);
      loadCache(val);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return (
    <div>
      <NotesPanel />
      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <Title level={4} style={{ margin: 0 }}>五运六气</Title>
        <InputNumber
          min={1}
          max={9999}
          value={year}
          onChange={handleYearChange}
          style={{ width: 120 }}
          disabled={streaming}
        />
        <Button
          type="primary"
          icon={<SearchOutlined />}
          onClick={() => handleQuery(false)}
          loading={streaming}
        >
          查询
        </Button>
        {streaming && (
          <Button onClick={handleCancel}>取消</Button>
        )}
        {isAdmin && !streaming && (
          <Button
            icon={<ReloadOutlined />}
            onClick={() => handleQuery(true)}
            disabled={streaming}
          >
            强制重新查询
          </Button>
        )}
      </div>

      {/* Status tags */}
      {record && !editing && (
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tag color={record.source === 'ai' ? 'blue' : 'green'}>
            {record.source === 'ai' ? 'AI 生成' : '手动编辑'}
          </Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            更新时间: {new Date(record.updated_at).toLocaleString('zh-CN')}
          </Text>
          {isAdmin && (
            <Space size="small" style={{ marginLeft: 'auto' }}>
              <Button size="small" icon={<EditOutlined />} onClick={handleEdit}>编辑</Button>
              <Popconfirm
                title="确认删除？"
                description="删除后需重新查询 AI 获取数据"
                onConfirm={handleDelete}
                okText="确认"
                cancelText="取消"
              >
                <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            </Space>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && <Spin style={{ display: 'block', margin: '40px auto' }} />}

      {/* Streaming indicator */}
      {streaming && !content && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
          <div style={{ marginTop: 12, color: '#888' }}>AI 正在分析，请稍候...</div>
        </div>
      )}

      {/* Edit mode */}
      {editing && (
        <div>
          <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button>
            <Button icon={<CloseOutlined />} onClick={() => setEditing(false)}>取消</Button>
          </div>
          <TextArea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            autoSize={{ minRows: 20 }}
            style={{ fontFamily: 'monospace', fontSize: 13 }}
          />
        </div>
      )}

      {/* Content display (Markdown) */}
      {!editing && content && (
        <div
          ref={contentRef}
          className="wuyun-content"
          style={{
            fontSize: 14,
            lineHeight: 1.8,
            color: '#333',
          }}
        >
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => (
                <h2 style={{ fontSize: 20, fontWeight: 600, borderBottom: '1px solid #e8e8e8', paddingBottom: 8, marginTop: 24 }}>{children}</h2>
              ),
              h2: ({ children }) => (
                <h3 style={{ fontSize: 17, fontWeight: 600, marginTop: 20 }}>{children}</h3>
              ),
              h3: ({ children }) => (
                <h4 style={{ fontSize: 15, fontWeight: 600, marginTop: 16 }}>{children}</h4>
              ),
              blockquote: ({ children }) => (
                <blockquote style={{ borderLeft: '3px solid #d9d9d9', paddingLeft: 12, color: '#666', margin: '12px 0' }}>{children}</blockquote>
              ),
              table: ({ children }) => (
                <table style={{ borderCollapse: 'collapse', width: '100%', margin: '12px 0' }}>{children}</table>
              ),
              th: ({ children }) => (
                <th style={{ border: '1px solid #e8e8e8', padding: '8px 12px', background: '#fafafa', fontWeight: 600 }}>{children}</th>
              ),
              td: ({ children }) => (
                <td style={{ border: '1px solid #e8e8e8', padding: '8px 12px' }}>{children}</td>
              ),
            }}
          >
            {content}
          </Markdown>
          {streaming && <Spin size="small" style={{ marginLeft: 8 }} />}
        </div>
      )}

      {/* Empty state */}
      {!loading && !streaming && !content && !editing && (
        <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>☯</div>
          <div>暂无 {year} 年五运六气数据</div>
          <div style={{ marginTop: 8 }}>点击「查询」从 AI 获取分析结果</div>
        </div>
      )}
    </div>
  );
}
