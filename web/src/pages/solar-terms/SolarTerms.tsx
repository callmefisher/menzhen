import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Drawer, Input, message, Popconfirm, Space, Spin, Tooltip } from 'antd';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useAuth } from '../../store/auth';
import useIsMobile from '../../hooks/useIsMobile';
import SpeechButton from '../../components/SpeechButton';
import { listSolarTerms, updateSolarTerm, deleteSolarTermContent } from '../../api/solarTerm';
import type { SolarTermItem } from '../../api/solarTerm';

const { TextArea } = Input;

const SEASON_COLORS: Record<string, string> = {
  春: '#6dd400',
  夏: '#ff9500',
  秋: '#00b4ff',
  冬: '#a855f7',
};
const SEASON_GLOW: Record<string, string> = {
  春: '#6dd40080',
  夏: '#ff950080',
  秋: '#00b4ff80',
  冬: '#a855f780',
};
const CURRENT_COLOR = '#ff4d4f';
const NEXT_COLOR = '#6dd400';

// SVG layout constants
const VIEW_SIZE = 500;
const CENTER = VIEW_SIZE / 2;
const RING_RADIUS = 190;
const DOT_R = 7;
const DOT_R_SMALL = 5;
const LABEL_OFFSET = 56;

/** Convert order_index (1-24) to angle in radians. Top = 立春 = -90°. */
function indexToAngle(orderIndex: number): number {
  return ((orderIndex - 1) * 15 - 90) * (Math.PI / 180);
}

/** Get x,y on circle for given angle. */
function circleXY(angle: number, r = RING_RADIUS): [number, number] {
  return [CENTER + r * Math.cos(angle), CENTER + r * Math.sin(angle)];
}

/** Determine current solar term from today's date. Returns order_index (1-24). */
function getCurrentTermIndex(terms: SolarTermItem[]): number {
  const now = new Date();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const nowKey = m * 100 + d;

  const sorted = [...terms].sort((a, b) => {
    const aKey = a.order_index >= 23 ? a.month * 100 + a.day - 10000 : a.month * 100 + a.day;
    const bKey = b.order_index >= 23 ? b.month * 100 + b.day - 10000 : b.month * 100 + b.day;
    return aKey - bKey;
  });

  let result = sorted[sorted.length - 1].order_index;
  for (const t of sorted) {
    const tStart = t.month * 100 + t.day;
    if (nowKey >= tStart) {
      result = t.order_index;
    }
  }
  return result;
}

/** Build SVG arc path for a quarter of the circle. */
function seasonArc(startIdx: number, endIdx: number): string {
  const a1 = indexToAngle(startIdx);
  const a2 = indexToAngle(endIdx);
  const [x1, y1] = circleXY(a1);
  const [x2, y2] = circleXY(a2);
  return `M ${x1} ${y1} A ${RING_RADIUS} ${RING_RADIUS} 0 0 1 ${x2} ${y2}`;
}

/** Format date range string. */
function formatDateRange(t: SolarTermItem): string {
  return `${t.month}月${t.day}日 至 ${t.end_month}月${t.end_day}日`;
}

