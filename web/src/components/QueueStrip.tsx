import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, message } from 'antd';
import { CheckOutlined, SoundOutlined } from '@ant-design/icons';
import { listQueue, completeVisit, callNumber, type QueueEntry } from '../api/queue';
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
  useWebSocket('queue_clear', useCallback(() => { setEntries([]); }, []));
  useWebSocket('_reconnect', useCallback(() => { fetchQueue(); }, [fetchQueue]));

  // Derive queue sections
  const { waitingEntries, readyEntry, seeingEntry, waitingCount } = useMemo(() => {
    // Ensure sorted by seq_number
    const sorted = [...entries].sort((a, b) => a.seq_number - b.seq_number);
    const seeing = sorted.find(e => e.status === 'seeing') || null;
    const waitingAll = sorted.filter(e => e.status === 'waiting');
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

  const handleCall = async (id: number) => {
    try {
      await callNumber(id);
    } catch {
      message.error('叫号失败');
    }
  };

  // Hide completely if no active entries
  if (entries.length === 0) return null;

  const seq = (n: number) => String(n).padStart(2, '0');

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
        minHeight: isMobile ? 48 : 56,
        overflowX: 'auto',
      }}>

        {/* === Waiting Pool (left) === */}
        <div style={{
          background: 'linear-gradient(180deg, #f0f7ff, #e6f0fa)',
          padding: isMobile ? '0 12px' : '0 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderRight: '1px solid #d6e4ff',
          flexShrink: 0,
          position: 'relative',
        }}>
          <div style={{ textAlign: 'center', lineHeight: 1 }}>
            <div style={{
              fontSize: isMobile ? 22 : 28,
              fontWeight: 900,
              color: '#1677ff',
              letterSpacing: -1,
            }}>
              {waitingCount}
            </div>
            <div style={{
              fontSize: 11,
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
                  <div style={{ color: '#d9d9d9', padding: '0 2px', flexShrink: 0, fontSize: 12 }}>&rsaquo;</div>
                )}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  padding: isMobile ? '4px 8px' : '5px 10px',
                  minWidth: isMobile ? 80 : 90,
                  background: `rgba(0,0,0,${0.02 + opacity * 0.04})`,
                  borderRadius: 6,
                  fontSize: isMobile ? 12 : 13,
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
              minWidth: isMobile ? 80 : 90,
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
                fontSize: 10,
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
                width: 30, height: 30,
                background: 'linear-gradient(135deg, #ffa940, #fa8c16)',
                color: '#fff',
                borderRadius: 7,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 800,
                boxShadow: '0 2px 6px rgba(250,140,22,0.25)',
              }}>
                {seq(readyEntry.seq_number)}
              </div>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#ad6800' }}>
                {readyEntry.patient_name}
              </span>
              <Button
                size="small"
                icon={<SoundOutlined />}
                onClick={() => handleCall(readyEntry.id)}
                style={{
                  background: 'linear-gradient(135deg, #ffa940, #fa8c16)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: 12,
                  borderRadius: 6,
                  boxShadow: '0 2px 6px rgba(250,140,22,0.25)',
                  whiteSpace: 'nowrap',
                }}
              >
                叫号
              </Button>
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

          {/* Seeing chip (inline in pipe, not separated to the right) */}
          {seeingEntry && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              minWidth: isMobile ? 80 : 90,
              background: 'linear-gradient(135deg, #f6ffed, #eaffd6)',
              border: '1.5px solid #b7eb8f',
              borderRadius: 8,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              boxShadow: '0 0 0 3px rgba(82,196,26,0.08)',
            }}>
              <div style={{
                width: isMobile ? 30 : 32, height: isMobile ? 30 : 32,
                background: 'linear-gradient(135deg, #52c41a, #389e0d)',
                color: '#fff',
                borderRadius: 7,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: isMobile ? 13 : 14, fontWeight: 900,
                boxShadow: '0 2px 6px rgba(82,196,26,0.25)',
              }}>
                {seq(seeingEntry.seq_number)}
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: isMobile ? 14 : 15, color: '#135200' }}>
                  {seeingEntry.patient_name}
                </div>
                <div style={{ fontSize: 10, color: '#52c41a', fontWeight: 600 }}>
                  就诊中 {seeingEntry.room ? `· ${seeingEntry.room}` : ''}
                </div>
              </div>
              <Button
                size="small"
                icon={<SoundOutlined />}
                onClick={() => handleCall(seeingEntry.id)}
                style={{
                  color: '#52c41a',
                  border: '1px solid #b7eb8f',
                  background: '#f6ffed',
                  fontWeight: 700,
                  fontSize: isMobile ? 11 : 12,
                  borderRadius: 6,
                  whiteSpace: 'nowrap',
                }}
              >
                再叫
              </Button>
              <Button
                size="small"
                icon={<CheckOutlined />}
                onClick={() => handleComplete(seeingEntry.id)}
                style={{
                  background: 'linear-gradient(135deg, #52c41a, #389e0d)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: isMobile ? 12 : 13,
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

export interface QueueStatusInfo {
  status: 'seeing' | 'ready' | 'waiting';
  entryId: number;
}

/**
 * Hook to get the current doctor's queue status map.
 * Returns a Map of patient_name -> { status, entryId }.
 * Used by PatientList to highlight rows and trigger call actions.
 */
export function useQueueStatusMap(): Map<string, QueueStatusInfo> {
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
  useWebSocket('queue_clear', useCallback(() => { setEntries([]); }, []));
  useWebSocket('_reconnect', useCallback(() => { fetchQueue(); }, [fetchQueue]));

  return useMemo(() => {
    const map = new Map<string, QueueStatusInfo>();
    const sorted = [...entries].sort((a, b) => a.seq_number - b.seq_number);
    const waitingAll = sorted.filter(e => e.status === 'waiting');
    const seeing = sorted.find(e => e.status === 'seeing');

    if (seeing) {
      map.set(seeing.patient_name, { status: 'seeing', entryId: seeing.id });
    }
    if (waitingAll.length > 0) {
      // First waiting = ready (next)
      map.set(waitingAll[0].patient_name, { status: 'ready', entryId: waitingAll[0].id });
      for (let i = 1; i < waitingAll.length; i++) {
        map.set(waitingAll[i].patient_name, { status: 'waiting', entryId: waitingAll[i].id });
      }
    }
    return map;
  }, [entries]);
}
