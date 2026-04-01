import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Select, Slider, Tooltip, Modal, message } from 'antd';
import { SoundOutlined, DeleteOutlined, PlusOutlined, CalendarOutlined } from '@ant-design/icons';
import { listQueue, takeNumber, callNumber, completeVisit, clearQueue, type QueueEntry } from '../../api/queue';
import { checkinAppointment } from '../../api/appointment';
import { listQueueDoctors, getCallDisplayDuration, getShowArrivalTime, type QueueDoctor as QueueDoctorConfig } from '../../api/queue-doctor';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useAuth } from '../../store/auth';
import useIsMobile from '../../hooks/useIsMobile';
import CallOverlay from '../../components/CallOverlay';
import AppointmentModal from '../../components/AppointmentModal';
import { formatRoom, formatQueueTime, formatQueueTimeFull } from '../../utils/format';

const DOCTOR_COLORS = ['#52c41a', '#faad14', '#722ed1', '#cf1322', '#1677ff', '#13c2c2', '#eb2f96', '#fa541c'];

interface DoctorGroup {
  doctorId: number;
  doctorName: string;
  room: string;
  entries: QueueEntry[];
}

interface CallNotification {
  seq: number;
  name: string;
  room: string;
  doctor: string;
}

interface DoctorCallState {
  queue: CallNotification[];
  current: CallNotification | null;
}

interface DoctorOption {
  id: number;
  name: string;
  room: string;
}