/** CSS keyframes injected once */
const STYLE_ID = 'solar-terms-styles';
function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes st-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes st-rotate-rev { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
    @keyframes st-pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 0.15; } }
    @keyframes st-glow-pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
    @keyframes st-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
    @keyframes st-twinkle { 0%,100% { opacity: 0.15; } 50% { opacity: 0.6; } }
    .st-dot { cursor: pointer; }
    .st-dot:hover circle[data-dot] { opacity: 1 !important; }
  `;
  document.head.appendChild(style);
}

export default function SolarTerms() {
  const [terms, setTerms] = useState<SolarTermItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const isMobile = useIsMobile();
  const { hasPermission } = useAuth();
  const isAdmin = hasPermission('role:manage');

  useEffect(() => { ensureStyles(); }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listSolarTerms();
      if (res.code === 0 && res.data) {
        setTerms(res.data);
      }
    } catch {
      message.error('加载节气数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const { currentIdx, nextIdx, daysToNext } = useMemo(() => {
    if (terms.length === 0) return { currentIdx: 0, nextIdx: 0, daysToNext: 0 };
    const ci = getCurrentTermIndex(terms);
    const ni = ci >= 24 ? 1 : ci + 1;
    const nextTerm = terms.find(t => t.order_index === ni);
    let days = 0;
    if (nextTerm) {
      const now = new Date();
      const year = now.getFullYear();
      let nextDate = new Date(year, nextTerm.month - 1, nextTerm.day);
      if (nextDate < now) nextDate = new Date(year + 1, nextTerm.month - 1, nextTerm.day);
      days = Math.ceil((nextDate.getTime() - now.getTime()) / 86400000);
    }
    return { currentIdx: ci, nextIdx: ni, daysToNext: days };
  }, [terms]);

  const selectedTerm = useMemo(() => terms.find(t => t.id === selectedId), [terms, selectedId]);
  const currentTerm = useMemo(() => terms.find(t => t.order_index === currentIdx), [terms, currentIdx]);
  const nextTerm = useMemo(() => terms.find(t => t.order_index === nextIdx), [terms, nextIdx]);

  useEffect(() => {
    if (currentTerm && !selectedId) {
      setSelectedId(currentTerm.id);
      setDrawerOpen(true);
    }
  }, [currentTerm, selectedId]);

  const handleDotClick = (term: SolarTermItem) => {
    setSelectedId(term.id);
    setDrawerOpen(true);
    setEditing(false);
  };

  const handleSave = async () => {
    if (!selectedTerm) return;
    try {
      setSaving(true);
      await updateSolarTerm(selectedTerm.id, editContent);
      message.success('保存成功');
      setEditing(false);
      await loadData();
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedTerm) return;
    try {
      await deleteSolarTermContent(selectedTerm.id);
      message.success('内容已清空');
      await loadData();
    } catch {
      message.error('删除失败');
    }
  };

  const handleEdit = () => {
    setEditContent(selectedTerm?.content || '');
    setEditing(true);
  };

  // Decorative star positions (seeded for consistency) — must be before early return
  const stars = useMemo(() => {
    const s: { x: number; y: number; r: number; delay: number }[] = [];
    for (let i = 0; i < 40; i++) {
      const seed = (i * 137.508) % 1;
      const seed2 = ((i + 7) * 97.3) % 1;
      s.push({
        x: (seed * VIEW_SIZE * 0.9) + VIEW_SIZE * 0.05,
        y: (seed2 * VIEW_SIZE * 0.9) + VIEW_SIZE * 0.05,
        r: 0.4 + seed * 0.8,
        delay: seed2 * 4,
      });
    }
    return s;
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <Spin size="large" />
      </div>
    );
  }

  const landmarkTerms = [1, 7, 13, 19];
  const svgSize = isMobile ? 380 : 480;

  return (
    <div style={{
      minHeight: '100%',
      background: 'linear-gradient(160deg, #0a0e27 0%, #141937 30%, #1a1040 60%, #0d1117 100%)',
      padding: isMobile ? '16px 8px' : '32px 24px',
      borderRadius: isMobile ? 0 : 12,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: isMobile ? 8 : 16, position: 'relative', zIndex: 1 }}>
        <div style={{
          fontSize: isMobile ? 30 : 28,
          fontWeight: 700,
          background: 'linear-gradient(135deg, #e8d5b7, #f5e6cc, #d4a574)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          letterSpacing: isMobile ? 8 : 10,
          fontFamily: 'serif',
        }}>
          二十四节气
        </div>
        <div style={{
          fontSize: isMobile ? 15 : 13,
          color: '#6b7280',
          marginTop: 4,
          letterSpacing: 2,
        }}>
          天人合一 · 顺时养生
        </div>
      </div>

      {/* SVG Ring */}
      <div style={{ display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
        <svg viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} width={svgSize} height={svgSize} style={{ cursor: 'pointer' }}>
          <defs>
            {/* Season glow filters */}
            {(['春', '夏', '秋', '冬'] as const).map(s => (
              <filter key={`glow-${s}`} id={`glow-${s}`} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feFlood floodColor={SEASON_COLORS[s]} floodOpacity="0.6" />
                <feComposite in2="blur" operator="in" />
                <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            ))}
            <filter id="glow-current" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feFlood floodColor={CURRENT_COLOR} floodOpacity="0.6" />
              <feComposite in2="blur" operator="in" />
              <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="glow-next" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feFlood floodColor={NEXT_COLOR} floodOpacity="0.5" />
              <feComposite in2="blur" operator="in" />
              <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            {/* Center gradient */}
            <radialGradient id="center-bg" cx="50%" cy="50%">
              <stop offset="0%" stopColor="#1e2545" />
              <stop offset="100%" stopColor="#141937" />
            </radialGradient>
            <radialGradient id="center-ring-grad" cx="50%" cy="50%">
              <stop offset="0%" stopColor="#e8d5b780" />
              <stop offset="100%" stopColor="#e8d5b720" />
            </radialGradient>
            {/* Outer decorative ring gradient */}
            <linearGradient id="outer-ring-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#e8d5b730" />
              <stop offset="50%" stopColor="#e8d5b710" />
              <stop offset="100%" stopColor="#e8d5b730" />
            </linearGradient>
          </defs>

          {/* Background twinkling stars */}
          {stars.map((st, i) => (
            <circle key={`star-${i}`} cx={st.x} cy={st.y} r={st.r} fill="#e8d5b7"
              style={{ animation: `st-twinkle ${2 + st.delay}s ease-in-out ${st.delay}s infinite` }} />
          ))}

          {/* Outer decorative ring */}
          <circle cx={CENTER} cy={CENTER} r={RING_RADIUS + 18} fill="none" stroke="url(#outer-ring-grad)" strokeWidth={0.5} />
          <circle cx={CENTER} cy={CENTER} r={RING_RADIUS - 14} fill="none" stroke="#e8d5b715" strokeWidth={0.3} />

          {/* Rotating decorative dashes on outer orbit */}
          <g style={{ animation: 'st-rotate 120s linear infinite', transformOrigin: `${CENTER}px ${CENTER}px` }}>
            {Array.from({ length: 72 }).map((_, i) => {
              const a = (i * 5) * Math.PI / 180;
              const [x1, y1] = circleXY(a, RING_RADIUS + 22);
              const [x2, y2] = circleXY(a, RING_RADIUS + 25);
              return <line key={`tick-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#e8d5b718" strokeWidth={0.5} />;
            })}
          </g>

          {/* Season arcs — thicker, glowing */}
          {([
            { season: '春' as const, start: 1, end: 7 },
            { season: '夏' as const, start: 7, end: 13 },
            { season: '秋' as const, start: 13, end: 19 },
            { season: '冬' as const, start: 19, end: 25 },
          ]).map(({ season, start, end }) => (
            <g key={season}>
              {/* Glow layer */}
              <path d={seasonArc(start, end)} fill="none" stroke={SEASON_GLOW[season]}
                strokeWidth={12} strokeLinecap="round" opacity={0.3} />
              {/* Main arc */}
              <path d={seasonArc(start, end)} fill="none" stroke={SEASON_COLORS[season]}
                strokeWidth={3} strokeLinecap="round" opacity={0.85} />
            </g>
          ))}

          {/* Season text labels — larger */}
          {(['春', '夏', '秋', '冬'] as const).map((s, i) => {
            const midIdx = [4, 10, 16, 22][i];
            const angle = indexToAngle(midIdx);
            const [x, y] = circleXY(angle, RING_RADIUS + LABEL_OFFSET);
            return (
              <text key={s} x={x} y={y} fill={SEASON_COLORS[s]} fontSize={isMobile ? 18 : 16} fontWeight="bold"
                textAnchor="middle" dominantBaseline="central" opacity={0.9}
                style={{ textShadow: `0 0 8px ${SEASON_GLOW[s]}` }}>
                {s}
              </text>
            );
          })}

          {/* 24 dots */}
          {terms.map(t => {
            const angle = indexToAngle(t.order_index);
            const [cx, cy] = circleXY(angle);
            const isCurrent = t.order_index === currentIdx;
            const isNext = t.order_index === nextIdx;
            const isPast = t.order_index < currentIdx;
            const isLandmark = landmarkTerms.includes(t.order_index);
            const dotRadius = isCurrent ? DOT_R + 2 : isLandmark ? DOT_R : DOT_R_SMALL;
            const color = isCurrent ? CURRENT_COLOR : SEASON_COLORS[t.season] || '#999';
            const opacity = isCurrent ? 1 : isPast ? 0.7 : 0.45;

            return (
              <g key={t.id} onClick={() => handleDotClick(t)} className="st-dot">
                {/* Click target */}
                <circle cx={cx} cy={cy} r={18} fill="transparent" />

                <Tooltip title={`${t.name}  ${t.month}月${t.day}日`} open={isMobile ? false : undefined}>
                  <circle cx={cx} cy={cy} r={dotRadius} fill={color} opacity={opacity} data-dot=""
                    filter={isCurrent ? 'url(#glow-current)' : isNext ? 'url(#glow-next)' : undefined} />
                </Tooltip>

                {/* Current: steady glow ring */}
                {isCurrent && (
                  <>
                    <circle cx={cx} cy={cy} r={11} fill="none" stroke={CURRENT_COLOR} strokeWidth={1.2}
                      style={{ animation: 'st-pulse 2.5s ease-in-out infinite' }} />
                    {/* Name label with background */}
                    <rect x={cx + 14} y={cy - 18} width={t.name.length * 14 + 8} height={20} rx={4}
                      fill="#ff4d4f30" stroke="#ff4d4f60" strokeWidth={0.5} />
                    <text x={cx + 18} y={cy - 5} fill={CURRENT_COLOR} fontSize={isMobile ? 16 : 13} fontWeight="bold">
                      {t.name}
                    </text>
                  </>
                )}

                {/* Next: dashed ring + label */}
                {isNext && (
                  <>
                    <circle cx={cx} cy={cy} r={10} fill="none" stroke={NEXT_COLOR} strokeWidth={1.2}
                      strokeDasharray="4,3" opacity={0.8}>
                      <animateTransform attributeName="transform" type="rotate"
                        from={`0 ${cx} ${cy}`} to={`360 ${cx} ${cy}`} dur="8s" repeatCount="indefinite" />
                    </circle>
                    <text x={cx + 14} y={cy - 4} fill={NEXT_COLOR} fontSize={isMobile ? 15 : 12} opacity={0.9}
                      fontWeight="500">{t.name}</text>
                  </>
                )}

                {/* Term name labels — all 24 terms, both desktop and mobile */}
                {!isCurrent && !isNext && (() => {
                  const isLM = isLandmark;
                  // All labels outside the ring; landmarks further out
                  const labelR = isLM
                    ? RING_RADIUS + (isMobile ? 34 : 32)
                    : RING_RADIUS + (isMobile ? 20 : 18);
                  const [lx, ly] = circleXY(angle, labelR);
                  const deg = (t.order_index - 1) * 15 - 90;
                  const anchor = Math.abs(deg + 90) < 10 || Math.abs(deg - 90) < 10 ? 'middle'
                    : deg > -90 && deg < 90 ? 'start' : 'end';
                  return (
                    <text x={lx} y={ly}
                      fill={isLM ? SEASON_COLORS[t.season] : '#9ca3af'}
                      fontSize={isLM ? (isMobile ? 14 : 13) : (isMobile ? 12 : 12)}
                      textAnchor={anchor} dominantBaseline="central"
                      opacity={isLM ? 0.85 : 0.6} fontWeight={isLM ? '600' : '400'}>
                      {t.name}
                    </text>
                  );
                })()}
              </g>
            );
          })}

          {/* Center area — glass morphism */}
          <circle cx={CENTER} cy={CENTER} r={100} fill="url(#center-bg)" opacity={0.95} />
          <circle cx={CENTER} cy={CENTER} r={100} fill="none" stroke="url(#center-ring-grad)" strokeWidth={1} />

          {/* Inner decorative ring */}
          <g style={{ animation: 'st-rotate-rev 90s linear infinite', transformOrigin: `${CENTER}px ${CENTER}px` }}>
            <circle cx={CENTER} cy={CENTER} r={92} fill="none" stroke="#e8d5b715" strokeWidth={0.3}
              strokeDasharray="8,12" />
          </g>

          {currentTerm && (
            <g style={{ animation: 'st-float 4s ease-in-out infinite' }}>
              <text x={CENTER} y={CENTER - 30} fill="#e8d5b7" fontSize={isMobile ? 40 : 36} fontWeight="bold"
                textAnchor="middle" style={{ fontFamily: 'serif' }}>
                {currentTerm.name}
              </text>
              <text x={CENTER} y={CENTER - 8} fill="#8b95a8" fontSize={isMobile ? 14 : 12} textAnchor="middle">
                {formatDateRange(currentTerm)}
              </text>
              {/* Decorative divider */}
              <line x1={CENTER - 40} y1={CENTER + 6} x2={CENTER + 40} y2={CENTER + 6} stroke="#e8d5b730" strokeWidth={0.8} />
              <circle cx={CENTER - 44} cy={CENTER + 6} r={1.5} fill="#e8d5b740" />
              <circle cx={CENTER + 44} cy={CENTER + 6} r={1.5} fill="#e8d5b740" />

              <text x={CENTER} y={CENTER + 28} fill="#d4d4d8" fontSize={isMobile ? 18 : 16} fontWeight="600" textAnchor="middle"
                letterSpacing={2}>
                第 {currentIdx} / 24 节气
              </text>
              {nextTerm && (
                <text x={CENTER} y={CENTER + 50} fill={NEXT_COLOR} fontSize={isMobile ? 14 : 12} textAnchor="middle" opacity={0.9}>
                  {nextTerm.name} · {daysToNext}天后
                </text>
              )}
            </g>
          )}
        </svg>
      </div>

      {/* Hint */}
      <div style={{
        textAlign: 'center',
        color: '#6b7280',
        fontSize: isMobile ? 14 : 12,
        margin: '8px 0 0',
        position: 'relative',
        zIndex: 1,
        letterSpacing: 1,
      }}>
        点击节气查看养生详情
      </div>

      {/* Drawer */}
      <Drawer
        title={null}
        placement={isMobile ? 'bottom' : 'right'}
        {...(isMobile ? { height: '75vh' } : { width: 420 })}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setEditing(false); }}
        styles={{ body: { padding: 0 } }}
      >
        {selectedTerm && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Drawer header */}
            <div style={{
              padding: '16px 20px',
              background: 'linear-gradient(135deg, #0a0e27, #1a1040)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <div>
                <span style={{
                  fontSize: 20, fontWeight: 'bold', fontFamily: 'serif',
                  background: 'linear-gradient(135deg, #e8d5b7, #f5e6cc)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                }}>{selectedTerm.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <span style={{
                    color: '#b8c0cc', fontSize: 13, fontVariantNumeric: 'tabular-nums',
                  }}>{selectedTerm.month}月{selectedTerm.day}日</span>
                  <span style={{ color: '#555d6e', fontSize: 11 }}>至</span>
                  <span style={{
                    color: '#b8c0cc', fontSize: 13, fontVariantNumeric: 'tabular-nums',
                  }}>{selectedTerm.end_month}月{selectedTerm.end_day}日</span>
                </div>
              </div>
              {!editing && (
                <Space size={4}>
                  <SpeechButton getText={() => {
                    const t = selectedTerm;
                    const dateRange = `${t.month}月${t.day}日到${t.end_month}月${t.end_day}日`;
                    if (t.content) {
                      return `${t.name}，${dateRange}。${t.content}`;
                    }
                    return `${t.name}，${dateRange}，暂无养生内容`;
                  }} />
                  {isAdmin && (
                    <>
                      <Button type="primary" size="small" icon={<EditOutlined />} onClick={handleEdit}>编辑</Button>
                      <Popconfirm title="确认清空该节气的养生内容？" onConfirm={handleDelete} okText="确认" cancelText="取消">
                        <Button danger size="small" icon={<DeleteOutlined />}>删除</Button>
                      </Popconfirm>
                    </>
                  )}
                </Space>
              )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
              {editing ? (
                <div>
                  <TextArea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    rows={isMobile ? 10 : 16}
                    placeholder="请输入 Markdown 格式的养生内容..."
                    style={{ marginBottom: 12, fontFamily: 'monospace', fontSize: 13 }}
                  />
                  <Space>
                    <Button type="primary" onClick={handleSave} loading={saving}>保存</Button>
                    <Button onClick={() => setEditing(false)}>取消</Button>
                  </Space>
                </div>
              ) : selectedTerm.content ? (
                <div className="markdown-body" style={{ fontSize: 14, lineHeight: 1.8 }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                    {selectedTerm.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '60px 0', color: '#999' }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>☯</div>
                  <div>暂无养生内容</div>
                  {isAdmin && (
                    <Button type="link" onClick={handleEdit} style={{ marginTop: 8 }}>点击编辑添加</Button>
                  )}
                </div>
              )}
            </div>

            {/* Footer hint */}
            {editing && (
              <div style={{
                padding: '8px 16px',
                background: '#fffbe6',
                borderTop: '1px solid #ffe58f',
                fontSize: 11,
                color: '#ad8b00',
                flexShrink: 0,
              }}>
                支持 Markdown 格式（标题、列表、加粗等）
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
