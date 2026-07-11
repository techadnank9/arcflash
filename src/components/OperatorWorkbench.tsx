import { useState } from 'react';
import { AlertTriangle, Check, ChevronRight, CircleDot, FileText, FolderOpen, ScanLine, ShieldCheck, Zap } from 'lucide-react';
import { equipment, project } from '../data';
import { NetworkDiagram } from './NetworkDiagram';

type OperatorStage = 'project' | 'case' | 'arcflash' | 'results' | 'review';

export function OperatorWorkbench() {
  const [stage, setStage] = useState<OperatorStage>('project');
  const [selectedId, setSelectedId] = useState('SWGR-01');
  const [capturedIds, setCapturedIds] = useState<string[]>([]);
  const [flagged, setFlagged] = useState(false);

  const results = equipment.filter((item) => item.incidentEnergy != null);
  const selected = results.find((item) => item.id === selectedId) ?? results[0];

  const capture = () => {
    if (!capturedIds.includes(selected.id)) setCapturedIds((items) => [...items, selected.id]);
  };

  return (
    <main className="operator-page">
      <header className="operator-header">
        <div className="brand-mark"><i><span /></i><div><strong>OPEN<span>GRID</span></strong><small>STUDY WORKBENCH</small></div></div>
        <div className="operator-project"><span>{project.id}</span><strong>{project.name}</strong><small>{project.revision}</small></div>
        <div className="operator-agent"><i /><span>H COMPUTER CONTROL</span><strong>Visual session active</strong></div>
      </header>

      <nav className="operator-tabs" aria-label="Study workflow">
        {[
          ['project', 'Project'], ['case', 'Study Case'], ['arcflash', 'Arc Flash'], ['results', 'Results'], ['review', 'Draft'],
        ].map(([id, label], index) => {
          const stages: OperatorStage[] = ['project', 'case', 'arcflash', 'results', 'review'];
          const current = stages.indexOf(stage);
          return <span key={id} className={current === index ? 'is-active' : current > index ? 'is-complete' : ''}><i>{current > index ? <Check size={12} /> : index + 1}</i>{label}</span>;
        })}
      </nav>

      {stage === 'project' && (
        <section className="operator-project-screen">
          <div className="operator-title"><span>LOCAL PROJECTS</span><h1>Select a power-system model</h1><p>Only allowlisted projects are visible in this isolated workspace.</p></div>
          <button className="operator-project-row" data-agent-id="project-cv-104" onClick={() => setStage('case')}>
            <FolderOpen size={24} />
            <span><strong>CV-104 Conveyor Electrical Distribution</strong><small>CV104-AF-2026 · Revision C · Modified Jul 11, 2026</small></span>
            <span className="operator-ready"><ShieldCheck size={14} /> MODEL READY</span>
            <span className="operator-open">Open project <ChevronRight size={16} /></span>
          </button>
        </section>
      )}

      {stage === 'case' && (
        <section className="operator-case-screen">
          <div className="operator-title"><span>STUDY CONFIGURATION</span><h1>Verify the selected study case</h1><p>Configuration must match the report request before evidence is collected.</p></div>
          <div className="operator-case-layout">
            <NetworkDiagram compact />
            <div className="case-sheet">
              <div><span>SELECTED CASE</span><strong>Study Case A</strong><small>Normal utility / main-tie open</small></div>
              <dl><dt>Utility source</dt><dd>Normal service</dd><dt>Main breaker</dt><dd>Closed</dd><dt>Main-tie</dt><dd>Open</dd><dt>Motor contribution</dt><dd>Operating</dd></dl>
              <button className="operator-primary" data-agent-id="verify-study-case" onClick={() => setStage('arcflash')}><ShieldCheck size={16} /> Verify Study Case A</button>
            </div>
          </div>
        </section>
      )}

      {stage === 'arcflash' && (
        <section className="operator-case-screen">
          <div className="operator-title"><span>STUDY MODULES</span><h1>Choose an analysis module</h1><p>The existing model has current short-circuit and coordination results.</p></div>
          <div className="module-list">
            <button><CircleDot size={18} /><span><strong>Load Flow</strong><small>Last run 10:21 · converged</small></span></button>
            <button><Zap size={18} /><span><strong>Short Circuit</strong><small>IEC 60909 · complete</small></span></button>
            <button className="is-target" data-agent-id="open-arc-flash" onClick={() => setStage('results')}><ScanLine size={18} /><span><strong>Arc Flash</strong><small>IEEE 1584-2018 · 3 result locations</small></span><span>Open module <ChevronRight size={15} /></span></button>
          </div>
        </section>
      )}

      {stage === 'results' && (
        <section className="operator-results-screen">
          <div className="operator-result-head"><div><span>ARC FLASH / STUDY CASE A</span><h1>Equipment results</h1></div><div><span>Evidence captured</span><strong>{capturedIds.length} / 3</strong></div></div>
          <div className="operator-results-layout">
            <div className="operator-result-list">
              {results.map((item) => (
                <button key={item.id} data-agent-id={`result-${item.id.toLowerCase()}`} className={item.id === selected.id ? 'is-active' : ''} onClick={() => setSelectedId(item.id)}>
                  <span><strong>{item.id}</strong><small>{item.description}</small></span>
                  <span><small>Incident energy</small><strong>{item.incidentEnergy?.toFixed(1)} cal/cm²</strong></span>
                  {capturedIds.includes(item.id) ? <span className="captured"><Check size={12} /> Captured</span> : <ChevronRight size={15} />}
                </button>
              ))}
            </div>
            <div className={`operator-result-detail${selected.clearingTime == null ? ' has-warning' : ''}`}>
              <div className="detail-heading"><span>ARC FLASH RESULT</span><h2>{selected.id}</h2><p>{selected.description} · {selected.voltage}</p></div>
              <div className="detail-values">
                <div><span>Bolted fault current</span><strong>{selected.boltedFault?.toFixed(1)}</strong><small>kA</small></div>
                <div><span>Arcing current</span><strong>{selected.arcingCurrent?.toFixed(1)}</strong><small>kA</small></div>
                <div><span>Incident energy</span><strong>{selected.incidentEnergy?.toFixed(1)}</strong><small>cal/cm²</small></div>
                <div><span>Arc-flash boundary</span><strong>{selected.boundary?.toFixed(0)}</strong><small>in</small></div>
                <div><span>Breaker clearing time</span><strong>{selected.clearingTime == null ? 'Not available' : selected.clearingTime.toFixed(3)}</strong><small>{selected.clearingTime == null ? 'Engineer input required' : 'seconds'}</small></div>
              </div>
              {selected.clearingTime == null && !flagged && <button className="operator-warning-action" data-agent-id="flag-mcc-exception" onClick={() => setFlagged(true)}><AlertTriangle size={15} /> Flag missing value for engineer review</button>}
              {selected.clearingTime == null && flagged && <div className="operator-flagged"><Check size={14} /> EX-001 recorded · value remains Not available</div>}
              <button className="operator-primary" data-agent-id={`capture-${selected.id.toLowerCase()}`} disabled={selected.id === 'MCC-01' && !flagged} onClick={capture}><ScanLine size={16} /> {capturedIds.includes(selected.id) ? 'Evidence captured' : 'Capture evidence'}</button>
              {capturedIds.length === 3 && <button className="operator-generate" data-agent-id="generate-draft" onClick={() => setStage('review')}><FileText size={16} /> Generate report draft</button>}
            </div>
          </div>
        </section>
      )}

      {stage === 'review' && (
        <section className="operator-complete-screen">
          <div className="operator-stop-icon"><i /><FileText size={29} /></div>
          <span>AUTOMATION STOPPED AT APPROVAL GATE</span>
          <h1>Draft report generated.<br />Engineer review required.</h1>
          <p>3 evidence records attached · 1 unresolved item · no values invented</p>
          <div><ShieldCheck size={15} /> The agent cannot issue or export the report without explicit engineer approval.</div>
        </section>
      )}

      <footer className="operator-footer"><span>Open-source study layer · pandapower + OpenDSS + arcflash</span><span><i /> Session recording enabled</span><span>Sandbox: /projects/CV-104</span></footer>
    </main>
  );
}
