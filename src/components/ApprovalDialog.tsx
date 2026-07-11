import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ShieldCheck, X } from 'lucide-react';
import type { ReviewRecord } from '../types';

interface ApprovalDialogProps {
  open: boolean;
  unresolvedCount: number;
  onClose: () => void;
  onApprove: (record: ReviewRecord) => void;
}

export function ApprovalDialog({ open, unresolvedCount, onClose, onApprove }: ApprovalDialogProps) {
  const [reviewer, setReviewer] = useState('A. Patel, P.E.');
  const [role, setRole] = useState('Electrical engineer');
  const [acknowledged, setAcknowledged] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setAcknowledged(false);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-title">
        <div className="dialog-head">
          <div><span>HUMAN APPROVAL GATE</span><h2 id="approval-title">Approve draft for internal review</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close approval dialog"><X size={18} /></button>
        </div>

        <div className={`dialog-warning${unresolvedCount === 0 ? ' is-resolved' : ''}`}>
          {unresolvedCount === 0 ? <Check size={18} /> : <AlertTriangle size={18} />}
          <div><strong>{unresolvedCount === 0 ? 'All missing fields have an explicit disposition' : `${unresolvedCount} unresolved item will remain in the draft`}</strong><p>{unresolvedCount === 0 ? 'Engineer-supplied corrections are identified separately from source-screen evidence.' : 'MCC-01 breaker clearing time is not available. Its incident-energy basis still requires engineer verification.'}</p></div>
        </div>

        <div className="reviewer-fields">
          <label>Reviewer<input ref={inputRef} value={reviewer} onChange={(event) => setReviewer(event.target.value)} /></label>
          <label>Role<input value={role} onChange={(event) => setRole(event.target.value)} /></label>
        </div>

        <div className="approval-facts">
          <div><ShieldCheck size={14} /><span>2 verified evidence items</span><strong>Accepted</strong></div>
          <div>{unresolvedCount ? <AlertTriangle size={14} /> : <Check size={14} />}<span>{unresolvedCount} missing clearing time</span><strong>{unresolvedCount ? 'Deferred' : 'Resolved'}</strong></div>
          <div><Check size={14} /><span>Draft watermark</span><strong>Permanent</strong></div>
        </div>

        <label className="approval-check">
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          <span>I understand this package remains a draft for engineering review and is not approved for issue, construction, equipment labels, or professional certification.</span>
        </label>

        <div className="dialog-actions">
          <button className="button-secondary" onClick={onClose}>Return to evidence</button>
          <button
            className="button-primary"
            disabled={!acknowledged || reviewer.trim().length < 2 || role.trim().length < 2}
            onClick={() => onApprove({ reviewer: reviewer.trim(), role: role.trim(), timestamp: new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }), unresolvedCount, disclaimerAccepted: true })}
          >
            <ShieldCheck size={15} /> Approve draft for export
          </button>
        </div>
      </section>
    </div>
  );
}
