import { useEffect, useMemo, useState } from 'react';
import { PenLine, X } from 'lucide-react';
import type { Evidence } from '../types';

export interface EvidenceEdits {
  incidentEnergy: number;
  boundary: number;
  clearingTime: number | null;
  note: string;
}

export function EditEvidenceDialog({ evidence, onClose, onSave }: {
  evidence: Evidence | null;
  onClose: () => void;
  onSave: (edits: EvidenceEdits) => void;
}) {
  const [incidentEnergy, setIncidentEnergy] = useState('');
  const [boundary, setBoundary] = useState('');
  const [clearingTime, setClearingTime] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!evidence) return;
    setIncidentEnergy(evidence.incidentEnergy?.toString() ?? '');
    setBoundary(evidence.boundary?.toString() ?? '');
    setClearingTime(evidence.clearingTime?.toString() ?? '');
    setNote(evidence.engineerNote ?? 'Verified against project protection data.');
  }, [evidence]);

  const valid = useMemo(() => {
    const energy = Number(incidentEnergy);
    const afb = Number(boundary);
    const clearing = clearingTime.trim() === '' ? null : Number(clearingTime);
    return energy > 0 && afb > 0 && (clearing == null || clearing > 0) && note.trim().length >= 4;
  }, [incidentEnergy, boundary, clearingTime, note]);

  if (!evidence) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-evidence-title">
        <div className="dialog-head">
          <div><span>ENGINEER-SUPPLIED CONTENT</span><h2 id="edit-evidence-title">Edit {evidence.id} evidence values</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close evidence editor"><X size={18} /></button>
        </div>
        <div className="edit-provenance"><PenLine size={15} /><p>The source capture remains in the audit trail. Saved changes are marked as engineer-supplied and revoke any prior draft approval.</p></div>
        <div className="edit-fields">
          <label>Incident energy <span>cal/cm²</span><input inputMode="decimal" value={incidentEnergy} onChange={(event) => setIncidentEnergy(event.target.value)} /></label>
          <label>Arc-flash boundary <span>inches</span><input inputMode="decimal" value={boundary} onChange={(event) => setBoundary(event.target.value)} /></label>
          <label>Breaker clearing time <span>seconds · optional</span><input inputMode="decimal" placeholder="Not available" value={clearingTime} onChange={(event) => setClearingTime(event.target.value)} /></label>
          <label className="edit-note">Engineering note <span>required</span><textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
        </div>
        <div className="dialog-actions">
          <button className="button-secondary" onClick={onClose}>Cancel</button>
          <button className="button-primary" disabled={!valid} onClick={() => onSave({ incidentEnergy: Number(incidentEnergy), boundary: Number(boundary), clearingTime: clearingTime.trim() === '' ? null : Number(clearingTime), note: note.trim() })}><PenLine size={14} /> Save engineer correction</button>
        </div>
      </section>
    </div>
  );
}
