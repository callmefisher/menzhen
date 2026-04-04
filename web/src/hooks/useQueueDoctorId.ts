import { useState, useEffect } from 'react';
import { listQueueDoctors, type QueueDoctor as QueueDoctorConfig } from '../api/queue-doctor';
import { useAuth } from '../store/auth';

/**
 * Resolves the current logged-in user's queue_doctor.id.
 *
 * queue_entries.doctor_id stores queue_doctor.id (PK of queue_doctors table),
 * NOT user_id (PK of users table). This hook bridges the gap by looking up
 * the QueueDoctor record whose user_id matches the logged-in user.
 *
 * Returns undefined until the lookup completes (or if the user has no
 * associated QueueDoctor record).
 */
export function useQueueDoctorId(): number | undefined {
  const { user } = useAuth();
  const [queueDoctorId, setQueueDoctorId] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!user?.id) return;
    listQueueDoctors().then((res) => {
      const body = res as unknown as { data?: { list?: QueueDoctorConfig[] } };
      const list = body.data?.list ?? [];
      const match = list.find(d => d.user_id === user.id);
      setQueueDoctorId(match?.id);
    }).catch(() => { /* fallback: keep undefined */ });
  }, [user?.id]);

  return queueDoctorId;
}
