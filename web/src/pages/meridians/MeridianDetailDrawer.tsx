import { useState, useEffect, useCallback } from 'react';
import { Drawer, Tag, Divider, Button, Modal, Input, Spin, message } from 'antd';
import { EditOutlined, PlayCircleOutlined, BookOutlined } from '@ant-design/icons';
import { useAuth } from '../../store/auth';
import { getMeridianResource, updateMeridianResource } from '../../api/meridian';
import type { MeridianResource } from '../../api/meridian';
import { acupoints } from './data/acupoints';
import type { MeridianData, AcupointData, SpecialPointType } from './data/types';

interface MeridianDetailDrawerProps {
  meridian: MeridianData | null;
  open: boolean;
  onClose: () => void;
  onAcupointNavigate: (acupoint: AcupointData) => void;
  isMobile?: boolean;
}

// Build a quick lookup: code -> AcupointData
const acupointMap: Record<string, AcupointData> = {};
for (const a of acupoints) {
  acupointMap[a.code] = a;
}

const FIVE_SHU: SpecialPointType[] = ['井穴', '荥穴', '输穴', '经穴', '合穴'];
const OTHER_SPECIAL: SpecialPointType[] = ['原穴', '络穴', '母穴', '子穴'];

/**
 * Convert video platform page URLs to embeddable URLs.
 * Returns { type: 'iframe', src } for platform URLs,
 *         { type: 'video', src } for direct file URLs.
 */
function parseVideoUrl(url: string): { type: 'iframe' | 'video'; src: string } {
  // Bilibili: https://www.bilibili.com/video/BV19mtyzKEmP or /BV19mtyzKEmP?p=1
  const biliMatch = url.match(/bilibili\.com\/video\/(BV[\w]+)/);
  if (biliMatch) {
    return { type: 'iframe', src: `https://player.bilibili.com/player.html?bvid=${biliMatch[1]}&page=1&high_quality=1&danmaku=0&dm=0&autoplay=0` };
  }

  // YouTube: https://www.youtube.com/watch?v=xxx or https://youtu.be/xxx
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (ytMatch) {
    return { type: 'iframe', src: `https://www.youtube.com/embed/${ytMatch[1]}` };
  }

  // Default: treat as direct video file
  return { type: 'video', src: url };
}

