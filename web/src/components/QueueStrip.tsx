import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, message } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { listQueue, completeVisit, type QueueEntry } from '../api/queue';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAuth } from '../store/auth';
import useIsMobile from '../hooks/useIsMobile';

/**
 * QueueStrip - Pipe-style queue bar for the PatientList page.
 *
 * Shows the current logged-in doctor's queue in a compact horizontal strip:
 *   [waiting pool] | [queue chips ...] | [ready] | [seeing + complete btn]
 *
 * Hides completely when the doctor has no active queue entries.
 */
export default function QueueStrip() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [entries, setEntries] = useState<QueueEntry[]>([]);

  const fetchQueue = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await listQueue(user.id);
      const body = res as any;
      const list: QueueEntry[] = body.data?.list || [];
      // Only keep active entries (not done/missed)
      setEntries(list.filter(e => e.status !== 'done' && e.status !== 'missed'));
    } catch {
      /* ignore */
    }
  }, [user?.id]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  // WebSocket: auto-refresh on queue changes
  useWebSocket('queue_update', useCallback(() => { fetchQueue(); }, [fetchQueue]));
  useWebSocket('_reconnect', useCallback(() => { fetchQueue(); }, [fetchQueue]));

  // Derive queue sections
  const { waitingEntries, readyEntry, seeingEntry, waitingCount } = useMemo(() => {
    const seeing = entries.find(e => e.status === 'seeing') || null;
    const waitingAll = entries.filter(e => e.status === 'waiting');
    // "ready" is the first waiting entry (next to be seen)
    const ready = waitingAll.length > 0 ? waitingAll[0] : null;
    const waiting = waitingAll.slice(1);
    return {
      seeingEntry: seeing,
      readyEntry: ready,
      waitingEntries: waiting,
      waitingCount: waitingAll.length,
    };
  }, [entries]);

  const handleComplete = async (id: number) => {
    try {
      await completeVisit(id);
      message.success('就诊完成');
    } catch {
      message.error('操作失败');
    }
  };

  // Hide completely if no active entries
  if (entries.length === 0) return null;

  const seq = (n: number) => String(n).padStart(3, '0');

  const mobileStyle = isMobile ? {
    padding: '0 10px',
    fontSize: 11,
  } : {};

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #f0f0f0',
      borderRadius: 12,
      boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
      marginBottom: 14,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        minHeight: isMobile ? 44 : 52,
        overflowX: 'auto',
      }}>

        {/* === Waiting Pool (left) === */}
        <div style={{
          background: 'linear-gradient(180deg, #f0f7ff, #e6f0fa)',
          padding: isMobile ? '0 10px' : '0 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderRight: '1px solid #d6e4ff',
          flexShrink: 0,
          position: 'relative',
          ...mobileStyle,
        }}>
          <div style={{ textAlign: 'center', lineHeight: 1 }}>
            <div style={{
              fontSize: isMobile ? 18 : 24,
              fontWeight: 900,
              color: '#1677ff',
              letterSpacing: -1,
            }}>
              {waitingCount}
            </div>
            <div style={{
              fontSize: 9,
              color: '#4096ff',
              fontWeight: 600,
              letterSpacing: 1,
            }}>
              等候中
            </div>
          </div>
          {/* Triangle arrow */}
          <div style={{
            position: 'absolute', right: -6, top: '50%', marginTop: -6,
            width: 0, height: 0,
            borderTop: '6px solid transparent',
            borderBottom: '6px solid transparent',
            borderLeft: '6px solid #d6e4ff',
            zIndex: 2,
          }} />
          <div style={{
            position: 'absolute', right: -5, top: '50%', marginTop: -6,
            width: 0, height: 0,
            borderTop: '6px solid transparent',
            borderBottom: '6px solid transparent',
            borderLeft: '6px solid #f0f7ff',
            zIndex: 3,
          }} />
        </div>

        {/* === Queue Pipe (middle) === */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          padding: isMobile ? '6px 8px' : '8px 12px',
          gap: 0,
          overflowX: 'auto',
          background: 'linear-gradient(180deg, #fafbfc, #fff)',
        }} className="queue-strip-pipe">
          {/* Waiting chips (reverse order so nearest to front is on the right) */}
          {waitingEntries.map((entry, i) => {
            // Chips get slightly darker as they approach the front (lower index = closer to front)
            const depth = waitingEntries.length - 1 - i; // 0 = farthest, len-1 = closest
            const opacity = Math.min(0.4 + (depth / Math.max(waitingEntries.length - 1, 1)) * 0.6, 1);
            return (
              <div key={entry.id} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                {i > 0 && (
                  <div style={{ color: '#d9d9d9', padding: '0 2px', flexShrink: 0, fontSize: 10 }}>&rsaquo;</div>
                )}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: isMobile ? '3px 7px' : '4px 10px',
                  background: `rgba(0,0,0,${0.02 + opacity * 0.04})`,
                  borderRadius: 6,
                  fontSize: isMobile ? 10 : 11,
                  color: `rgba(0,0,0,${0.35 + opacity * 0.3})`,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  border: `1px solid rgba(0,0,0,${0.06 + opacity * 0.04})`,
                }}>
                  <b>{seq(entry.seq_number)}</b>&nbsp;{entry.patient_name}
                </div>
              </div>
            );
          })}

          {/* Flowing dots (orange) — only show if there's a ready entry */}
          {readyEntry && waitingEntries.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 6px', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 2 }}>
                <span className="qs-dot qs-dot-orange" style={{ animationDelay: '0s' }} />
                <span className="qs-dot qs-dot-orange" style={{ animationDelay: '0.2s' }} />
                <span className="qs-dot qs-dot-orange" style={{ animationDelay: '0.4s' }} />
              </div>
            </div>
          )}

          {/* Ready chip */}
          {readyEntry && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: 'linear-gradient(135deg, #fff7e6, #fff1d6)',
              border: '1.5px solid #ffc069',
              borderRadius: 8,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              position: 'relative',
              boxShadow: '0 0 0 3px rgba(250,140,22,0.08)',
            }}>
              <span style={{
                position: 'absolute',
                top: -9,
                left: 6,
                fontSize: 8,
                padding: '1px 6px',
                height: 16,
                lineHeight: '14px',
                borderRadius: 3,
                background: 'linear-gradient(135deg, #ffa940, #fa8c16)',
                color: '#fff',
                fontWeight: 700,
                letterSpacing: 0.5,
                animation: 'qsOrangePulse 2s infinite',
              }}>
                请准备
              </span>
              <div style={{
                width: 28, height: 28,
                background: 'linear-gradient(135deg, #ffa940, #fa8c16)',
                color: '#fff',
                borderRadius: 7,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800,
                boxShadow: '0 2px 6px rgba(250,140,22,0.25)',
              }}>
                {seq(readyEntry.seq_number)}
              </div>
              <span style={{ fontWeight: 700, fontSize: 13, color: '#ad6800' }}>
                {readyEntry.patient_name}
              </span>
            </div>
          )}

          {/* Flowing dots (green) — only show if there's a seeing entry */}
          {seeingEntry && (readyEntry || waitingEntries.length > 0) && (
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 6px', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 2 }}>
                <span className="qs-dot qs-dot-green" style={{ animationDelay: '0s' }} />
                <span className="qs-dot qs-dot-green" style={{ animationDelay: '0.2s' }} />
                <span className="qs-dot qs-dot-green" style={{ animationDelay: '0.4s' }} />
              </div>
            </div>
          )}
        </div>

        {/* === Seeing (right) === */}
        {seeingEntry && (
          <div style={{
            background: 'linear-gradient(180deg, #f6ffed, #eaffd6)',
            padding: isMobile ? '0 10px' : '0 16px',
            display: 'flex',
            alignItems: 'center',
            gap: isMobile ? 6 : 10,
            borderLeft: '1px solid #b7eb8f',
            flexShrink: 0,
            position: 'relative',
          }}>
            {/* Left triangle arrow */}
            <div style={{
              position: 'absolute', left: -6, top: '50%', marginTop: -6,
              width: 0, height: 0,
              borderTop: '6px solid transparent',
              borderBottom: '6px solid transparent',
              borderRight: '6px solid #b7eb8f',
              zIndex: 2,
            }} />
            <div style={{
              position: 'absolute', left: -5, top: '50%', marginTop: -6,
              width: 0, height: 0,
              borderTop: '6px solid transparent',
              borderBottom: '6px solid transparent',
              borderRight: '6px solid #f6ffed',
              zIndex: 3,
            }} />

            <div style={{
              width: isMobile ? 28 : 36, height: isMobile ? 28 : 36,
              background: 'linear-gradient(135deg, #52c41a, #389e0d)',
              color: '#fff',
              borderRadius: 9,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: isMobile ? 11 : 13, fontWeight: 900,
              boxShadow: '0 2px 8px rgba(82,196,26,0.3)',
              flexShrink: 0,
            }}>
              {seq(seeingEntry.seq_number)}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: isMobile ? 12 : 14, color: '#135200' }}>
                {seeingEntry.patient_name}
              </div>
              <div style={{ fontSize: 9, color: '#52c41a', fontWeight: 600 }}>
                就诊中 {seeingEntry.room ? `· ${seeingEntry.room}` : ''}
              </div>
            </div>
            <Button
              size="small"
              icon={<CheckOutlined />}
              onClick={() => handleComplete(seeingEntry.id)}
              style={{
                background: 'linear-gradient(135deg, #52c41a, #389e0d)',
                color: '#fff',
                border: 'none',
                fontWeight: 700,
                fontSize: isMobile ? 10 : 11,
                borderRadius: 6,
                boxShadow: '0 2px 6px rgba(82,196,26,0.3)',
                whiteSpace: 'nowrap',
              }}
            >
              完成
            </Button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes qsOrangePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        @keyframes qsFlow {
          0% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
          100% { opacity: 0.3; transform: scale(0.8); }
        }
        .qs-dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          display: inline-block;
          animation: qsFlow 1.2s infinite;
        }
        .qs-dot-orange { background: #ffa940; }
        .qs-dot-green { background: #73d13d; }
        .queue-strip-pipe::-webkit-scrollbar { height: 3px; }
        .queue-strip-pipe::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 2px; }
        .queue-strip-pipe::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
  );
}

