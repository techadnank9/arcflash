import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ChevronDown, CircleDot, Database, Maximize2, MoreHorizontal, Play, Save, Search, ShieldCheck } from 'lucide-react';
import { equipment, project } from '../data';
import type { AutomationStep, Evidence } from '../types';
import { NetworkDiagram } from './NetworkDiagram';

interface StudyWorkbenchProps {
  step?: AutomationStep;
  stepIndex: number;
  selectedId?: string;
  captured: Evidence[];
  onSelect: (id: string) => void;
}

const cursorByStep: Record<string, { x: string; y: string; label: string }> = {
  session: { x: '52%', y: '48%', label: 'Securing workspace' },
  launch: { x: '20%', y: '18%', label: 'Opening workbench' },
  project: { x: '29%', y: '34%', label: 'Opening CV-104' },
  case: { x: '68%', y: '21%', label: 'Verifying Case A' },
  module: { x: '78%', y: '14%', label: 'Opening Arc Flash' },
  'capture-swgr': { x: '33%', y: '66%', label: 'Reading SWGR-01' },
  'capture-mcc': { x: '47%', y: '72%', label: 'Reading MCC-01' },
  'capture-motor': { x: '59%', y: '78%', label: 'Reading CV-104' },
  draft: { x: '85%', y: '17%', label: 'Generating draft' },
};

