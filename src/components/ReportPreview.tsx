import { AlertTriangle, Check, FileText, Link2, ShieldAlert } from 'lucide-react';
import { exceptionText, project, studyAssumptions } from '../data';
import type { Evidence, ReviewRecord } from '../types';
import { NetworkDiagram } from './NetworkDiagram';
import { EvidenceThumbnail } from './EvidenceThumbnail';

interface ReportPreviewProps {
  evidence: Evidence[];
  review: ReviewRecord | null;
  selectedId?: string;
  onSelectEvidence: (id: string) => void;
}

export function ReportPreview({ evidence, review, selectedId, onSelectEvidence }: ReportPreviewProps) {
  const mcc = evidence.find((item) => item.id === 'MCC-01');
  const unresolvedCount = mcc?.clearingTime == null ? 1 : 0;
  return (
    <section className="report-stage" aria-label="Draft arc-flash report preview">
      <div className="report-toolbar">
        <div><FileText size={14} /><strong>CV-104_ArcFlash_Draft_RevC</strong><span>7 pages</span></div>
        <div><span className="source-key is-extracted">Extracted fact</span><span className="source-key is-generated">Generated narrative</span><span className="source-key is-engineer">Engineer content</span></div>
      </div>
      <article className="report-paper">
        <div className="report-watermark">DRAFT FOR ENGINEERING REVIEW — NOT APPROVED FOR ISSUE</div>
        <header className="report-cover-band">
          <div className="report-brand"><i><span /></i> ARCFLASH / COPILOT</div>
          <div className="report-doc-meta">AF STUDY EVIDENCE PACKAGE <span>{project.number}</span></div>
        </header>

        <div className="report-title-block">
          <span>ARC-FLASH STUDY · REVISION C</span>
          <h1>CV-104 Conveyor<br />Electrical Distribution</h1>
          <p>{project.client} · {project.studyCase}</p>
          <div className="report-status-stamp"><ShieldAlert size={15} /> INTERNAL REVIEW DRAFT</div>
        </div>

        <div className="report-summary-grid">
          <section>
            <span className="report-eyebrow is-generated">GENERATED NARRATIVE</span>
            <h2>Evidence assembled.<br />Judgment stays with the engineer.</h2>
            <p>Three arc-flash results were collected from the selected study case. {unresolvedCount ? 'Two source records are verified; one protective-device clearing-time field remains unresolved.' : 'All missing fields now have an explicit engineer-supplied disposition.'}</p>
          </section>
          <section className="report-metrics">
            <div><strong>03</strong><span>RESULTS CAPTURED</span></div>
            <div><strong>{String(3 - unresolvedCount).padStart(2, '0')}</strong><span>READY FOR REVIEW</span></div>
            <div className={unresolvedCount ? 'is-warning' : ''}><strong>{String(unresolvedCount).padStart(2, '0')}</strong><span>OPEN EXCEPTION</span></div>
          </section>
        </div>

        <section className="report-section report-system">
          <div className="report-section-head"><span>01</span><div><small>EXTRACTED FACT</small><h2>System overview</h2></div></div>
          <NetworkDiagram activeId={selectedId} compact onSelect={onSelectEvidence} />
        </section>

        <section className="report-section">
          <div className="report-section-head"><span>02</span><div><small>EXTRACTED FACT</small><h2>Study basis & assumptions</h2></div></div>
          <div className="assumption-lines">
            {studyAssumptions.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
          </div>
        </section>

        <section className="report-section">
          <div className="report-section-head"><span>03</span><div><small>EXTRACTED FACT</small><h2>Arc-flash results</h2></div></div>
          <div className="report-table-wrap">
            <table className="report-table">
              <caption className="sr-only">Extracted arc-flash results</caption>
              <thead><tr><th>Equipment</th><th>Fault current</th><th>Clearing time</th><th>Incident energy</th><th>Boundary</th><th>Recommendation</th></tr></thead>
              <tbody>
                {evidence.map((item) => (
                  <tr key={item.id} className={item.clearingTime == null ? 'has-warning' : ''}>
                    <th scope="row"><button onClick={() => onSelectEvidence(item.id)}>{item.id}<Link2 size={10} /></button><small>{item.description}{item.provenance === 'engineer' ? ' · engineer corrected' : ''}</small></th>
                    <td>{item.boltedFault?.toFixed(1)} kA</td>
                    <td>{item.clearingTime == null ? <span><AlertTriangle size={11} /> Not available</span> : `${item.clearingTime.toFixed(3)} s`}</td>
                    <td><strong>{item.incidentEnergy?.toFixed(1)}</strong> cal/cm²</td>
                    <td>{item.boundary?.toFixed(0)} in</td>
                    <td>{item.ppe}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={`report-section report-exception${unresolvedCount === 0 ? ' is-resolved' : ''}`}>
          <div className="report-section-head"><span>04</span><div><small>{unresolvedCount ? 'UNRESOLVED INFORMATION' : 'ENGINEER-SUPPLIED CONTENT'}</small><h2>{unresolvedCount ? 'Exception requiring review' : 'Correction record'}</h2></div></div>
          <div className="exception-document-row">
            {unresolvedCount ? <AlertTriangle size={18} /> : <Check size={18} />}
            <div><strong>{unresolvedCount ? 'EX-001 · MCC-01 protective-device clearing time' : 'MCC-01 · Engineer-supplied correction recorded'}</strong><p>{unresolvedCount ? exceptionText : `Clearing time: ${mcc?.clearingTime?.toFixed(3)} s. ${mcc?.engineerNote ?? 'Correction retained with engineer provenance.'}`}</p></div>
            <span>{unresolvedCount ? review ? 'DEFERRED' : 'OPEN' : 'RESOLVED'}</span>
          </div>
        </section>

        <section className="report-section">
          <div className="report-section-head"><span>05</span><div><small>SOURCE EVIDENCE</small><h2>Evidence appendix</h2></div></div>
          <div className="report-evidence-grid">
            {evidence.map((item, index) => (
              <button key={item.evidenceId} className={item.id === selectedId ? 'is-active' : ''} onClick={() => onSelectEvidence(item.id)}>
                <EvidenceThumbnail evidence={item} large />
                <span><b>0{index + 1} · {item.id}</b><small>{item.sourceScreen}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section className="report-section report-limitations">
          <div className="report-section-head"><span>06</span><div><small>GENERATED NARRATIVE</small><h2>Limitations</h2></div></div>
          <p>ArcFlash Copilot performs controlled software navigation, evidence extraction, and draft assembly. It does not replace the calculation engine, recommend protective-device settings, make automatic engineering judgments, issue labels, or produce a stamped professional report.</p>
        </section>

        <section className="report-review-block">
          <div><span>ENGINEER REVIEW</span><h2>{review ? 'Reviewed for draft export' : 'Engineer action required'}</h2></div>
          {review ? (
            <div className="review-signoff"><Check size={18} /><div><strong>{review.reviewer}</strong><span>{review.role} · {review.timestamp}</span><small>{review.unresolvedCount} unresolved item{review.unresolvedCount === 1 ? '' : 's'} acknowledged · not approved for issue</small></div></div>
          ) : (
            <div className="review-lines"><span>Reviewer</span><i /><span>Date</span><i /><span>Signature</span><i /></div>
          )}
        </section>

        <footer className="report-footer"><span>{project.number} · {project.revision}</span><strong>DRAFT — NOT APPROVED FOR ISSUE</strong><span>Page 1 of 7</span></footer>
      </article>
    </section>
  );
}
