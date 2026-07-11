import { X } from 'lucide-react';
import type { AuditEvent } from '../types';

export function AuditDrawer({ open, events, onClose }: { open: boolean; events: AuditEvent[]; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="audit-drawer" role="dialog" aria-modal="true" aria-labelledby="audit-heading">
        <div className="drawer-head"><div><span>APPEND-ONLY RECORD</span><h2 id="audit-heading">Session audit trail</h2></div><button className="icon-button" onClick={onClose} aria-label="Close audit trail"><X size={18} /></button></div>
        <div className="audit-summary"><span>{events.length} events</span><span>0 actions outside allowlist</span><span>Session recording on</span></div>
        <ol className="audit-list">
          {[...events].reverse().map((event) => (
            <li key={event.id}>
              <time>{event.timestamp}</time>
              <i />
              <div><span>{event.actor}</span><strong>{event.type}</strong><p>{event.detail}</p></div>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
