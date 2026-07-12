import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, ChevronRight, Clock3, Crosshair, RotateCcw, ShieldCheck } from 'lucide-react';
import type { Evidence } from '../types';
import { EvidenceThumbnail } from './EvidenceThumbnail';

interface EvidenceRailProps {
  evidence: Evidence[];
  selectedId?: string;
  onSelect: (id: string) => void;
  isReview?: boolean;
  onRecapture?: (id: string) => void;
}

const statusCopy = {
  verified: 'Source verified',
  needs_review: 'Engineer review',
  accepted: 'Accepted for draft',
  deferred: 'Deferred with warning',
  rejected: 'Rejected',
  recapture_queued: 'Recapture queued',
};

export function EvidenceRail({ evidence, selectedId, onSelect, isReview, onRecapture }: EvidenceRailProps) {
  return (
    <aside className="evidence-rail" aria-label="Collected evidence">
      <div className="rail-heading">
        <div>
          <span>EVIDENCE REGISTER</span>
          <strong>{String(evidence.length).padStart(2, '0')} / 03</strong>
        </div>
        <div className={`capture-indicator${evidence.length < 3 ? ' is-live' : ''}`}><i />{evidence.length < 3 ? 'CAPTURING' : 'COLLECTED'}</div>
      </div>

      <div className="evidence-list" aria-live="polite">
        <AnimatePresence initial={false}>
          {evidence.length === 0 && (
            <motion.div className="evidence-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Crosshair size={24} />
              <strong>Waiting for source evidence</strong>
              <span>Results will appear as the local evidence replay advances.</span>
            </motion.div>
          )}
          {evidence.map((item, index) => {
            const warning = item.clearingTime == null;
            return (
              <motion.article
                key={item.evidenceId}
                className={`evidence-row${item.id === selectedId ? ' is-active' : ''}${warning ? ' has-warning' : ''}`}
                initial={{ opacity: 0, y: 16, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ duration: 0.32 }}
              >
                <button className="evidence-main" onClick={() => onSelect(item.id)} aria-label={`View evidence for ${item.id}`}>
                  <span className="evidence-index">0{index + 1}</span>
                  <EvidenceThumbnail evidence={item} />
                  <span className="evidence-copy">
                    <span><b>{item.id}</b><small>{item.capturedAt}</small></span>
                    <strong>{item.incidentEnergy?.toFixed(1)} <small>cal/cm²</small></strong>
                    <span className={`evidence-status ${warning ? 'is-warning' : 'is-ok'}`}>
                      {warning ? <AlertTriangle size={10} /> : <ShieldCheck size={10} />}
                      {statusCopy[item.status]}
                    </span>
                  </span>
                  <ChevronRight size={14} />
                </button>
                {isReview && (
                  <div className="evidence-actions">
                    <button onClick={() => onSelect(item.id)}><Check size={11} /> Inspect</button>
                    <button onClick={() => onRecapture?.(item.id)}><RotateCcw size={11} /> Recapture</button>
                  </div>
                )}
              </motion.article>
            );
          })}
        </AnimatePresence>
      </div>

      <div className="rail-provenance">
        <div><Clock3 size={12} /><span>Session clock</span><strong>10:30:{evidence.length ? 31 + evidence.length : '12'}</strong></div>
        <div><ShieldCheck size={12} /><span>Audit recording</span><strong>ON</strong></div>
      </div>
    </aside>
  );
}
