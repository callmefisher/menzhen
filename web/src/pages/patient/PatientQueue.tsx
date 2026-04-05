import { useEffect, useRef, useState, useCallback } from 'react';
import { Card, Button, Select, message, Spin, Tag } from 'antd';
import { takeQueueNumber, getMyQueueStatus, listDoctors, listPatientQueue } from '../../api/patientPortal';
import type { Doctor, QueueEntry } from '../../api/patientPortal';
import { usePatientWebSocket } from '../../hooks/usePatientWebSocket';
import CallOverlay from '../../components/CallOverlay';
import { buildRoomSpeechText, formatRoom } from '../../utils/format';

// Digit map for seq numbers ≥100: 101 → "一零一"
const DIGIT_MAP: Record<string, string> = {
  '0': '零', '1': '一', '2': '二', '3': '三', '4': '四',
  '5': '五', '6': '六', '7': '七', '8': '八', '9': '九',
};

function seqToSpeech(seq: number): string {
  const s = String(seq);
  return s.length >= 3 ? s.split('').map(d => DIGIT_MAP[d] ?? d).join('') : s;
}

/**
 * WeChat/Android-compatible TTS.
 * - voices: pre-loaded voice list (required on Android Chrome)
 * - resume() → cancel() → setTimeout(100ms) → speak() fixes X5 engine silent failure
 */
function patientSpeak(text: string, voices: SpeechSynthesisVoice[]) {
  if (!window.speechSynthesis) return;
  const ss = window.speechSynthesis;
  ss.resume();
  ss.cancel();
  const ttsTimer = setTimeout(() => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 0.85;
    u.volume = 1.0;
    // Explicitly set Chinese voice — required on Android Chrome to avoid silence
    const zhVoice = voices.find(v => v.lang === 'zh-CN') ?? voices.find(v => v.lang.startsWith('zh'));
    if (zhVoice) u.voice = zhVoice;
    ss.speak(u);
  }, 100);
  return ttsTimer;
}

