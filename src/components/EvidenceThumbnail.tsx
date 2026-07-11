import { AlertTriangle, ScanLine } from 'lucide-react';
import { project } from '../data';
import type { Evidence } from '../types';

export function EvidenceThumbnail({ evidence, large = false }: { evidence: Evidence; large?: boolean }) {
  return (
    <div className={`evidence-thumbnail${large ? ' is-large' : ''}`} role="img" aria-label={`Captured arc-flash result screen for ${evidence.id}`}>
      <div className="evidence-thumb-grid" />
      <div className="evidence-thumb-head">
        <span>{project.id} / {project.shortCase}</span>
        <ScanLine size={large ? 14 : 9} />
      </div>
      <div className="evidence-thumb-body">
        <strong>{evidence.id}</strong>
        <div><span>IE</span><b>{evidence.incidentEnergy?.toFixed(1)}</b><small>cal/cm²</small></div>
        <div><span>AFB</span><b>{evidence.boundary?.toFixed(0)}</b><small>in</small></div>
      </div>
      {evidence.clearingTime == null && (
        <div className="evidence-thumb-warning"><AlertTriangle size={large ? 12 : 8} /> CLEARING TIME N/A</div>
      )}
    </div>
  );
}