export default function QueueDashboard() {
  const { hasPermission } = useAuth();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [takeNameValue, setTakeNameValue] = useState('');
  const [takeDoctorId, setTakeDoctorId] = useState<number | undefined>();
  const [takeLoading, setTakeLoading] = useState(false);
  // Per-doctor call state: queue + current merged into one atomic unit
  const [doctorCallStates, setDoctorCallStates] = useState<Record<number, DoctorCallState>>({});
  const [callDurationMs, setCallDurationMs] = useState(10000);
  const [showArrivalTime, setShowArrivalTime] = useState<boolean | null>(null);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [checkinLoading, setCheckinLoading] = useState<Record<number, boolean>>({});
  const [apptModalOpen, setApptModalOpen] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => {
    // SSR compatibility: check if document is available
    if (typeof document !== 'undefined') {
      return !document.hidden;
    }
    return true;
  });

  // Page visibility detection (single listener at parent level)
  useEffect(() => {
    const handleVisibilityChange = () => {
      setPageVisible(!document.hidden);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Fetch queue data
  const fetchQueue = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listQueue();
      const body = res as unknown as { data?: { list?: QueueEntry[] } };
      const list: QueueEntry[] = body.data?.list || [];
      setEntries(list);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch call display duration from tenant settings
  useEffect(() => {
    (async () => {
      try {
        const res = await getCallDisplayDuration();
        const body = res as unknown as { data?: { seconds?: number } };
        const seconds: number = body.data?.seconds ?? 10;
        setCallDurationMs(seconds * 1000);
      } catch {
        // default 10s
      }
    })();
  }, []);

  // Fetch show arrival time setting
  useEffect(() => {
    (async () => {
      try {
        const res = await getShowArrivalTime();
        const body = res as unknown as { data?: { show?: boolean } };
        setShowArrivalTime(body.data?.show ?? true);
      } catch {
        setShowArrivalTime(true);
      }
    })();
  }, []);

  // Per-doctor dequeue: atomic single-setState to avoid race between two separate states
  useEffect(() => {
    setDoctorCallStates(prev => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        const doctorId = Number(key);
        const state = next[doctorId];
        if (state.current === null && state.queue.length > 0) {
          const [nextCall, ...rest] = state.queue;
          next[doctorId] = { queue: rest, current: nextCall };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [doctorCallStates]);

  const handleCallClose = useCallback((doctorId: number) => {
    setDoctorCallStates(prev => ({
      ...prev,
      [doctorId]: { ...prev[doctorId], current: null },
    }));
  }, []);

  // Fetch doctors for take-number dropdown
  useEffect(() => {
    (async () => {
      try {
        const res = await listQueueDoctors();
        const body = res as unknown as { data?: { list?: QueueDoctorConfig[] } };
        const list: QueueDoctorConfig[] = body.data?.list || [];
        const docs: DoctorOption[] = list
          .filter(d => d.enabled)
          .map(d => ({ id: d.user_id, name: d.user_name, room: d.room }));
        setDoctors(docs);
        // Default select first enabled doctor (functional update avoids stale closure)
        if (docs.length > 0) {
          setTakeDoctorId(prev => prev ?? docs[0].id);
        }
      } catch {
        /* fallback: derive from queue data */
      }
    })();
  }, []);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  // WebSocket listeners
  useWebSocket('queue_update', useCallback(() => {
    fetchQueue();
  }, [fetchQueue]));

  useWebSocket('queue_call', useCallback((msg: unknown) => {
    const payload = (msg as { payload?: { doctor_id?: number; seq?: number; patient_name?: string; room?: string; doctor_name?: string } })?.payload;
    const { doctor_id, seq, patient_name, room, doctor_name } = payload || {};
    if (seq && seq > 0 && doctor_id) {
      const notification: CallNotification = { seq, name: patient_name ?? '', room: room ?? '', doctor: doctor_name ?? '' };
      setDoctorCallStates(prev => {
        const existing = prev[doctor_id] ?? { queue: [], current: null };
        return { ...prev, [doctor_id]: { ...existing, queue: [...existing.queue, notification] } };
      });
    }
  }, []));

  useWebSocket('queue_clear', useCallback(() => {
    setEntries([]);
    setDoctorCallStates({});
  }, []));

  useWebSocket('_reconnect', useCallback(() => {
    fetchQueue();
  }, [fetchQueue]));

  // Group entries by doctor
  const doctorGroups: DoctorGroup[] = useMemo(() => {
    const map = new Map<number, DoctorGroup>();
    for (const e of entries) {
      if (e.status === 'done' || e.status === 'missed') continue;
      if (!map.has(e.doctor_id)) {
        map.set(e.doctor_id, {
          doctorId: e.doctor_id,
          doctorName: e.doctor_name,
          room: e.room,
          entries: [],
        });
      }
      map.get(e.doctor_id)!.entries.push(e);
    }
    // Sort each doctor's entries by seq_number
    for (const group of map.values()) {
      group.entries.sort((a, b) => a.seq_number - b.seq_number);
    }
    return Array.from(map.values());
  }, [entries]);

  // Stats
  const stats = useMemo(() => {
    let waiting = 0, seeing = 0, done = 0;
    for (const e of entries) {
      if (e.status === 'waiting' || e.status === 'ready') waiting++;
      else if (e.status === 'seeing') seeing++;
      else if (e.status === 'done') done++;
    }
    return { waiting, seeing, done };
  }, [entries]);

  // Doctor options for take-number (merge from queue data + user list)
  const doctorOptions = useMemo(() => {
    const seen = new Set<number>();
    const opts: DoctorOption[] = [];
    // From queue data first
    for (const g of doctorGroups) {
      if (!seen.has(g.doctorId)) {
        seen.add(g.doctorId);
        opts.push({ id: g.doctorId, name: g.doctorName, room: g.room });
      }
    }
    // From user list
    for (const d of doctors) {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        opts.push(d);
      }
    }
    return opts;
  }, [doctorGroups, doctors]);

  // Handle take number
  const handleTakeNumber = async () => {
    if (!takeNameValue.trim()) {
      message.warning('请输入患者姓名');
      return;
    }
    if (!takeDoctorId) {
      message.warning('请选择医生');
      return;
    }
    const doc = doctorOptions.find(d => d.id === takeDoctorId);
    if (!doc) return;

    try {
      setTakeLoading(true);
      const res = await takeNumber({
        patient_name: takeNameValue.trim(),
        doctor_id: takeDoctorId,
        doctor_name: doc.name,
        room: doc.room,
      });
      const body = res as unknown as { data?: { seq_number?: number; arrival_time?: string } };
      const entry = body.data;
      const seqStr = String(entry?.seq_number || '').padStart(2, '0');
      let successMsg = `${takeNameValue.trim()} 取号成功 -> ${seqStr}号 - ${doc.name}`;
      if (showArrivalTime && entry?.arrival_time) {
        const timeStr = formatQueueTimeFull(entry.arrival_time);
        if (timeStr) successMsg += `（入队 ${timeStr}）`;
      }
      message.success(successMsg);
      setTakeNameValue('');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as { message?: string })?.message ??
        '';
      if (msg.includes('已在排队')) {
        message.warning(msg);
      } else {
        message.error('取号失败');
      }
    } finally {
      setTakeLoading(false);
    }
  };

  // Handle call
  const handleCall = async (entry: QueueEntry) => {
    try {
      await callNumber(entry.id);
    } catch {
      message.error('叫号失败');
    }
  };

  // Handle complete
  const handleComplete = async (entry: QueueEntry) => {
    try {
      await completeVisit(entry.id);
    } catch {
      message.error('完成就诊失败');
    }
  };

  // Handle appointment checkin
  const handleCheckin = useCallback(async (apptId: number, entryId: number) => {
    setCheckinLoading(prev => ({ ...prev, [entryId]: true }));
    try {
      await checkinAppointment(apptId);
      await fetchQueue();
    } catch {
      message.error('签到失败');
    } finally {
      setCheckinLoading(prev => ({ ...prev, [entryId]: false }));
    }
  }, [fetchQueue]);

  // Handle clear
  const handleClear = () => {
    Modal.confirm({
      title: '一键清空',
      content: '确定要清空今日所有排队记录吗？此操作不可撤销。',
      okText: '确定清空',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await clearQueue();
          message.success('已清空');
        } catch {
          message.error('清空失败');
        }
      },
    });
  };

  // Grid columns
  const gridCols = useMemo(() => {
    const count = doctorGroups.length;
    if (count <= 1) return '1fr';
    if (count === 2) return '1fr 1fr';
    return 'repeat(2, 1fr)';
  }, [doctorGroups.length]);

  // Speed label
  const speedLabel = useMemo(() => {
    if (speed === 0) return '停';
    if (speed <= 15) return '极慢';
    if (speed <= 35) return '慢';
    if (speed <= 55) return '中';
    if (speed <= 75) return '快';
    return '极快';
  }, [speed]);

  // Stats row (shared between mobile and desktop)
  const statsRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700 }}>排队叫号</span>
      <StatBadge count={stats.waiting} label="候诊" color="#1677ff" bgFrom="#e6f7ff" bgTo="#f0f5ff" border="#d6e4ff" />
      <StatBadge count={stats.seeing} label="就诊" color="#52c41a" bgFrom="#f6ffed" bgTo="#fcffe6" border="#d9f7be" />
      <StatBadge count={stats.done} label="已完成" color="#8c8c8c" bgFrom="#f9f9f9" bgTo="#f5f5f5" border="#e8e8e8" />
      {hasPermission('queue:clear') && (
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={handleClear}
          style={{ marginLeft: 'auto' }}
        >
          一键清空
        </Button>
      )}
    </div>
  );

  // Take-number bar (shared)
  const takeNumberBar = hasPermission('queue:create') && (
    <div style={{
      display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
      gap: 8, marginTop: 10, flexShrink: 0, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 15, fontWeight: 600, color: '#555' }}>现场取号</span>
      <Input
        placeholder="患者姓名"
        value={takeNameValue}
        onChange={e => setTakeNameValue(e.target.value)}
        onPressEnter={handleTakeNumber}
        style={{ width: isMobile ? 110 : 120 }}
        size="middle"
      />
      <Select
        placeholder="选择医生"
        value={takeDoctorId}
        onChange={setTakeDoctorId}
        style={{ width: isMobile ? 110 : 120 }}
        size="middle"
        showSearch
        optionFilterProp="label"
        options={doctorOptions.map(d => ({
          value: d.id,
          label: d.name,
        }))}
      />
      <Button
        type="primary"
        icon={<PlusOutlined />}
        loading={takeLoading}
        onClick={handleTakeNumber}
        size="middle"
        style={{
          background: 'linear-gradient(135deg, #73d13d, #52c41a)',
          fontWeight: 700,
          border: 'none',
        }}
      >
        取号
      </Button>
      {hasPermission('appointment:create') && (
        <Button
          icon={<CalendarOutlined />}
          onClick={() => setApptModalOpen(true)}
          size="middle"
          style={{ background: '#e6f7ff', borderColor: '#91caff', color: '#0958d9' }}
        >
          预约
        </Button>
      )}
    </div>
  );

  const apptModal = (
    <AppointmentModal
      open={apptModalOpen}
      onClose={() => setApptModalOpen(false)}
      onSuccess={fetchQueue}
      doctorOptions={doctorOptions}
    />
  );

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 400 }}>
        {/* Stats row */}
        <div style={{ marginBottom: 10, flexShrink: 0 }}>
          {statsRow}
        </div>

        {/* Speed slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: '#999' }}>滚动速度</span>
          <Slider
            min={0} max={100} value={speed} onChange={setSpeed}
            style={{ flex: 1 }}
            tooltip={{ formatter: () => speedLabel }}
          />
          <span style={{ fontSize: 13, color: '#52c41a', fontWeight: 600, minWidth: 28 }}>{speedLabel}</span>
        </div>

        {/* Doctor cards (same grid as desktop) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0, overflow: 'auto' }}>
          {doctorGroups.length === 0 && !loading ? (
            doctors.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>
                <p>暂未配置接诊医生</p>
                <Button type="link" onClick={() => navigate('/settings/queue')}>
                  前往排队设置配置接诊医生
                </Button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>
                暂无排队数据
              </div>
            )
          ) : (
            doctorGroups.map((group, idx) => (
              <DoctorCard
                key={group.doctorId}
                group={group}
                colorIndex={idx}
                speed={speed}
                onCall={handleCall}
                onComplete={handleComplete}
                currentCall={doctorCallStates[group.doctorId]?.current ?? null}
                callDuration={callDurationMs}
                onCallClose={() => handleCallClose(group.doctorId)}
                hasWritePermission={hasPermission('queue:update')}
                pageVisible={pageVisible}
                showArrivalTime={showArrivalTime}
                onCheckin={handleCheckin}
                checkinLoading={checkinLoading}
              />
            ))
          )}
        </div>

        {/* Take number bar */}
        {takeNumberBar}
        {apptModal}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)', minHeight: 400 }}>
      {/* Header stats */}
      <div style={{ marginBottom: 10, flexShrink: 0 }}>
        {statsRow}
      </div>

      {/* Speed slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexShrink: 0 }}>
        <span style={{ fontSize: 13, color: '#999' }}>滚动速度</span>
        <Slider
          min={0} max={100} value={speed} onChange={setSpeed}
          style={{ width: 120 }}
          tooltip={{ formatter: () => speedLabel }}
        />
        <span style={{ fontSize: 13, color: '#52c41a', fontWeight: 600, minWidth: 28 }}>{speedLabel}</span>
      </div>

      {/* Doctor cards grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: gridCols,
        gap: 10,
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
      }}>
        {doctorGroups.length === 0 && !loading && (
          doctors.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 60, color: '#999' }}>
              <p>暂未配置接诊医生</p>
              <Button type="link" onClick={() => navigate('/settings/queue')}>
                前往排队设置配置接诊医生
              </Button>
            </div>
          ) : (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 60, color: '#999' }}>
              暂无排队数据
            </div>
          )
        )}
        {doctorGroups.map((group, idx) => (
          <DoctorCard
            key={group.doctorId}
            group={group}
            colorIndex={idx}
            speed={speed}
            onCall={handleCall}
            onComplete={handleComplete}
            currentCall={doctorCallStates[group.doctorId]?.current ?? null}
            callDuration={callDurationMs}
            onCallClose={() => handleCallClose(group.doctorId)}
            hasWritePermission={hasPermission('queue:update')}
            pageVisible={pageVisible}
            showArrivalTime={showArrivalTime}
            onCheckin={handleCheckin}
            checkinLoading={checkinLoading}
          />
        ))}
      </div>

      {/* Take number bar */}
      {takeNumberBar}
      {apptModal}
    </div>
  );
}

