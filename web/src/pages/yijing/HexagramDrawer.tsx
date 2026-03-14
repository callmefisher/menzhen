import { useState, useEffect } from 'react';
import {
  Drawer,
  Tabs,
  Button,
  Input,
  Space,
  Popconfirm,
  message,
  Tag,
  Spin,
} from 'antd';
import { EditOutlined, DeleteOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useAuth } from '../../store/auth';
import useIsMobile from '../../hooks/useIsMobile';
import { updateHexagram, deleteHexagram } from '../../api/yijing';
import type { HexagramItem } from '../../api/yijing';

interface Props {
  hexagram: HexagramItem | null;
  open: boolean;
  onClose: () => void;
  onUpdate: () => void;
  onNavigate: (name: string) => void;
}

export default function HexagramDrawer({ hexagram, open, onClose, onUpdate, onNavigate }: Props) {
  const isMobile = useIsMobile();
  const { hasPermission } = useAuth();
  const isAdmin = hasPermission('role:manage');

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState<Partial<HexagramItem>>({});

  useEffect(() => {
    if (hexagram) {
      setEditForm({
        name: hexagram.name,
        symbol: hexagram.symbol,
        upper_trigram: hexagram.upper_trigram,
        lower_trigram: hexagram.lower_trigram,
        judgment: hexagram.judgment,
        commentary: hexagram.commentary,
        tcm_application: hexagram.tcm_application,
        description: hexagram.description,
        yao_texts: hexagram.yao_texts ? [...hexagram.yao_texts] : [],
      });
      setEditing(false);
    }
  }, [hexagram]);

  const handleSave = async () => {
    if (!hexagram) return;
    try {
      setSaving(true);
      await updateHexagram(hexagram.id, editForm);
      message.success('保存成功');
      setEditing(false);
      onUpdate();
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!hexagram) return;
    try {
      await deleteHexagram(hexagram.id);
      message.success('删除成功');
      onClose();
      onUpdate();
    } catch {
      message.error('删除失败');
    }
  };

  const handleCancelEdit = () => {
    if (hexagram) {
      setEditForm({
        name: hexagram.name,
        symbol: hexagram.symbol,
        upper_trigram: hexagram.upper_trigram,
        lower_trigram: hexagram.lower_trigram,
        judgment: hexagram.judgment,
        commentary: hexagram.commentary,
        tcm_application: hexagram.tcm_application,
        description: hexagram.description,
        yao_texts: hexagram.yao_texts ? [...hexagram.yao_texts] : [],
      });
    }
    setEditing(false);
  };

  const updateYaoText = (index: number, field: 'name' | 'text', value: string) => {
    setEditForm((prev) => {
      const yaos = prev.yao_texts ? [...prev.yao_texts] : [];
      if (!yaos[index]) {
        yaos[index] = { position: index + 1, name: '', text: '' };
      }
      yaos[index] = { ...yaos[index], [field]: value };
      return { ...prev, yao_texts: yaos };
    });
  };

  if (!hexagram) {
    return (
      <Drawer
        open={open}
        onClose={onClose}
        width={isMobile ? 'calc(100vw - 32px)' : 520}
      >
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      </Drawer>
    );
  }

  const drawerTitle = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 8 }}>
      <Space>
        <span style={{ fontSize: 24 }}>{hexagram.symbol}</span>
        <div>
          <div style={{ fontWeight: 'bold', fontSize: 16 }}>{hexagram.name}</div>
          <div style={{ fontSize: 12, color: '#8b95a8' }}>第 {hexagram.number} 卦</div>
        </div>
      </Space>
      {!editing && isAdmin && (
        <Space size="small">
          <Button
            type="primary"
            size="small"
            icon={<EditOutlined />}
            onClick={() => setEditing(true)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除此卦？"
            onConfirm={handleDelete}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger size="small" icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      )}
      {editing && (
        <Space size="small">
          <Button
            type="primary"
            size="small"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={handleSave}
          >
            保存
          </Button>
          <Button size="small" icon={<CloseOutlined />} onClick={handleCancelEdit}>取消</Button>
        </Space>
      )}
    </div>
  );

  const yaoPositionLabels = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];

  const tabItems = [
    {
      key: 'overview',
      label: '概述',
      children: (
        <div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 'bold', marginBottom: 4, color: '#666', fontSize: 12 }}>上卦 / 下卦</div>
            {editing ? (
              <Space>
                <Input
                  size="small"
                  style={{ width: 100 }}
                  value={editForm.upper_trigram}
                  onChange={(e) => setEditForm((p) => ({ ...p, upper_trigram: e.target.value }))}
                  placeholder="上卦"
                />
                <span style={{ color: '#999' }}>·</span>
                <Input
                  size="small"
                  style={{ width: 100 }}
                  value={editForm.lower_trigram}
                  onChange={(e) => setEditForm((p) => ({ ...p, lower_trigram: e.target.value }))}
                  placeholder="下卦"
                />
              </Space>
            ) : (
              <Space>
                <Tag color="blue">{hexagram.upper_trigram}</Tag>
                <Tag color="geekblue">{hexagram.lower_trigram}</Tag>
              </Space>
            )}
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 'bold', marginBottom: 4, color: '#666', fontSize: 12 }}>卦辞（彖辞）</div>
            {editing ? (
              <Input.TextArea
                rows={4}
                value={editForm.judgment}
                onChange={(e) => setEditForm((p) => ({ ...p, judgment: e.target.value }))}
                placeholder="请输入卦辞"
              />
            ) : (
              <div style={{ lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{hexagram.judgment || '暂无'}</div>
            )}
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 'bold', marginBottom: 4, color: '#666', fontSize: 12 }}>简介</div>
            {editing ? (
              <Input.TextArea
                rows={3}
                value={editForm.description}
                onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="请输入简介"
              />
            ) : (
              <div style={{ lineHeight: 1.8, whiteSpace: 'pre-wrap', color: '#555' }}>{hexagram.description || '暂无'}</div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'yao',
      label: '爻辞',
      children: (
        <div>
          {editing ? (
            <div>
              {yaoPositionLabels.map((label, i) => {
                const yao = editForm.yao_texts?.[i];
                return (
                  <div key={i} style={{ marginBottom: 16 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 4, color: '#666', fontSize: 12 }}>{label}</div>
                    <Input
                      size="small"
                      style={{ marginBottom: 4 }}
                      value={yao?.name || ''}
                      onChange={(e) => updateYaoText(i, 'name', e.target.value)}
                      placeholder={`${label}名称（如"初九"）`}
                    />
                    <Input.TextArea
                      rows={3}
                      value={yao?.text || ''}
                      onChange={(e) => updateYaoText(i, 'text', e.target.value)}
                      placeholder={`${label}爻辞`}
                    />
                  </div>
                );
              })}
            </div>
          ) : hexagram.yao_texts && hexagram.yao_texts.length > 0 ? (
            <div>
              {hexagram.yao_texts.map((yao, i) => (
                <div key={i} style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 'bold', color: '#1677ff', marginBottom: 4 }}>
                    {yao.name || yaoPositionLabels[yao.position - 1] || `第${yao.position}爻`}
                  </div>
                  <div style={{ lineHeight: 1.8, whiteSpace: 'pre-wrap', color: '#333' }}>{yao.text}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>暂无爻辞数据</div>
          )}
        </div>
      ),
    },
    {
      key: 'commentary',
      label: '传文',
      children: (
        <div>
          {editing ? (
            <Input.TextArea
              rows={12}
              value={editForm.commentary}
              onChange={(e) => setEditForm((p) => ({ ...p, commentary: e.target.value }))}
              placeholder="请输入传文（支持 Markdown 格式）"
              style={{ fontFamily: 'monospace', fontSize: 13 }}
            />
          ) : hexagram.commentary ? (
            <div className="markdown-body" style={{ fontSize: 14, lineHeight: 1.8 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                {hexagram.commentary}
              </ReactMarkdown>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>暂无传文数据</div>
          )}
        </div>
      ),
    },
    {
      key: 'tcm',
      label: '中医应用',
      children: (
        <div>
          {editing ? (
            <Input.TextArea
              rows={12}
              value={editForm.tcm_application}
              onChange={(e) => setEditForm((p) => ({ ...p, tcm_application: e.target.value }))}
              placeholder="请输入中医应用（支持 Markdown 格式）"
              style={{ fontFamily: 'monospace', fontSize: 13 }}
            />
          ) : hexagram.tcm_application ? (
            <div className="markdown-body" style={{ fontSize: 14, lineHeight: 1.8 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                {hexagram.tcm_application}
              </ReactMarkdown>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>暂无中医应用数据</div>
          )}
        </div>
      ),
    },
    {
      key: 'related',
      label: '关联卦',
      children: (
        <div>
          {hexagram.related_hexagrams ? (
            <div>
              {hexagram.related_hexagrams.mutual && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 'bold', marginBottom: 6, color: '#666', fontSize: 12 }}>互卦</div>
                  <Tag
                    color="purple"
                    style={{ cursor: 'pointer', fontSize: 14 }}
                    onClick={() => onNavigate(hexagram.related_hexagrams!.mutual)}
                  >
                    {hexagram.related_hexagrams.mutual}
                  </Tag>
                </div>
              )}
              {hexagram.related_hexagrams.opposite && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 'bold', marginBottom: 6, color: '#666', fontSize: 12 }}>错卦</div>
                  <Tag
                    color="red"
                    style={{ cursor: 'pointer', fontSize: 14 }}
                    onClick={() => onNavigate(hexagram.related_hexagrams!.opposite)}
                  >
                    {hexagram.related_hexagrams.opposite}
                  </Tag>
                </div>
              )}
              {hexagram.related_hexagrams.reverse && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 'bold', marginBottom: 6, color: '#666', fontSize: 12 }}>综卦</div>
                  <Tag
                    color="orange"
                    style={{ cursor: 'pointer', fontSize: 14 }}
                    onClick={() => onNavigate(hexagram.related_hexagrams!.reverse)}
                  >
                    {hexagram.related_hexagrams.reverse}
                  </Tag>
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>暂无关联卦数据</div>
          )}
        </div>
      ),
    },
  ];

  return (
    <Drawer
      title={drawerTitle}
      placement="right"
      width={isMobile ? 'calc(100vw - 32px)' : 520}
      open={open}
      onClose={() => {
        setEditing(false);
        onClose();
      }}
      styles={{ body: { padding: '0 16px 16px' } }}
    >
      <Tabs items={tabItems} size="small" />
    </Drawer>
  );
}