export default function MeridianDetailDrawer({
  meridian,
  open,
  onClose,
  onAcupointNavigate,
  isMobile,
}: MeridianDetailDrawerProps) {
  const { hasPermission } = useAuth();
  const isAdmin = hasPermission('role:manage');

  const [loading, setLoading] = useState(false);
  const [resource, setResource] = useState<MeridianResource | null>(null);

  // Edit modals
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [editVideoUrl, setEditVideoUrl] = useState('');
  const [editSourceText, setEditSourceText] = useState('');
  const [saving, setSaving] = useState(false);

  // Fetch resource when meridian changes
  const fetchResource = useCallback(async (meridianId: string) => {
    setLoading(true);
    try {
      const res = await getMeridianResource(meridianId);
      const body = res as unknown as { data: MeridianResource };
      setResource(body.data || null);
    } catch {
      setResource(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (meridian && open) {
      fetchResource(meridian.id);
    } else {
      setResource(null);
    }
  }, [meridian, open, fetchResource]);

  // Save video URL
  const handleSaveVideo = useCallback(async () => {
    if (!meridian) return;
    setSaving(true);
    try {
      await updateMeridianResource(meridian.id, {
        video_url: editVideoUrl,
        source_text: resource?.source_text || '',
      });
      message.success('视频链接已更新');
      setVideoModalOpen(false);
      fetchResource(meridian.id);
    } catch {
      message.error('更新失败');
    } finally {
      setSaving(false);
    }
  }, [meridian, editVideoUrl, resource, fetchResource]);

  // Save source text
  const handleSaveSource = useCallback(async () => {
    if (!meridian) return;
    setSaving(true);
    try {
      await updateMeridianResource(meridian.id, {
        video_url: resource?.video_url || '',
        source_text: editSourceText,
      });
      message.success('经典出处已更新');
      setSourceModalOpen(false);
      fetchResource(meridian.id);
    } catch {
      message.error('更新失败');
    } finally {
      setSaving(false);
    }
  }, [meridian, editSourceText, resource, fetchResource]);

  const handleTagClick = useCallback(
    (acupoint: AcupointData) => {
      onAcupointNavigate(acupoint);
      onClose();
    },
    [onAcupointNavigate, onClose],
  );

  const color = meridian?.color ?? '#666';
  const specialPoints = meridian?.specialPoints;
  const hasSpecialPoints = specialPoints && Object.keys(specialPoints).length > 0;

  const drawerTitle = meridian ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          display: 'inline-block',
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
      />
      {meridian.name}
    </span>
  ) : null;

  return (
    <>
      <Drawer
        placement="right"
        width={isMobile ? '100%' : 480}
        open={open}
        onClose={() => {
          // Don't close drawer while editing modal is open
          if (videoModalOpen || sourceModalOpen) return;
          onClose();
        }}
        title={drawerTitle}
      >
        {!meridian ? null : loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : (
          <>
            {/* Description */}
            <p style={{ color: '#666', fontSize: 13, marginBottom: 0 }}>{meridian.description}</p>

            <Divider />

            {/* Section 1: Special Acupoint Attributes */}
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>特殊穴位</div>
              {hasSpecialPoints ? (
                <>
                  {/* Five Shu Points */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>五输穴</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {FIVE_SHU.map(type => {
                        const code = specialPoints[type];
                        if (!code) return null;
                        const ap = acupointMap[code];
                        return (
                          <Tag
                            key={type}
                            color={color}
                            style={{ cursor: 'pointer', fontSize: 12, borderRadius: 4 }}
                            onClick={() => ap && handleTagClick(ap)}
                          >
                            {type}: {ap ? ap.name : code}({code})
                          </Tag>
                        );
                      })}
                    </div>
                  </div>

                  {/* Other special points */}
                  <div>
                    <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>其他特殊穴位</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {OTHER_SPECIAL.map(type => {
                        const code = specialPoints[type];
                        if (!code) return null;
                        const ap = acupointMap[code];
                        return (
                          <Tag
                            key={type}
                            color={color}
                            style={{ cursor: 'pointer', fontSize: 12, borderRadius: 4 }}
                            onClick={() => ap && handleTagClick(ap)}
                          >
                            {type}: {ap ? ap.name : code}({code})
                          </Tag>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ color: '#999', fontSize: 13 }}>奇经八脉无五输穴体系</div>
              )}
            </div>

            <Divider />

            {/* Section 2: Video Introduction */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <PlayCircleOutlined />
                  视频介绍
                </span>
                {isAdmin && (
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setEditVideoUrl(resource?.video_url || '');
                      setVideoModalOpen(true);
                    }}
                  />
                )}
              </div>
              {resource?.video_url ? (() => {
                const parsed = parseVideoUrl(resource.video_url);
                return parsed.type === 'iframe' ? (
                  <iframe
                    src={parsed.src}
                    width="100%"
                    style={{ borderRadius: 8, aspectRatio: '4/3', border: 'none', minHeight: 320 }}
                    allowFullScreen
                    sandbox="allow-scripts allow-same-origin allow-popups"
                  />
                ) : (
                  <video controls width="100%" src={parsed.src} style={{ borderRadius: 8 }} />
                );
              })() : (
                <div style={{ color: '#999', fontSize: 13 }}>暂无视频介绍</div>
              )}
            </div>

            <Divider />

            {/* Section 3: Source/Reference Text */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <BookOutlined />
                  经典出处
                </span>
                {isAdmin && (
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setEditSourceText(resource?.source_text || '');
                      setSourceModalOpen(true);
                    }}
                  />
                )}
              </div>
              {resource?.source_text ? (
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.8, color: '#333' }}>
                  {resource.source_text}
                </div>
              ) : (
                <div style={{ color: '#999', fontSize: 13 }}>暂无出处介绍</div>
              )}
            </div>
          </>
        )}
      </Drawer>

      {/* Video URL edit modal */}
      <Modal
        title="编辑视频链接"
        open={videoModalOpen}
        onOk={handleSaveVideo}
        onCancel={() => setVideoModalOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
      >
        <Input
          placeholder="输入视频 URL"
          value={editVideoUrl}
          onChange={e => setEditVideoUrl(e.target.value)}
        />
      </Modal>

      {/* Source text edit modal */}
      <Modal
        title="编辑经典出处"
        open={sourceModalOpen}
        onOk={handleSaveSource}
        onCancel={() => setSourceModalOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
      >
        <Input.TextArea
          rows={4}
          placeholder="输入经典出处文本"
          value={editSourceText}
          onChange={e => setEditSourceText(e.target.value)}
        />
      </Modal>
    </>
  );
}
