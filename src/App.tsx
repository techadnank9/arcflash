import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, ArrowLeft, ArrowRight, AudioLines, BookOpenCheck, Bot, Check, CheckCircle2,
  ChevronDown, CircleDot, Clock3, Cloud, Code2, Download, ExternalLink, File, FileCheck2,
  FileClock, FileSpreadsheet, FileText, FolderOpen, Gauge, History, KeyRound, Layers3, Lock,
  Mic, MoreHorizontal, Pause, Play, RefreshCw, RotateCcw, Search, Shield, ShieldCheck, Sparkles,
  Square, TerminalSquare, Upload, UserCheck, Volume2, X, Zap,
} from 'lucide-react';
import {
  automationSteps, commandText, evidenceCatalog, exceptionText, openSourceStack, project,
  projectFiles, seedAudit, studyAssumptions,
} from './data';
import { generateDraftPdf, reportFilename } from './lib/report';
import { applyReviewDisposition, canExportDraft } from './lib/safety';
import type { AppPhase, AuditEvent, Evidence, HComputerStatus, ReviewRecord } from './types';
import { ApprovalDialog } from './components/ApprovalDialog';
import { AuditDrawer } from './components/AuditDrawer';
import { EvidenceRail } from './components/EvidenceRail';
import { EditEvidenceDialog, type EvidenceEdits } from './components/EditEvidenceDialog';
import { NetworkDiagram } from './components/NetworkDiagram';
import { OperatorWorkbench } from './components/OperatorWorkbench';
import { ReportPreview } from './components/ReportPreview';
import { StudyWorkbench } from './components/StudyWorkbench';

const phaseOrder: AppPhase[] = ['home', 'plan', 'booting', 'running', 'review', 'approved', 'exported'];

const workflowStages = [
  { label: 'Project', phase: 'home' },
  { label: 'Study', phase: 'running' },
  { label: 'Capture', phase: 'running' },
  { label: 'Draft', phase: 'review' },
  { label: 'Review', phase: 'approved' },
] as const;

const defaultHStatus: HComputerStatus = {
  configured: false,
  reachable: false,
  targetConfigured: false,
  region: 'eu',
  mode: 'demo',
  message: 'Checking H Computer server adapter…',
};

const formatClock = (seconds: number) => `10:30:${String(seconds).padStart(2, '0')}`;

function Brand() {
  return (
    <div className="brand-mark" aria-label="ArcFlash Copilot">
      <i><span /></i>
      <div><strong>ARCFLASH<span>/</span></strong><small>COPILOT</small></div>
    </div>
  );
}

function GlobalHeader({ phase, onAudit, onReset }: { phase: AppPhase; onAudit: () => void; onReset: () => void }) {
  const currentIndex = phase === 'home' ? 0 : phase === 'plan' || phase === 'booting' ? 1 : phase === 'running' ? 2 : phase === 'review' ? 3 : 4;
  return (
    <header className="global-header">
      <Brand />
      <div className="project-crumb">
        <span>{project.id}</span>
        <strong>{project.name}</strong>
        <small>{project.revision}</small>
      </div>
      <div className="workflow-circuit" aria-label={`Workflow stage ${workflowStages[currentIndex].label}`}>
        {workflowStages.map((stage, index) => (
          <div key={stage.label} className={`${index === currentIndex ? 'is-active' : ''}${index < currentIndex ? 'is-complete' : ''}`}>
            <i>{index < currentIndex ? <Check size={10} /> : index + 1}</i><span>{stage.label}</span>
          </div>
        ))}
      </div>
      <div className="header-actions">
        <div className="secure-state"><Lock size={12} /><span>ISOLATED</span></div>
        <button className="icon-button" onClick={onAudit} aria-label="Open audit trail"><History size={17} /></button>
        <button className="icon-button reset-button" onClick={onReset} aria-label="Reset demo"><RefreshCw size={16} /></button>
        <div className="avatar" title="A. Patel, P.E.">AP</div>
      </div>
    </header>
  );
}

