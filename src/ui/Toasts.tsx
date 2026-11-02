import { IconAlertTriangle, IconCircleCheck, IconInfoCircle, IconX } from '@tabler/icons-react';
import { useStore } from '../store/store';

const ICONS = { info: IconInfoCircle, error: IconAlertTriangle, success: IconCircleCheck };

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => {
        const I = ICONS[t.kind];
        return (
          <div key={t.id} className={`toast ${t.kind}`}>
            <I size={16} />
            <span>{t.text}</span>
            <button className="icon-btn sm" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <IconX size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