export function StudyWorkbench({ step, stepIndex, selectedId, captured, onSelect }: StudyWorkbenchProps) {
  const screen = step?.screen ?? 'projects';
  const activeId = step?.equipmentId ?? selectedId;
  const selected = equipment.find((entry) => entry.id === activeId) ?? equipment[2];
  const cursor = step ? cursorByStep[step.id] : cursorByStep.launch;
  const visibleResults = equipment.filter((entry) => entry.incidentEnergy != null);

  return (
    <section className="workbench-shell" aria-label="Live OpenGrid Study Workbench">
      <div className="workbench-windowbar">
        <div className="window-dots"><i /><i /><i /></div>
        <span className="workbench-product"><Database size={13} /> OpenGrid Study Workbench</span>
        <span className="workbench-revision">Community build 0.9 · local project</span>
        <Maximize2 size={13} />
      </div>

      <div className="workbench-menubar">
        <span>File</span><span>Edit</span><span>Project</span><span>Studies</span><span>Reports</span>
        <div className="workbench-search"><Search size={13} /><span>Find equipment</span><kbd>⌘ K</kbd></div>
      </div>

      <div className="workbench-toolbar">
        <button><Save size={13} /> Save</button>
        <button><Play size={13} /> Run study</button>
        <div className="toolbar-separator" />
        <span className="study-case-control">Study case <strong>{project.shortCase}</strong><ChevronDown size={12} /></span>
        <span className="solver-state"><ShieldCheck size={12} /> Model checks passed</span>
      </div>

      <div className="workbench-tabs" role="tablist" aria-label="Study modules">
        {['One-Line', 'Load Flow', 'Short Circuit', 'Coordination', 'Arc Flash'].map((tab) => {
          const active = tab === 'Arc Flash' && stepIndex >= 4;
          return <button key={tab} role="tab" aria-selected={active} className={active ? 'is-active' : ''}>{tab}</button>;
        })}
        <button className="tab-more" aria-label="More study modules"><MoreHorizontal size={15} /></button>
      </div>

      <div className="workbench-body">
        <aside className="model-tree">
          <div className="tree-heading">PROJECT EXPLORER</div>
          <div className="tree-project"><ChevronDown size={12} /> <strong>CV-104</strong></div>
          <div className="tree-group"><ChevronDown size={11} /> Network</div>
          {equipment.map((item) => (
            <button
              key={item.id}
              className={item.id === activeId ? 'is-active' : ''}
              onClick={() => onSelect(item.id)}
            >
              <CircleDot size={9} /> {item.id}
            </button>
          ))}
          <div className="tree-group"><ChevronDown size={11} /> Study cases</div>
          <button className={screen === 'settings' ? 'is-active' : ''}><CircleDot size={9} /> Case A</button>
        </aside>

        <main className="study-canvas">
          <div className="canvas-head">
            <div>
              <span>{stepIndex >= 4 ? 'ARC-FLASH STUDY' : 'ONE-LINE MODEL'}</span>
              <strong>{project.id} / {project.revision}</strong>
            </div>
            <div className="canvas-meta"><span>IEEE 1584-2018</span><span>480 V</span><span>18 in WD</span></div>
          </div>

          {(screen === 'projects' || screen === 'model' || screen === 'settings') ? (
            <div className="model-overview">
              <NetworkDiagram activeId={screen === 'model' ? 'T-01' : undefined} compact={false} onSelect={onSelect} />
              {screen === 'settings' && (
                <motion.div className="settings-sheet" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                  <div className="settings-head"><strong>Study case properties</strong><span>CASE-A</span></div>
                  <div className="settings-grid">
                    <label>Name <b>Study Case A</b></label>
                    <label>Utility <b>Normal service</b></label>
                    <label>Main breaker <b>Closed</b></label>
                    <label>Main-tie <b>Open</b></label>
                  </div>
                  <div className="settings-verified"><ShieldCheck size={14} /> Configuration matches report request</div>
                </motion.div>
              )}
            </div>
          ) : (
            <div className="results-workspace">
              <NetworkDiagram activeId={activeId} compact onSelect={onSelect} />
              <div className="results-table-wrap">
                <table className="results-table">
                  <caption className="sr-only">Arc-flash study results for CV-104 equipment</caption>
                  <thead><tr><th>Equipment</th><th>Bolted fault</th><th>Arcing current</th><th>Clearing time</th><th>Incident energy</th><th>AF boundary</th><th>Status</th></tr></thead>
                  <tbody>
                    {visibleResults.map((item) => {
                      const isActive = item.id === activeId;
                      const isCaptured = captured.some((entry) => entry.id === item.id);
                      return (
                        <tr key={item.id} className={`${isActive ? 'is-active' : ''}${item.clearingTime == null ? ' has-warning' : ''}`} onClick={() => onSelect(item.id)}>
                          <th scope="row">{item.id}<small>{item.description}</small></th>
                          <td>{item.boltedFault?.toFixed(1)} kA</td>
                          <td>{item.arcingCurrent?.toFixed(1)} kA</td>
                          <td>{item.clearingTime == null ? <span className="missing-value"><AlertTriangle size={11} /> Not available</span> : `${item.clearingTime.toFixed(3)} s`}</td>
                          <td><strong>{item.incidentEnergy?.toFixed(1)}</strong> cal/cm²</td>
                          <td>{item.boundary?.toFixed(0)} in</td>
                          <td><span className={`row-state ${isCaptured ? 'is-captured' : ''}`}>{isCaptured ? 'Captured' : item.clearingTime == null ? 'Review' : 'Ready'}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <AnimatePresence mode="wait">
                {screen === 'equipment' && activeId && (
                  <motion.div key={activeId} className="equipment-inspector" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
                    <div><span>SELECTED EQUIPMENT</span><strong>{selected.id}</strong><small>{selected.description}</small></div>
                    <div className="inspector-value"><span>Incident energy</span><strong>{selected.incidentEnergy?.toFixed(1)}</strong><small>cal/cm²</small></div>
                    <div className="inspector-value"><span>AF boundary</span><strong>{selected.boundary?.toFixed(0)}</strong><small>in</small></div>
                    <div className={`inspector-value${selected.clearingTime == null ? ' has-warning' : ''}`}><span>Clearing time</span><strong>{selected.clearingTime == null ? 'N/A' : selected.clearingTime.toFixed(3)}</strong><small>{selected.clearingTime == null ? 'engineer input required' : 'seconds'}</small></div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </main>
      </div>

      {step && (
        <motion.div
          className="agent-cursor"
          initial={false}
          animate={{ left: cursor.x, top: cursor.y }}
          transition={{ type: 'spring', stiffness: 95, damping: 18 }}
        >
          <svg viewBox="0 0 22 28" aria-hidden="true"><path d="M2 1L20 17L11 18L7 27L2 1Z" /></svg>
          <AnimatePresence mode="wait">
            <motion.span key={step.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>{cursor.label}</motion.span>
          </AnimatePresence>
          <motion.i key={step.id} initial={{ scale: 0.2, opacity: 0.8 }} animate={{ scale: 2.5, opacity: 0 }} transition={{ duration: 0.8, delay: 0.45 }} />
        </motion.div>
      )}
    </section>
  );
}