function ProjectHome({ command, onCommand, onPlan, listening, onVoice }: {
  command: string;
  onCommand: (value: string) => void;
  onPlan: () => void;
  listening: boolean;
  onVoice: () => void;
}) {
  return (
    <motion.main className="home-layout" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <aside className="project-browser">
        <div className="browser-title"><span>PROJECTS</span><button aria-label="Project options"><MoreHorizontal size={16} /></button></div>
        <div className="project-search"><Search size={14} /><span>Search projects</span><kbd>⌘ K</kbd></div>
        <div className="project-groups">
          <span>ACTIVE STUDIES</span>
          <button className="project-list-row is-active">
            <i><Zap size={14} /></i><span><strong>CV-104</strong><small>Conveyor distribution</small></span><b>Rev C</b>
          </button>
          <button className="project-list-row"><i><Layers3 size={14} /></i><span><strong>PLT-220</strong><small>Process building</small></span><b>Rev A</b></button>
          <button className="project-list-row"><i><Gauge size={14} /></i><span><strong>SUB-09</strong><small>North substation</small></span><b>Rev F</b></button>
          <span>RECENT SESSIONS</span>
          <button className="recent-session"><FileCheck2 size={14} /><span><strong>PLT-220 draft</strong><small>Yesterday · review required</small></span></button>
          <button className="recent-session"><FileClock size={14} /><span><strong>SUB-09 evidence</strong><small>Jul 08 · paused</small></span></button>
        </div>
        <button className="new-project"><Upload size={14} /> Add project files</button>
      </aside>

      <section className="project-detail">
        <div className="project-identity">
          <div className="project-code"><span>CV</span><strong>104</strong></div>
          <div><span>SELECTED PROJECT</span><h1>{project.name}</h1><p>{project.client} · {project.number}</p></div>
          <div className="project-state"><i /><span>MODEL READY</span><small>5 source files indexed</small></div>
        </div>

        <div className="project-detail-grid">
          <section className="project-model-panel">
            <div className="section-heading"><div><span>SYSTEM MODEL</span><h2>Normal utility configuration</h2></div><button>Open one-line <ExternalLink size={12} /></button></div>
            <NetworkDiagram compact />
            <div className="model-facts">
              <div><span>STUDY CASE</span><strong>{project.shortCase}</strong><small>Normal utility · main-tie open</small></div>
              <div><span>METHOD</span><strong>IEEE 1584-2018</strong><small>Working distance 18 in</small></div>
              <div><span>REPORT STATUS</span><strong>Not started</strong><small>Engineer approval required</small></div>
            </div>
          </section>

          <section className="source-files-panel">
            <div className="section-heading"><div><span>SOURCE PACKAGE</span><h2>Project files</h2></div><button><Upload size={12} /> Add files</button></div>
            <div className="file-list">
              {projectFiles.map((file) => (
                <div key={file.name} className={file.status === 'warning' ? 'has-warning' : ''}>
                  <i>{file.name.endsWith('.xlsx') ? <FileSpreadsheet size={16} /> : file.name.endsWith('.pdf') ? <FileText size={16} /> : <File size={16} />}</i>
                  <span><strong>{file.name}</strong><small>{file.type} · {file.size}</small></span>
                  {file.status === 'ready' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className={`command-composer${listening ? ' is-listening' : ''}`}>
          <div className="command-label"><Sparkles size={13} /><span>GIVE COPILOT A TASK</span><small>Typed command or voice via Gradium adapter</small></div>
          <div className="command-input-row">
            <button className="voice-button" onClick={onVoice} aria-label={listening ? 'Stop voice input' : 'Start voice input'}>
              {listening ? <Square size={17} /> : <Mic size={18} />}
              {listening && <span className="voice-rings"><i /><i /></span>}
            </button>
            <label>
              <span className="sr-only">Copilot command</span>
              <input value={command} onChange={(event) => onCommand(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && command.trim()) onPlan(); }} placeholder="Prepare the arc-flash report for CV-104…" />
            </label>
            <button className="button-primary command-submit" onClick={onPlan} disabled={!command.trim()}><span>Prepare task plan</span><ArrowRight size={16} /></button>
          </div>
          <div className="command-hints"><span>TRY</span><button onClick={() => onCommand(commandText)}>“Generate the draft arc-flash report for CV-104.”</button></div>
        </section>
      </section>
    </motion.main>
  );
}

function TaskPlan({ hStatus, command, onBack, onStart }: { hStatus: HComputerStatus; command: string; onBack: () => void; onStart: () => void }) {
  return (
    <motion.main className="plan-layout" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <aside className="plan-rail">
        <button className="back-link" onClick={onBack}><ArrowLeft size={14} /> Project</button>
        <div className="plan-rail-head"><span>EXECUTION PLAN</span><strong>9 steps</strong><small>~14 seconds in demo mode</small></div>
        <ol className="plan-step-list">
          {automationSteps.map((step, index) => (
            <li key={step.id}><i>{index + 1}</i><div><strong>{step.label}</strong><span>{step.detail}</span></div></li>
          ))}
        </ol>
      </aside>
      <section className="plan-main">
        <div className="plan-command"><AudioLines size={16} /><div><span>COMMAND RESOLVED</span><strong>“{command}”</strong></div><span className="voice-source">GRADIUM / TEXT</span></div>
        <div className="plan-title"><span>READY TO EXECUTE</span><h1>The agent can do the repetition.<br />The engineer keeps the judgment.</h1><p>ArcFlash Copilot will operate the study workbench, collect three result records, generate a traceable draft, and stop before export.</p></div>
        <div className="plan-system">
          <NetworkDiagram compact />
          <div className="plan-outputs">
            <span>EXPECTED OUTPUTS</span>
            <div><Check size={13} /><strong>3</strong><span>equipment result captures</span></div>
            <div><Check size={13} /><strong>3</strong><span>evidence screenshots</span></div>
            <div><Check size={13} /><strong>1</strong><span>watermarked report draft</span></div>
            <div className="is-warning"><AlertTriangle size={13} /><strong>1</strong><span>known review exception</span></div>
          </div>
        </div>
      </section>
      <aside className="execution-inspector">
        <div className="inspector-title"><span>EXECUTION CONTROLS</span><strong>Secure session profile</strong></div>
        <div className="integration-stack">
          <div className={hStatus.configured ? 'is-ready' : 'is-demo'}><i><Bot size={16} /></i><span><strong>H Computer</strong><small>{hStatus.configured ? `Cloud browser · ${hStatus.region.toUpperCase()} region` : 'Deterministic visual replay'}</small></span><b>{hStatus.configured ? 'READY' : 'DEMO'}</b></div>
          <div className="is-ready"><i><Shield size={16} /></i><span><strong>NemoClaw boundary</strong><small>2 apps · 1 folder allowlisted</small></span><b>READY</b></div>
          <div className="is-ready"><i><Volume2 size={16} /></i><span><strong>Gradium voice</strong><small>Command transcript captured</small></span><b>READY</b></div>
        </div>
        <div className="allowlist-block">
          <span>SESSION ALLOWLIST</span>
          <dl><dt>Applications</dt><dd>Copilot, OpenGrid</dd><dt>Folder</dt><dd>/projects/CV-104</dd><dt>Network</dt><dd>{hStatus.configured ? 'H cloud only' : 'Disabled'}</dd><dt>Recording</dt><dd>Enabled</dd></dl>
        </div>
        {!hStatus.configured && <div className="adapter-note"><KeyRound size={14} /><p>{hStatus.message} The complete UI path remains available offline.</p></div>}
        <button className="button-primary start-run-button" onClick={onStart}><Play size={16} /> Start secure run</button>
        <p className="start-disclaimer">The session stops at the human approval gate. No report can be issued automatically.</p>
      </aside>
    </motion.main>
  );
}

function WorkflowRail({ stepIndex, phase, hMode }: { stepIndex: number; phase: AppPhase; hMode: 'cloud' | 'demo' }) {
  return (
    <aside className="workflow-rail">
      <div className="workflow-rail-head"><span>AGENT PLAN</span><strong>{stepIndex < 0 ? 'Starting' : `${Math.min(stepIndex + 1, 9)} / 9`}</strong></div>
      <ol>
        {automationSteps.map((step, index) => (
          <li key={step.id} className={`${index === stepIndex ? 'is-active' : ''}${index < stepIndex || phase === 'review' || phase === 'approved' || phase === 'exported' ? 'is-complete' : ''}`}>
            <i>{index < stepIndex || phase === 'review' || phase === 'approved' || phase === 'exported' ? <Check size={10} /> : index + 1}</i>
            <div><strong>{step.label}</strong><span>{step.actor}</span></div>
          </li>
        ))}
      </ol>
      <div className="rail-services">
        <div><Bot size={12} /><span>Computer use</span><strong>{hMode === 'cloud' ? 'H CLOUD' : 'REPLAY'}</strong></div>
        <div><Shield size={12} /><span>Secure session</span><strong>ISOLATED</strong></div>
        <div><AudioLines size={12} /><span>Voice</span><strong>CAPTURED</strong></div>
      </div>
    </aside>
  );
}

function BootSequence({ mode }: { mode: 'cloud' | 'demo' }) {
  return (
    <main className="boot-stage">
      <motion.div className="boot-core" initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
        <div className="boot-orbit"><i /><i /><i /><Shield size={28} /></div>
        <span>SECURE EXECUTION LAYER</span>
        <h1>Starting isolated workspace</h1>
        <p>NemoClaw policy is restricting applications, project files, clipboard access, and network scope before H Computer takes control.</p>
        <div className="boot-checks">
          {['Workspace mounted read-only', 'Application allowlist applied', 'Session recording enabled', mode === 'cloud' ? 'H cloud browser attached' : 'Deterministic replay attached'].map((item, index) => (
            <motion.div key={item} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + index * 0.18 }}><Check size={13} /> {item}</motion.div>
          ))}
        </div>
      </motion.div>
    </main>
  );
}

function ReviewInspector({ phase, evidence, review, onApprove, onExport, onAudit, onRecapture, onEdit, onFlag }: {
  phase: AppPhase;
  evidence: Evidence[];
  review: ReviewRecord | null;
  onApprove: () => void;
  onExport: () => void;
  onAudit: () => void;
  onRecapture: (id: string) => void;
  onEdit: (id: string) => void;
  onFlag: (id: string) => void;
}) {
  const isApproved = phase === 'approved' || phase === 'exported';
  const mcc = evidence.find((item) => item.id === 'MCC-01');
  const mccMissing = mcc?.clearingTime == null;
  const hasBlockingEvidence = evidence.some((item) => item.status === 'rejected' || item.status === 'recapture_queued');
  return (
    <aside className="review-inspector">
      <div className="review-inspector-head">
        <span>REVIEW GATE</span>
        <strong>{isApproved ? 'Draft cleared for export' : 'Engineer action required'}</strong>
        <small>{isApproved ? 'Approval applies to this draft package only.' : 'Automation has stopped. No final issue is permitted.'}</small>
      </div>

      <div className="review-progress">
        <div className="is-complete"><i><Check size={10} /></i><span><strong>Source evidence</strong><small>3 records attached</small></span></div>
        <div className="is-complete"><i><Check size={10} /></i><span><strong>Draft assembled</strong><small>7 report sections</small></span></div>
        <div className={isApproved ? 'is-complete' : 'is-active'}><i>{isApproved ? <Check size={10} /> : 3}</i><span><strong>Engineer review</strong><small>{isApproved ? review?.reviewer : 'Awaiting acknowledgement'}</small></span></div>
      </div>

      <section className={`exception-panel${mccMissing ? '' : ' is-resolved'}`}>
        <div>{mccMissing ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}<span>{mccMissing ? 'OPEN EXCEPTION' : 'ENGINEER CORRECTION'}</span><strong>{mccMissing ? 'EX-001' : 'RECORDED'}</strong></div>
        <h3>{mccMissing ? 'MCC-01 clearing time not available' : 'MCC-01 clearing time supplied'}</h3>
        <p>{mccMissing ? exceptionText : `${mcc?.clearingTime?.toFixed(3)} s · ${mcc?.engineerNote ?? 'Engineer-supplied content'}`}</p>
        <dl><dt>Value stored</dt><dd>{mccMissing ? 'NULL · no estimate' : `${mcc?.clearingTime?.toFixed(3)} s`}</dd><dt>Draft disposition</dt><dd>{mccMissing ? isApproved ? 'Deferred to review' : 'Action required' : 'Engineer supplied'}</dd></dl>
        <div className="exception-actions"><button className="recapture-button" onClick={() => onRecapture('MCC-01')}><RotateCcw size={13} /> Recapture</button><button className="recapture-button" onClick={() => onEdit('MCC-01')}><FileText size={13} /> {mccMissing ? 'Provide value' : 'Edit value'}</button></div>
      </section>

      <section className="evidence-review-summary">
        <span>EVIDENCE DISPOSITION</span>
        {evidence.map((item) => (
          <div key={item.evidenceId} className={`${item.clearingTime == null ? 'has-warning' : ''}${item.status === 'rejected' || item.status === 'recapture_queued' ? ' is-blocking' : ''}`}>
            {item.status === 'rejected' ? <X size={12} /> : item.status === 'recapture_queued' ? <RotateCcw size={12} /> : item.clearingTime == null ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
            <span><strong>{item.id}</strong><small>{item.evidenceId}</small></span>
            <b>{isApproved ? item.clearingTime == null ? 'DEFERRED' : 'ACCEPTED' : item.status === 'rejected' ? 'FLAGGED' : item.status === 'recapture_queued' ? 'QUEUED' : item.provenance === 'engineer' ? 'ENGINEER' : item.clearingTime == null ? 'REVIEW' : 'VERIFIED'}</b>
            <span className="review-row-actions"><button onClick={() => onEdit(item.id)}>Edit</button><button onClick={() => onFlag(item.id)}>Flag</button><button onClick={() => onRecapture(item.id)}>Recapture</button></span>
          </div>
        ))}
      </section>

      {isApproved && review ? (
        <section className="approved-record"><UserCheck size={18} /><div><span>REVIEW RECORDED</span><strong>{review.reviewer}</strong><small>{review.role} · {review.timestamp}</small></div></section>
      ) : (
        <button className="button-primary approve-button" disabled={hasBlockingEvidence} onClick={onApprove}><BookOpenCheck size={15} /> {hasBlockingEvidence ? 'Resolve flagged evidence' : 'Review and approve draft'}</button>
      )}

      <button className="export-button" disabled={!isApproved} onClick={onExport}><Download size={15} /><span><strong>{phase === 'exported' ? 'Download again' : 'Export review PDF'}</strong><small>{isApproved ? reportFilename : 'Locked until engineer review'}</small></span></button>
      <button className="audit-link" onClick={onAudit}><History size={13} /> View {isApproved ? 'complete' : 'current'} audit trail <ArrowRight size={12} /></button>
    </aside>
  );
}

export default function App() {
  if (window.location.pathname.startsWith('/study')) return <OperatorWorkbench />;

  const [phase, setPhase] = useState<AppPhase>('home');
  const [command, setCommand] = useState('');
  const [listening, setListening] = useState(false);
  const [stepIndex, setStepIndex] = useState(-1);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [review, setReview] = useState<ReviewRecord | null>(null);
  const [hStatus, setHStatus] = useState<HComputerStatus>(defaultHStatus);
  const [hSessionId, setHSessionId] = useState<string | null>(null);
  const [hSessionState, setHSessionState] = useState<string>('idle');
  const [paused, setPaused] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [editingEvidenceId, setEditingEvidenceId] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<'run' | 'evidence' | 'report'>('run');
  const runVersion = useRef(0);
  const pausedRef = useRef(false);
  const clockRef = useRef(8);

  useEffect(() => {
    fetch('/api/hcomputer/status')
      .then((response) => response.ok ? response.json() as Promise<HComputerStatus> : Promise.reject(new Error('unavailable')))
      .then(setHStatus)
      .catch(() => setHStatus({ ...defaultHStatus, message: 'API server is offline; using deterministic demo mode.' }));
  }, []);

  useEffect(() => {
    if (!hSessionId || hSessionState === 'completed' || hSessionState === 'failed') return;
    const timer = window.setInterval(() => {
      fetch(`/api/hcomputer/sessions/${hSessionId}`)
        .then((response) => response.json())
        .then((snapshot: { status?: string }) => setHSessionState(snapshot.status ?? 'running'))
        .catch(() => setHSessionState('connection_lost'));
    }, 3500);
    return () => window.clearInterval(timer);
  }, [hSessionId, hSessionState]);

  const activeStep = stepIndex >= 0 ? automationSteps[stepIndex] : undefined;
  const isReviewPhase = phase === 'review' || phase === 'approved' || phase === 'exported';
  const phaseIndex = phaseOrder.indexOf(phase);
  const unresolvedCount = evidence.some((item) => item.id === 'MCC-01' && item.clearingTime == null) ? 1 : 0;
  const editingEvidence = evidence.find((item) => item.id === editingEvidenceId) ?? null;

  const appendAudit = (actor: AuditEvent['actor'], type: string, detail: string, target?: string) => {
    const event: AuditEvent = {
      id: `AU-${String(Date.now()).slice(-7)}-${Math.random().toString(36).slice(2, 5)}`,
      timestamp: formatClock(clockRef.current++), actor, type, detail, target,
    };
    setAudit((items) => [...items, event]);
    return event;
  };

  const waitWithPause = async (duration: number, version: number) => {
    let elapsed = 0;
    while (elapsed < duration && runVersion.current === version) {
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      if (!pausedRef.current) elapsed += 80;
    }
  };

  const resolveCommand = () => {
    if (!command.trim()) setCommand(commandText);
    setAudit(seedAudit);
    clockRef.current = 8;
    setPhase('plan');
  };

  const startVoice = () => {
    if (listening) { setListening(false); return; }
    setListening(true);
    window.setTimeout(() => {
      setCommand(commandText);
      setListening(false);
      setAudit(seedAudit);
      clockRef.current = 8;
      setPhase('plan');
    }, 1500);
  };

  const startCloudSession = async () => {
    if (!hStatus.configured) return;
    setHSessionState('starting');
    try {
      const response = await fetch('/api/hcomputer/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (!response.ok) throw new Error('Cloud session could not be started');
      const session = await response.json() as { id?: string; status?: string };
      if (session.id) setHSessionId(session.id);
      setHSessionState(session.status ?? 'running');
      appendAudit('H Computer', 'CLOUD_SESSION_ATTACHED', `H visual browser session ${session.id?.slice(0, 8) ?? 'created'} attached`);
    } catch {
      setHSessionState('fallback');
      appendAudit('System', 'CLOUD_SESSION_FALLBACK', 'H Computer cloud start failed; deterministic visual replay continued without interrupting evidence capture');
    }
  };

  const startRun = async () => {
    const version = ++runVersion.current;
    setEvidence([]); setSelectedId(undefined); setReview(null); setStepIndex(-1); setPaused(false); pausedRef.current = false;
    setPhase('booting');
    void startCloudSession();
    appendAudit('NemoClaw', 'SECURE_SESSION_STARTED', 'Restricted workspace created: 2 applications, 1 project folder, session recording enabled');
    await waitWithPause(1250, version);
    if (runVersion.current !== version) return;
    setPhase('running');

    const eventTypeByStep: Record<string, string> = {
      session: 'POLICY_VERIFIED', launch: 'APPLICATION_OPENED', project: 'PROJECT_OPENED', case: 'STUDY_CASE_VERIFIED', module: 'STUDY_RESULTS_OPENED',
      'capture-swgr': 'EVIDENCE_CAPTURED', 'capture-mcc': 'EVIDENCE_CAPTURED', 'capture-motor': 'EVIDENCE_CAPTURED', draft: 'REPORT_DRAFT_GENERATED',
    };

    for (let index = 0; index < automationSteps.length; index += 1) {
      if (runVersion.current !== version) return;
      const step = automationSteps[index];
      setStepIndex(index);
      if (step.equipmentId) setSelectedId(step.equipmentId);
      appendAudit(step.actor, eventTypeByStep[step.id], step.detail, step.equipmentId);
      await waitWithPause(step.duration, version);
      if (runVersion.current !== version) return;
      if (step.evidenceId) {
        const item = evidenceCatalog.find((entry) => entry.evidenceId === step.evidenceId);
        if (item) setEvidence((items) => items.some((entry) => entry.evidenceId === item.evidenceId) ? items : [...items, { ...item }]);
        if (step.equipmentId === 'MCC-01') appendAudit('Extractor', 'EXCEPTION_CREATED', 'EX-001 · Protective-device clearing time was not visible; no value inferred', 'MCC-01');
      }
    }

    setPhase('review');
    setSelectedId('MCC-01');
    appendAudit('System', 'HUMAN_APPROVAL_REQUIRED', 'Automation stopped before draft export; engineer review gate engaged');
  };

  const togglePause = () => {
    const next = !paused;
    pausedRef.current = next;
    setPaused(next);
    appendAudit('System', next ? 'SESSION_PAUSED' : 'SESSION_RESUMED', next ? 'Engineer paused computer-use automation' : 'Engineer resumed computer-use automation');
  };

  const resetDemo = () => {
    runVersion.current += 1;
    pausedRef.current = false;
    setPhase('home'); setCommand(''); setListening(false); setStepIndex(-1); setEvidence([]); setSelectedId(undefined);
    setAudit([]); setReview(null); setHSessionId(null); setHSessionState('idle'); setPaused(false); setApprovalOpen(false); setEditingEvidenceId(null); setAuditOpen(false); setMobileTab('run');
    clockRef.current = 8;
  };

  const requestRecapture = (id: string) => {
    if (review) {
      setReview(null); setPhase('review');
      appendAudit('System', 'DRAFT_APPROVAL_REVOKED', 'A recapture request changed the evidence package after approval', id);
    }
    setEvidence((items) => items.map((item) => item.id === id ? { ...item, status: 'recapture_queued' } : item));
    appendAudit('Engineer', 'RECAPTURE_REQUESTED', `New source capture requested for ${id}`, id);
    window.setTimeout(() => {
      setEvidence((items) => items.map((item) => item.id === id ? { ...item, status: item.clearingTime == null ? 'needs_review' : 'verified', capturedAt: '10:30:46', action: 'Recaptured equipment result screen; missing fields preserved' } : item));
      appendAudit('H Computer', 'EVIDENCE_RECAPTURED', `${id} source screen recaptured; no hidden values inferred`, id);
    }, 1100);
  };

  const flagEvidence = (id: string) => {
    if (review) {
      setReview(null); setPhase('review');
      appendAudit('System', 'DRAFT_APPROVAL_REVOKED', 'Evidence was flagged after approval', id);
    }
    setEvidence((items) => items.map((item) => item.id === id ? { ...item, status: 'rejected' } : item));
    appendAudit('Engineer', 'SCREENSHOT_REJECTED', `${id} evidence flagged as incorrect; draft export blocked until recapture`, id);
  };

  const saveEvidenceEdits = (edits: EvidenceEdits) => {
    if (!editingEvidence) return;
    const before = `${editingEvidence.incidentEnergy ?? 'null'} cal/cm², ${editingEvidence.boundary ?? 'null'} in, ${editingEvidence.clearingTime ?? 'null'} s`;
    if (review) {
      setReview(null); setPhase('review');
      appendAudit('System', 'DRAFT_APPROVAL_REVOKED', 'Engineer-supplied content changed the evidence package after approval', editingEvidence.id);
    }
    setEvidence((items) => items.map((item) => item.id === editingEvidence.id ? {
      ...item,
      incidentEnergy: edits.incidentEnergy,
      boundary: edits.boundary,
      clearingTime: edits.clearingTime,
      missingFields: edits.clearingTime == null ? item.missingFields : undefined,
      provenance: 'engineer',
      engineerNote: edits.note,
      status: edits.clearingTime == null ? 'needs_review' : 'verified',
      action: `Engineer supplied correction · ${edits.note}`,
    } : item));
    appendAudit('Engineer', 'VALUE_EDITED', `${editingEvidence.id}: ${before} → ${edits.incidentEnergy} cal/cm², ${edits.boundary} in, ${edits.clearingTime ?? 'null'} s. Note: ${edits.note}`, editingEvidence.id);
    setEditingEvidenceId(null);
  };

  const approveDraft = (record: ReviewRecord) => {
    setEvidence((items) => applyReviewDisposition(items));
    setReview(record);
    setPhase('approved');
    setApprovalOpen(false);
    appendAudit('Engineer', 'EXCEPTION_DEFERRED', 'EX-001 retained in Missing information and Limitations; source value remains null', 'MCC-01');
    appendAudit('Engineer', 'DRAFT_APPROVED_FOR_REVIEW', `${record.reviewer} approved draft assembly for internal review export; ${record.unresolvedCount} unresolved item acknowledged`);
  };

  const exportDraft = async () => {
    if (!review || !canExportDraft(evidence, review)) return;
    const exportEvent: AuditEvent = { id: `AU-${Date.now()}`, timestamp: formatClock(clockRef.current++), actor: 'System', type: 'REPORT_EXPORTED_FOR_REVIEW', detail: `${reportFilename} generated with permanent draft watermark and ${review.unresolvedCount} unresolved item${review.unresolvedCount === 1 ? '' : 's'}` };
    const nextAudit = [...audit, exportEvent];
    setAudit(nextAudit);
    try {
      await generateDraftPdf(evidence, review, nextAudit);
      setPhase('exported');
    } catch (error) {
      appendAudit('System', 'EXPORT_FAILED', error instanceof Error ? error.message : 'Draft export failed');
    }
  };

  const currentStatus = useMemo(() => {
    if (phase === 'running') return paused ? 'Session paused by engineer' : activeStep?.detail ?? 'Operating study workbench';
    if (phase === 'review') return 'Draft generated · engineer review required';
    if (phase === 'approved') return 'Engineer-reviewed draft · ready for export';
    if (phase === 'exported') return 'Draft package exported · not approved for issue';
    return '';
  }, [phase, paused, activeStep]);

  return (
    <div className={`app-shell phase-${phase}`}>
      <GlobalHeader phase={phase} onAudit={() => setAuditOpen(true)} onReset={resetDemo} />

      <AnimatePresence mode="wait">
        {phase === 'home' && <ProjectHome key="home" command={command} onCommand={setCommand} onPlan={resolveCommand} listening={listening} onVoice={startVoice} />}
        {phase === 'plan' && <TaskPlan key="plan" hStatus={hStatus} command={command || commandText} onBack={() => setPhase('home')} onStart={startRun} />}
        {phase === 'booting' && <BootSequence key="booting" mode={hStatus.mode} />}
        {phase === 'running' && (
          <motion.main key="running" className={`cockpit-layout${paused ? ' is-paused' : ''}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <WorkflowRail stepIndex={stepIndex} phase={phase} hMode={hStatus.mode} />
            <div className={`cockpit-center mobile-${mobileTab}`}>
              <div className="workspace-label"><span><i /> LIVE APPLICATION</span><strong>{hSessionId ? `H SESSION ${hSessionId.slice(0, 8).toUpperCase()}` : hStatus.configured ? hSessionState.toUpperCase() : 'DETERMINISTIC REPLAY'}</strong></div>
              <StudyWorkbench step={activeStep} stepIndex={stepIndex} selectedId={selectedId} captured={evidence} onSelect={setSelectedId} />
            </div>
            <div className={`cockpit-evidence mobile-${mobileTab}`}><EvidenceRail evidence={evidence} selectedId={selectedId} onSelect={setSelectedId} /></div>
          </motion.main>
        )}
        {isReviewPhase && (
          <motion.main key="review" className="review-layout" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <WorkflowRail stepIndex={automationSteps.length} phase={phase} hMode={hStatus.mode} />
            <div className={`review-center mobile-${mobileTab}`}><ReportPreview evidence={evidence} review={review} selectedId={selectedId} onSelectEvidence={setSelectedId} /></div>
            <ReviewInspector phase={phase} evidence={evidence} review={review} onApprove={() => setApprovalOpen(true)} onExport={exportDraft} onAudit={() => setAuditOpen(true)} onRecapture={requestRecapture} onEdit={setEditingEvidenceId} onFlag={flagEvidence} />
          </motion.main>
        )}
      </AnimatePresence>

      {(phase === 'running' || isReviewPhase) && (
        <div className="command-dock">
          <div className="dock-voice"><AudioLines size={16} /><div className="mini-wave">{[1,2,3,4,5,6,7,8].map((bar) => <i key={bar} />)}</div><span>VOICE COMMAND CAPTURED</span></div>
          <div className="dock-status"><i className={phase === 'review' ? 'is-warning' : phaseIndex >= 5 ? 'is-ok' : ''} /><span>{phase === 'running' ? activeStep?.actor : phaseIndex >= 5 ? 'ENGINEER' : 'SYSTEM'}</span><strong>{currentStatus}</strong></div>
          <div className="dock-actions">
            {phase === 'running' && <><button className="button-secondary" onClick={togglePause}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? 'Resume' : 'Pause'}</button><button className="stop-button" onClick={() => { runVersion.current += 1; setPhase('plan'); }}><Square size={12} /> Stop</button></>}
            {isReviewPhase && <button className="button-secondary" onClick={() => setAuditOpen(true)}><History size={14} /> Audit trail</button>}
          </div>
        </div>
      )}

      {(phase === 'running' || isReviewPhase) && (
        <nav className="mobile-tabs" aria-label="Workspace views">
          <button className={mobileTab === 'run' ? 'is-active' : ''} onClick={() => setMobileTab('run')}><TerminalSquare size={15} /> Run</button>
          <button className={mobileTab === 'evidence' ? 'is-active' : ''} onClick={() => setMobileTab('evidence')}><ScanLineIcon /> Evidence <b>{evidence.length}</b></button>
          <button className={mobileTab === 'report' ? 'is-active' : ''} onClick={() => setMobileTab('report')}><FileText size={15} /> Report</button>
        </nav>
      )}

      {phase === 'exported' && (
        <motion.div className="export-toast" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <CheckCircle2 size={18} /><div><strong>Draft package prepared</strong><span>{review?.unresolvedCount ?? unresolvedCount} unresolved item{(review?.unresolvedCount ?? unresolvedCount) === 1 ? '' : 's'} acknowledged · not approved for issue</span></div><button onClick={() => setAuditOpen(true)}>View record</button><button className="icon-button" onClick={() => setPhase('approved')} aria-label="Dismiss"><X size={14} /></button>
        </motion.div>
      )}

      <ApprovalDialog open={approvalOpen} unresolvedCount={unresolvedCount} onClose={() => setApprovalOpen(false)} onApprove={approveDraft} />
      <EditEvidenceDialog evidence={editingEvidence} onClose={() => setEditingEvidenceId(null)} onSave={saveEvidenceEdits} />
      <AuditDrawer open={auditOpen} events={audit} onClose={() => setAuditOpen(false)} />
    </div>
  );
}

function ScanLineIcon() {
  return <CircleDot size={15} />;
}