/* ============ Sub-components ============ */

function StatBadge({ count, label, color, bgFrom, bgTo, border }: {
  count: number; label: string; color: string; bgFrom: string; bgTo: string; border: string;
}) {
  return (
    <div style={{
      background: `linear-gradient(135deg, ${bgFrom}, ${bgTo})`,
      padding: '5px 16px', borderRadius: 6,
      border: `1px solid ${border}`, fontSize: 14,
    }}>
      <b style={{ color }}>{count}</b>{' '}
      <span style={{ color }}>{label}</span>
    </div>
  );
}

function DoctorCard({ group, colorIndex, speed, onCall, onComplete, currentCall, callDuration, onCallClose, hasWritePermission, pageVisible = true, showArrivalTime, onCheckin, checkinLoading }: {
  group: DoctorGroup;
  colorIndex: number;
  speed: number;
  onCall: (e: QueueEntry) => void;
  onComplete: (e: QueueEntry) => void;
  currentCall: CallNotification | null;
  callDuration: number;
  onCallClose: () => void;
  hasWritePermission: boolean;
  pageVisible?: boolean;
  showArrivalTime: boolean | null;
  onCheckin: (apptId: number, entryId: number) => void;
  checkinLoading: Record<number, boolean>;
}) {
  const color = DOCTOR_COLORS[colorIndex % DOCTOR_COLORS.length];
  const scrollRef = useRef<HTMLDivElement>(null);
  const hoveredRef = useRef(false);

  // Auto scroll
  useEffect(() => {
    if (speed === 0) return;
    // Map speed 1-100 to interval 150-15ms
    let interval: number;
    if (speed <= 15) interval = 150;
    else if (speed <= 35) interval = 80;
    else if (speed <= 55) interval = 50;
    else if (speed <= 75) interval = 30;
    else interval = 15;

    let lastTick = 0;
    let paused = false;
    let rafId: number;
    let resetTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      const now = performance.now();
      const el = scrollRef.current;
      if (el && !hoveredRef.current && !paused && pageVisible && now - lastTick >= interval) {
        lastTick = now;
        el.scrollTop += 1;
        if (el.scrollTop >= el.scrollHeight - el.clientHeight - 1) {
          paused = true;
          resetTimeoutId = setTimeout(() => { if (el) el.scrollTop = 0; paused = false; }, 2000);
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      if (resetTimeoutId !== null) clearTimeout(resetTimeoutId);
    };
  }, [speed, pageVisible]);

  const waitingCount = group.entries.filter(e => e.status === 'waiting' || e.status === 'ready').length;

  // Find the "seeing" entry and "next" (first waiting) entry
  const seeingEntry = group.entries.find(e => e.status === 'seeing');
  const waitingEntries = group.entries.filter(e => e.status === 'waiting' || e.status === 'ready');
  const firstWaiting = waitingEntries[0];

  // Handle call for first waiting in this doctor's queue
  const handleCallDoctor = () => {
    const target = seeingEntry || firstWaiting;
    if (target) onCall(target);
  };

  return (
    <div style={{
      background: '#fff', borderRadius: 10,
      border: '1px solid #f0f0f0',
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      position: 'relative', minHeight: 200,
    }}>
      {/* Card header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px',
        borderBottom: '1px solid #f5f5f5',
        background: `linear-gradient(90deg, ${color}10 0%, #fff 100%)`,
        flexShrink: 0,
      }}>
        <div style={{
          width: 40, height: 40,
          background: `linear-gradient(135deg, ${color}, ${color}cc)`,
          color: '#fff', borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 700, flexShrink: 0,
        }}>
          {group.doctorName.charAt(0)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{group.doctorName}</div>
          <div style={{ fontSize: 12, color: '#999' }}>{formatRoom(group.room)}</div>
        </div>
        <div style={{
          background: color, color: '#fff',
          fontSize: 12, padding: '2px 10px', borderRadius: 10, fontWeight: 600,
        }}>
          等候 {waitingCount}
        </div>
        {hasWritePermission && (
          <Button
            type="text"
            size="small"
            icon={<SoundOutlined />}
            onClick={handleCallDoctor}
            style={{ color, fontWeight: 600, fontSize: 14 }}
          >
            叫号
          </Button>
        )}
      </div>

      {/* Queue list */}
      <div
        ref={scrollRef}
        onMouseEnter={() => { hoveredRef.current = true; }}
        onMouseLeave={() => { hoveredRef.current = false; }}
        style={{
          flex: 1, overflowY: 'auto', padding: '6px 8px', minHeight: 0,
        }}
        className="queue-scroll"
      >
        {/* Seeing entry */}
        {seeingEntry && (
          <QueueRow
            entry={seeingEntry}
            type="seeing"
            position={0}
            onCall={onCall}
            onComplete={onComplete}
            hasWritePermission={hasWritePermission}
            showArrivalTime={showArrivalTime}
            onCheckin={onCheckin}
            checkinLoading={checkinLoading}
          />
        )}
        {/* Waiting entries */}
        {waitingEntries.map((entry, i) => (
          <QueueRow
            key={entry.id}
            entry={entry}
            type={i === 0 ? 'next' : 'waiting'}
            position={i}
            onCall={onCall}
            onComplete={onComplete}
            hasWritePermission={hasWritePermission}
            showArrivalTime={showArrivalTime}
            onCheckin={onCheckin}
            checkinLoading={checkinLoading}
          />
        ))}
      </div>

      <style>{`
        .queue-scroll::-webkit-scrollbar { width: 4px; }
        .queue-scroll::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 2px; }
        .queue-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>

      {/* Per-doctor call overlay — absolute-positioned within this card */}
      <CallOverlay
        visible={currentCall !== null}
        seq={currentCall?.seq ?? 0}
        name={currentCall?.name ?? ''}
        room={currentCall?.room ?? ''}
        doctor={currentCall?.doctor ?? ''}
        duration={callDuration}
        onClose={onCallClose}
        isMobile={false}
      />
    </div>
  );
}

function QueueRow({ entry, type, position, onCall, onComplete, hasWritePermission, showArrivalTime, onCheckin, checkinLoading }: {
  entry: QueueEntry;
  type: 'seeing' | 'next' | 'waiting';
  position: number;
  onCall: (e: QueueEntry) => void;
  onComplete: (e: QueueEntry) => void;
  hasWritePermission: boolean;
  showArrivalTime: boolean | null;
  onCheckin: (apptId: number, entryId: number) => void;
  checkinLoading: Record<number, boolean>;
}) {
  const seq = String(entry.seq_number).padStart(2, '0');

  // Format arrival_time to HH:mm
  const arrivalTimeStr = showArrivalTime ? formatQueueTime(entry.arrival_time) : '';

  const config = {
    seeing: {
      borderColor: '#52c41a',
      bg: '#fffff0',
      numBg: 'linear-gradient(135deg, #52c41a, #389e0d)',
      tagText: '就诊中',
      tagColor: '#52c41a',
      tagBorder: '#b7eb8f',
      tagBg: '#f6ffed',
      tooltip: '当前就诊',
    },
    next: {
      borderColor: '#fa8c16',
      bg: '#fff7e6',
      numBg: 'linear-gradient(135deg, #ffa940, #fa8c16)',
      tagText: '下一位',
      tagColor: '#fa8c16',
      tagBorder: '#ffd591',
      tagBg: '#fff7e6',
      tooltip: '下一位就诊',
    },
    waiting: {
      borderColor: '#1677ff',
      bg: '#f0f7ff',
      numBg: 'linear-gradient(135deg, #4096ff, #1677ff)',
      tagText: '候诊中',
      tagColor: '#1677ff',
      tagBorder: '#91caff',
      tagBg: '#e6f4ff',
      tooltip: `前方还有 ${position} 位`,
    },
  }[type];

  return (
    <Tooltip title={config.tooltip} placement="top" mouseEnterDelay={0.5}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px',
        background: config.bg,
        borderLeft: `3.5px solid ${config.borderColor}`,
        borderRadius: '0 8px 8px 0',
        marginBottom: 4,
        cursor: 'default',
        transition: 'background 0.2s',
      }}>
        {/* Seq badge */}
        <div style={{
          width: 38, height: 38,
          background: config.numBg,
          color: '#fff', borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, fontWeight: 800, flexShrink: 0,
        }}>
          {seq}
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span
              style={{ fontWeight: 700, fontSize: 17 }}
            >
              {entry.patient_name}
              {entry.source === 'appointment' && (
                <span style={{
                  display: 'inline-block',
                  fontSize: 9,
                  fontWeight: 800,
                  background: '#1677ff',
                  color: '#fff',
                  borderRadius: 3,
                  padding: '0 3px',
                  verticalAlign: 'super',
                  marginLeft: 2,
                  lineHeight: 1.5,
                }}>预</span>
              )}
            </span>
            <span style={{
              fontSize: 12, color: config.tagColor,
              border: `1.5px solid ${config.tagBorder}`,
              background: config.tagBg,
              padding: '0 6px', borderRadius: 3, fontWeight: 600,
              ...(type === 'next' ? { animation: 'orangePulse 2s infinite' } : {}),
            }}>
              {config.tagText}
            </span>
            {arrivalTimeStr && (
              <span style={{
                fontSize: 11,
                color: config.tagColor,
                background: config.tagBg,
                border: `1px solid ${config.tagBorder}`,
                borderRadius: 4,
                padding: '0 5px',
                fontWeight: 600,
              }}>
                {arrivalTimeStr}
              </span>
            )}
          </div>
          {entry.booked_time && (
            <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>
              约{entry.booked_time}
            </div>
          )}
        </div>

        {/* Appointment checkin action */}
        {entry.source === 'appointment' && (
          entry.checkin_status === 'done' ? (
            <span style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 8,
              fontWeight: 600,
              color: '#52c41a',
              background: '#f6ffed',
              border: '1px solid #b7eb8f',
              whiteSpace: 'nowrap',
            }}>✓ 已到</span>
          ) : (
            <Button
              size="small"
              type="primary"
              style={{ background: '#fa8c16', borderColor: '#fa8c16', fontSize: 12 }}
              loading={checkinLoading[entry.id]}
              onClick={(e) => {
                e.stopPropagation();
                if (entry.appointment_id) {
                  onCheckin(entry.appointment_id, entry.id);
                } else {
                  message.warning('预约数据异常，请刷新后重试');
                }
              }}
            >
              签到
            </Button>
          )
        )}

        {/* Action buttons */}
        {hasWritePermission && type === 'seeing' && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <Button
              type="link"
              size="small"
              style={{ fontSize: 13, padding: '0 4px', color: '#52c41a' }}
              onClick={(e) => { e.stopPropagation(); onCall(entry); }}
            >
              再次叫号
            </Button>
            <Button
              type="link"
              size="small"
              style={{ fontSize: 13, padding: '0 4px', color: '#999' }}
              onClick={(e) => { e.stopPropagation(); onComplete(entry); }}
            >
              完成
            </Button>
          </div>
        )}
        {hasWritePermission && type === 'next' && (
          <Button
            type="link"
            size="small"
            icon={<SoundOutlined />}
            style={{ fontSize: 13, padding: '0 4px', color: '#fa8c16', flexShrink: 0 }}
            onClick={(e) => { e.stopPropagation(); onCall(entry); }}
          >
            叫号
          </Button>
        )}
      </div>

      <style>{`
        @keyframes orangePulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(250,140,22,0.4); }
          50% { opacity: 0.85; box-shadow: 0 0 0 4px rgba(250,140,22,0); }
        }
      `}</style>
    </Tooltip>
  );
}