/**
 * Hook to get the current doctor's queue status map.
 * Returns a Map of patient_name -> queue status ('seeing' | 'ready' | 'waiting').
 * Used by PatientList to highlight rows.
 */
export function useQueueStatusMap(): Map<string, 'seeing' | 'ready' | 'waiting'> {
  const { user } = useAuth();
  const [entries, setEntries] = useState<QueueEntry[]>([]);

  const fetchQueue = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await listQueue(user.id);
      const body = res as any;
      const list: QueueEntry[] = body.data?.list || [];
      setEntries(list.filter(e => e.status !== 'done' && e.status !== 'missed'));
    } catch {
      /* ignore */
    }
  }, [user?.id]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  useWebSocket('queue_update', useCallback(() => { fetchQueue(); }, [fetchQueue]));
  useWebSocket('_reconnect', useCallback(() => { fetchQueue(); }, [fetchQueue]));

  return useMemo(() => {
    const map = new Map<string, 'seeing' | 'ready' | 'waiting'>();
    const waitingAll = entries.filter(e => e.status === 'waiting');
    const seeing = entries.find(e => e.status === 'seeing');

    if (seeing) {
      map.set(seeing.patient_name, 'seeing');
    }
    if (waitingAll.length > 0) {
      // First waiting = ready (next)
      map.set(waitingAll[0].patient_name, 'ready');
      for (let i = 1; i < waitingAll.length; i++) {
        map.set(waitingAll[i].patient_name, 'waiting');
      }
    }
    return map;
  }, [entries]);
}