export default function PatientQueue() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<number | null>(null);
  const [myEntry, setMyEntry] = useState<{ queue_entry: QueueEntry; waiting_ahead: number } | null>(null);
  const [queueList, setQueueList] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [taking, setTaking] = useState(false);
  const [callNotif, setCallNotif] = useState<{ seq: number; name: string; room: string; doctor: string } | null>(null);
  const myEntryRef = useRef<{ queue_entry: QueueEntry; waiting_ahead: number } | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const audioUnlockedRef = useRef(false);

  const fetchStatus = useCallback(() => {
    return (getMyQueueStatus() as Promise<{ data: { queue_entry: QueueEntry; waiting_ahead: number } | null }>)
      .catch(() => ({ data: null }))
      .then((statusRes) => {
        myEntryRef.current = statusRes.data;
        setMyEntry(statusRes.data);
        return statusRes.data;
      });
  }, []);

  // Load TTS voices — Android Chrome returns empty on first call, needs voiceschanged event.
  useEffect(() => {
    if (!window.speechSynthesis) return;
    const load = () => {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) voicesRef.current = v;
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  // Unlock audio on first user interaction — required by Android/WeChat autoplay policy.
  useEffect(() => {
    const unlock = () => {
      if (audioUnlockedRef.current || !window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.rate = 10;
      u.lang = 'zh-CN';
      window.speechSynthesis.speak(u);
      audioUnlockedRef.current = true;
    };
    document.addEventListener('touchstart', unlock, { once: true, passive: true });
    document.addEventListener('click', unlock, { once: true, passive: true });
    return () => {
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('click', unlock);
    };
  }, []);

  useEffect(() => {
    Promise.all([
      listDoctors().catch(() => ({ data: [] as Doctor[] })),
      fetchStatus(),
    ]).then(([docRes]) => {
      setDoctors(docRes.data);
    }).finally(() => setLoading(false));
  }, [fetchStatus]);

  // When we have an active queue entry, fetch the full queue for that doctor.
  useEffect(() => {
    if (myEntry && (myEntry.queue_entry.status === 'waiting' || myEntry.queue_entry.status === 'seeing')) {
      listPatientQueue(myEntry.queue_entry.doctor_id)
        .then((res) => setQueueList(res.data))
        .catch(() => setQueueList([]));
    } else {
      setQueueList([]);
    }
  }, [myEntry]);

  // Real-time: re-fetch status + queue when admin updates queue.
  usePatientWebSocket('queue_update', useCallback(() => {
    fetchStatus().then((entry) => {
      if (entry && (entry.queue_entry.status === 'waiting' || entry.queue_entry.status === 'seeing')) {
        listPatientQueue(entry.queue_entry.doctor_id)
          .then((res) => setQueueList(res.data))
          .catch(() => setQueueList([]));
      }
    });
  }, [fetchStatus]));

  // Real-time: show popup when my number is called.
  usePatientWebSocket('queue_call', useCallback((msg: unknown) => {
    const p = (msg as { payload?: { seq?: number; patient_name?: string; room?: string; doctor_name?: string } })?.payload;
    if (typeof p?.seq !== 'number') return;
    if (myEntryRef.current && myEntryRef.current.queue_entry.seq_number === p.seq) {
      setCallNotif({ seq: p.seq, name: p.patient_name ?? '', room: p.room ?? '', doctor: p.doctor_name ?? '' });
    }
  }, []));

  const handleCloseCall = useCallback(() => {
    window.speechSynthesis?.cancel();
    setCallNotif(null);
  }, []);

  // Trigger TTS when callNotif is set (WeChat/Android compatible).
  useEffect(() => {
    if (!callNotif) return;
    const seqText = seqToSpeech(callNotif.seq);
    const roomText = buildRoomSpeechText(formatRoom(callNotif.room));
    const timer = patientSpeak(`请${seqText}号，${callNotif.name}，到${roomText}就诊`, voicesRef.current);
    return () => {
      clearTimeout(timer);
      window.speechSynthesis?.cancel();
    };
  }, [callNotif]);

  const handleTake = async () => {
    if (!selectedDoctor) { message.warning('请先选择医生'); return; }
    setTaking(true);
    try {
      const res = await takeQueueNumber(selectedDoctor) as { data: { queue_entry: QueueEntry; waiting_ahead: number } };
      myEntryRef.current = res.data;
      setMyEntry(res.data);
      message.success('取号成功！');
    } catch (err: unknown) {
      const errData = (err as { response?: { data?: { code?: number; message?: string } } })?.response?.data;
      if (errData?.code === 409) {
        message.warning(errData.message ?? '您今日已在排队中');
        // Refresh status to show their existing entry
        await fetchStatus();
      } else {
        message.error('取号失败，请稍后重试');
      }
    } finally { setTaking(false); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;

  if (myEntry && (myEntry.queue_entry.status === 'waiting' || myEntry.queue_entry.status === 'seeing')) {
    const { queue_entry: e, waiting_ahead } = myEntry;
    return (
      <div style={{ padding: '20px 16px' }}>
        <CallOverlay
          visible={callNotif !== null}
          seq={callNotif?.seq ?? 0}
          name={callNotif?.name ?? ''}
          room={callNotif?.room ?? ''}
          doctor={callNotif?.doctor ?? ''}
          isMobile={true}
          onClose={handleCloseCall}
        />
        {/* My queue card */}
        <div style={{ background: 'linear-gradient(135deg, #389E0D, #237804)', borderRadius: 16, padding: '24px 20px', color: '#fff', textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 13, opacity: 0.85 }}>您的号码</div>
          <div style={{ fontSize: 64, fontWeight: 900, lineHeight: 1 }}>{e.seq_number}</div>
          <div style={{ fontSize: 14 }}>{e.doctor_name} {e.room && `· ${e.room}`}</div>
          {e.status === 'seeing' && <Tag color="gold" style={{ marginTop: 8 }}>就诊中</Tag>}
        </div>
        <Card size="small" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span style={{ color: '#888' }}>前方等候</span><span style={{ fontWeight: 600 }}>{waiting_ahead} 人</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span style={{ color: '#888' }}>状态</span>
            <Tag color={e.status === 'seeing' ? 'gold' : 'blue'}>{e.status === 'seeing' ? '就诊中' : '等候中'}</Tag>
          </div>
        </Card>
        <Card size="small" style={{ background: '#f6ffed', border: '1px solid #d9f7be', textAlign: 'center', fontSize: 13, color: '#389E0D', marginBottom: 16 }}>
          📢 叫到您时诊所将叫号，请在候诊区等待
        </Card>

        {/* Full queue list */}
        {queueList.length > 0 && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: '#333' }}>
              {e.doctor_name} 候诊队列
            </div>
            {queueList.map((entry, idx) => {
              const isMe = entry.id === e.id;
              const isSeeing = entry.status === 'seeing';
              const borderColor = isMe ? '#52C41A' : isSeeing ? '#faad14' : '#1677ff';
              const bg = isMe ? '#f6ffed' : isSeeing ? '#fff7e6' : '#f0f7ff';
              return (
                <div key={entry.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px',
                  background: bg,
                  borderLeft: `4px solid ${borderColor}`,
                  borderRadius: '0 10px 10px 0',
                  marginBottom: 6,
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                    background: isMe ? 'linear-gradient(135deg, #52C41A, #389E0D)' : isSeeing ? 'linear-gradient(135deg, #ffa940, #fa8c16)' : 'linear-gradient(135deg, #4096ff, #1677ff)',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 800,
                  }}>
                    {String(entry.seq_number).padStart(2, '0')}
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: isMe ? 700 : 500, fontSize: 15 }}>
                      {isMe ? entry.patient_name : `${entry.patient_name.charAt(0)}${'*'.repeat(Math.max(0, entry.patient_name.length - 1))}`}
                    </span>
                  </div>
                  {isMe && (
                    <Tag color="green" style={{ fontWeight: 700 }}>我</Tag>
                  )}
                  {isSeeing && !isMe && (
                    <Tag color="orange">就诊中</Tag>
                  )}
                  <span style={{ fontSize: 11, color: '#999' }}>#{idx + 1}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 16px' }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>快捷取号</div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12, color: '#888', fontSize: 13 }}>选择就诊医生</div>
        <Select style={{ width: '100%' }} placeholder="请选择医生" onChange={setSelectedDoctor}
          options={doctors.map(d => ({ value: d.id, label: `${d.doctor_name}${d.room ? ` · ${d.room}` : ''}` }))} />
      </Card>
      <Button type="primary" block size="large" onClick={handleTake} loading={taking}
        style={{ background: '#52C41A', borderColor: '#52C41A', height: 52, fontSize: 16, borderRadius: 10 }}>
        🎫 立即取号入队
      </Button>
      <div style={{ textAlign: 'center', color: '#aaa', fontSize: 12, marginTop: 12 }}>请确认已到达诊所后再取号</div>
    </div>
  );
}
