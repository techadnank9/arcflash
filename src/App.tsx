import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, ArrowLeft, ArrowRight, AudioLines, BookOpenCheck, Bot, Check, CheckCircle2,
  ChevronDown, CircleDot, Clock3, Cloud, Code2, Download, ExternalLink, File, FileCheck2,
  FileClock, FileSpreadsheet, FileText, FolderOpen, Gauge, History, KeyRound, Layers3,
  Mic, MoreHorizontal, Pause, Play, RefreshCw, RotateCcw, Search, Shield, ShieldCheck, Sparkles,
  Square, TerminalSquare, Upload, UserCheck, Volume2, X, Zap,
} from 'lucide-react';
import {
  automationSteps, commandText, evidenceCatalog, exceptionText, openSourceStack, project,
  projectFiles, seedAudit, studyAssumptions,
} from './data';
import { hExecutionPresentation } from './lib/hcomputer';
import { generateDraftPdf, reportFilename } from './lib/report';
import { applyReviewDisposition, canExportDraft } from './lib/safety';
import type {
  AppPhase, AuditEvent, Evidence, GradiumStatus, HComputerStatus, HSessionSnapshot, NemoClawStatus,
  ReviewRecord,
} from './types';
import { ApprovalDialog } from './components/ApprovalDialog';
import { AuditDrawer } from './components/AuditDrawer';
import { EvidenceRail } from './components/EvidenceRail';
import { EditEvidenceDialog, type EvidenceEdits } from './components/EditEvidenceDialog';
import { ElectrisimLab } from './components/ElectrisimLab';
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
  message: 'Checking the Python H Computer adapter…',
};

const defaultNemoClawStatus: NemoClawStatus = {
  available: false,
  ready: false,
  required: true,
  sandboxName: 'arcflash-copilot',
  message: 'Checking the NemoClaw/OpenShell runtime…',
};

const defaultGradiumStatus: GradiumStatus = {
  configured: false,
  available: false,
  message: 'Checking the Gradium speech adapter…',
};

type CommandSource = 'text' | 'gradium';
type VoicePhase = 'idle' | 'requesting' | 'listening' | 'transcribing' | 'error';

interface VoiceCapture {
  context: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  sink: GainNode;
  chunks: Float32Array[];
  frameCount: number;
  timeoutId: number;
}

const formatClock = (seconds: number) => `10:30:${String(seconds).padStart(2, '0')}`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const firstString = (...values: unknown[]) => values.find((value): value is string => typeof value === 'string' && value.length > 0);
const firstBoolean = (fallback: boolean, ...values: unknown[]) => values.find((value): value is boolean => typeof value === 'boolean') ?? fallback;

function normalizeNemoClawStatus(payload: unknown): NemoClawStatus {
  if (!isRecord(payload)) return defaultNemoClawStatus;
  const sandbox = isRecord(payload.sandbox) ? payload.sandbox : undefined;
  const rawMode = firstString(payload.mode);
  const mode = rawMode === 'required' || rawMode === 'preferred' || rawMode === 'off' ? rawMode : undefined;
  const requiredByMode = mode === undefined ? true : mode === 'required';
  return {
    available: firstBoolean(false, payload.available, payload.installed, payload.cliAvailable, payload.cli_available),
    ready: firstBoolean(false, payload.ready, payload.sandboxReady, payload.sandbox_ready, payload.enforced, payload.healthy, sandbox?.ready),
    required: firstBoolean(requiredByMode, payload.required),
    sandboxName: firstString(payload.sandboxName, payload.sandbox_name, sandbox?.name, typeof payload.sandbox === 'string' ? payload.sandbox : undefined) ?? defaultNemoClawStatus.sandboxName,
    message: firstString(payload.message, payload.detail) ?? defaultNemoClawStatus.message,
    configured: firstBoolean(false, payload.configured),
    enforced: firstBoolean(false, payload.enforced),
    phase: firstString(payload.phase),
    mode,
    cliAvailable: firstBoolean(false, payload.cliAvailable, payload.cli_available),
    openshellAvailable: firstBoolean(false, payload.openshellAvailable, payload.openshell_available),
    providerAttached: firstBoolean(false, payload.providerAttached, payload.provider_attached, sandbox?.providerAttached, sandbox?.provider_attached),
    policyApplied: firstBoolean(false, payload.policyApplied, payload.policy_applied, sandbox?.policyApplied, sandbox?.policy_applied),
    workerReady: firstBoolean(false, payload.workerReady, payload.worker_ready, sandbox?.workerReady, sandbox?.worker_ready),
  };
}

function normalizeHComputerStatus(payload: unknown): HComputerStatus {
  if (!isRecord(payload)) return defaultHStatus;
  const rawMode = firstString(payload.mode);
  const mode = rawMode === 'sandbox' || rawMode === 'cloud' || rawMode === 'demo' ? rawMode : 'demo';
  return {
    configured: firstBoolean(false, payload.configured),
    reachable: firstBoolean(false, payload.reachable),
    targetConfigured: firstBoolean(false, payload.targetConfigured, payload.target_configured),
    region: firstString(payload.region)?.toLowerCase() === 'us' ? 'us' : 'eu',
    mode,
    message: firstString(payload.message, payload.detail) ?? defaultHStatus.message,
    agent: firstString(payload.agent),
    sandbox: payload.sandbox === undefined ? undefined : normalizeNemoClawStatus(payload.sandbox),
  };
}

function normalizeGradiumStatus(payload: unknown): GradiumStatus {
  if (!isRecord(payload)) return defaultGradiumStatus;
  return {
    configured: firstBoolean(false, payload.configured),
    available: firstBoolean(false, payload.available, payload.configured),
    message: firstString(payload.message, payload.detail) ?? defaultGradiumStatus.message,
    maxAudioBytes: typeof payload.maxAudioBytes === 'number'
      ? payload.maxAudioBytes
      : typeof payload.max_audio_bytes === 'number' ? payload.max_audio_bytes : undefined,
  };
}

function encodeWav(chunks: Float32Array[], frameCount: number, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + frameCount * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + frameCount * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, frameCount * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (const rawSample of chunk) {
      const sample = Math.max(-1, Math.min(1, rawSample));
      view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function sessionState(value: unknown, fallback = 'running', depth = 0): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (!isRecord(value) || depth > 3) return fallback;
  for (const key of ['status', 'state']) {
    if (value[key] !== undefined) {
      const normalized = sessionState(value[key], '', depth + 1);
      if (normalized) return normalized;
    }
  }
  return fallback;
}

function sessionId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const nested = isRecord(value.session) ? value.session : undefined;
  return firstString(value.id, value.sessionId, value.session_id, nested?.id);
}

function sessionAgentViewUrl(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const nested = isRecord(value.session) ? value.session : undefined;
  return firstString(value.agentViewUrl, value.agent_view_url, nested?.agentViewUrl, nested?.agent_view_url);
}

function apiErrorMessage(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  const detail = isRecord(value.detail) ? value.detail : undefined;
  return firstString(detail?.message, value.message, value.code) ?? fallback;
}

const terminalHStates = new Set(['completed', 'failed', 'timed_out', 'interrupted']);
const isTerminalHState = (state: string) => terminalHStates.has(state.toLowerCase());

const nemoClawEnforced = (status: NemoClawStatus) => status.ready && status.mode !== 'off' && status.enforced !== false;

const hComputerReady = (status: HComputerStatus, nemoStatus: NemoClawStatus) => (
  status.configured
  && status.reachable
  && status.targetConfigured
  && status.mode !== 'demo'
  && (status.mode !== 'sandbox' || nemoClawEnforced(nemoStatus))
);

function Brand() {
  return (
    <div className="brand-mark" aria-label="ArcFlash Copilot">
      <i><span /></i>
      <div><strong>ARCFLASH<span>/</span></strong><small>COPILOT</small></div>
    </div>
  );
}

function GlobalHeader({ phase, hStatus, nemoStatus, runtimeChecked, onAudit, onReset }: {
  phase: AppPhase;
  hStatus: HComputerStatus;
  nemoStatus: NemoClawStatus;
  runtimeChecked: boolean;
  onAudit: () => void;
  onReset: () => void;
}) {
  const currentIndex = phase === 'home' ? 0 : phase === 'plan' || phase === 'booting' ? 1 : phase === 'running' ? 2 : phase === 'review' ? 3 : 4;
  const runtimeClass = !runtimeChecked ? 'is-checking' : nemoClawEnforced(nemoStatus) ? 'is-ready' : hStatus.mode === 'cloud' && hComputerReady(hStatus, nemoStatus) ? 'is-direct' : 'is-demo';
  const runtimeLabel = !runtimeChecked ? 'CHECKING' : nemoClawEnforced(nemoStatus) ? 'NEMOCLAW READY' : hStatus.mode === 'cloud' && hComputerReady(hStatus, nemoStatus) ? 'HOST DIRECT' : 'DEMO MODE';
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
        <a className="header-lab-link" href="/labs/electrisim" aria-label="Open Electrisim public browser lab"><Bot size={12} /><span>ELECTRISIM LAB</span></a>
        <div className={`secure-state ${runtimeClass}`}>{nemoClawEnforced(nemoStatus) ? <ShieldCheck size={12} /> : <Code2 size={12} />}<span>{runtimeLabel}</span></div>
        <button className="icon-button" onClick={onAudit} aria-label="Open audit trail"><History size={17} /></button>
        <button className="icon-button reset-button" onClick={onReset} aria-label="Reset demo"><RefreshCw size={16} /></button>
        <div className="avatar" title="A. Patel, P.E.">AP</div>
      </div>
    </header>
  );
}

function ProjectHome({ command, onCommand, onPlan, listening, voiceAvailable, voicePhase, voiceMessage, onVoice }: {
  command: string;
  onCommand: (value: string) => void;
  onPlan: () => void;
  listening: boolean;
  voiceAvailable: boolean;
  voicePhase: VoicePhase;
  voiceMessage: string;
  onVoice: () => void | Promise<void>;
}) {
  const voiceBusy = voicePhase === 'requesting' || voicePhase === 'transcribing';
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
          <div className={`command-label${voicePhase === 'error' ? ' has-error' : ''}`}><Sparkles size={13} /><span>GIVE COPILOT A TASK</span><small>{voiceMessage}</small></div>
          <div className="command-input-row">
            <button
              className="voice-button"
              onClick={() => void onVoice()}
              aria-label={listening ? 'Stop and transcribe voice input' : 'Start voice input'}
              title={voiceMessage}
              disabled={!listening && (!voiceAvailable || voiceBusy)}
            >
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

function TaskPlan({ hStatus, nemoStatus, gradiumStatus, runtimeChecked, command, commandSource, onBack, onStart }: {
  hStatus: HComputerStatus;
  nemoStatus: NemoClawStatus;
  gradiumStatus: GradiumStatus;
  runtimeChecked: boolean;
  command: string;
  commandSource: CommandSource;
  onBack: () => void;
  onStart: () => void;
}) {
  const hReady = hComputerReady(hStatus, nemoStatus);
  const sandboxReady = runtimeChecked && nemoClawEnforced(nemoStatus);
  const voiceReady = gradiumStatus.configured && gradiumStatus.available;
  const hCopy = hReady
    ? hStatus.mode === 'sandbox'
      ? `${hStatus.agent ?? 'H browser agent'} · controller in ${nemoStatus.sandboxName}`
      : `${hStatus.agent ?? 'H browser agent'} · direct Python adapter`
    : 'No live browser request · deterministic replay';
  const nemoCopy = !runtimeChecked
    ? 'Checking local NemoClaw runtime'
    : sandboxReady
      ? `${nemoStatus.sandboxName} · policy and worker verified`
      : nemoStatus.ready ? `${nemoStatus.sandboxName} ready · enforcement disabled` : 'No controlled sandbox active';
  const noteCopy = sandboxReady && hReady
    ? 'NemoClaw contains the local Python controller and credential path. The visual browser itself runs in H’s hosted environment.'
    : hStatus.mode === 'cloud' && hReady
      ? 'H is available in explicit host-direct mode; NemoClaw isolation is not active for this run.'
      : `${hStatus.message} ${nemoStatus.message} The workflow will use its deterministic demo replay and will not claim sandbox isolation.`;
  return (
    <motion.main className="plan-layout" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <aside className="plan-rail">
        <button className="back-link" onClick={onBack}><ArrowLeft size={14} /> Project</button>
        <div className="plan-rail-head"><span>EXECUTION PLAN</span><strong>9 steps</strong><small>~14-second visual workflow</small></div>
        <ol className="plan-step-list">
          {automationSteps.map((step, index) => (
            <li key={step.id}><i>{index + 1}</i><div><strong>{step.label}</strong><span>{step.detail}</span></div></li>
          ))}
        </ol>
      </aside>
      <section className="plan-main">
        <div className="plan-command"><AudioLines size={16} /><div><span>COMMAND RESOLVED</span><strong>“{command}”</strong></div><span className="voice-source">{commandSource === 'gradium' ? 'GRADIUM VOICE' : 'TEXT INPUT'}</span></div>
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
        <div className="inspector-title"><span>EXECUTION CONTROLS</span><strong>Execution profile</strong></div>
        <div className="integration-stack">
          <div className={hReady ? 'is-ready' : 'is-demo'}><i><Bot size={16} /></i><span><strong>H Computer</strong><small>{hCopy}</small></span><b>{!runtimeChecked ? 'CHECK' : hReady ? 'CONFIG' : 'DEMO'}</b></div>
          <div className={!runtimeChecked ? 'is-checking' : sandboxReady ? 'is-ready' : nemoStatus.ready ? 'is-demo' : 'is-unavailable'}><i><Shield size={16} /></i><span><strong>NemoClaw controller</strong><small>{nemoCopy}</small></span><b>{!runtimeChecked ? 'CHECK' : sandboxReady ? 'READY' : nemoStatus.ready ? 'IDLE' : 'OFFLINE'}</b></div>
          <div className={voiceReady ? 'is-ready' : 'is-unavailable'}><i><Volume2 size={16} /></i><span><strong>Gradium voice</strong><small>{commandSource === 'gradium' ? 'Live command transcript captured' : gradiumStatus.message}</small></span><b>{voiceReady ? 'READY' : 'OFFLINE'}</b></div>
        </div>
        <div className="allowlist-block">
          <span>EXECUTION BOUNDARY</span>
          <dl>
            <dt>Controller</dt><dd>{sandboxReady ? 'Sandboxed Python worker' : hStatus.mode === 'cloud' && hReady ? 'Host Python adapter' : 'Local demo replay'}</dd>
            <dt>Workspace</dt><dd>{sandboxReady ? '/sandbox/.openclaw/workspace/arcflash' : 'No sandbox mounted'}</dd>
            <dt>Network</dt><dd>{sandboxReady ? 'H API endpoints only' : hStatus.mode === 'cloud' && hReady ? 'Direct to H API' : 'No H request'}</dd>
            <dt>Browser</dt><dd>{hReady ? `H hosted · ${hStatus.region.toUpperCase()}` : 'UI replay only'}</dd>
          </dl>
        </div>
        <div className={`adapter-note${sandboxReady && hReady ? ' is-boundary' : ''}`}>{sandboxReady && hReady ? <ShieldCheck size={14} /> : <KeyRound size={14} />}<p>{noteCopy}</p></div>
        <button className="button-primary start-run-button" onClick={onStart}><Play size={16} /> {sandboxReady && hReady ? 'Start controlled run' : hReady ? 'Start hosted browser run' : 'Run deterministic demo'}</button>
        <p className="start-disclaimer">The session stops at the human approval gate. No report can be issued automatically.</p>
      </aside>
    </motion.main>
  );
}

function WorkflowRail({ stepIndex, phase, hStatus, nemoStatus, hHosted }: { stepIndex: number; phase: AppPhase; hStatus: HComputerStatus; nemoStatus: NemoClawStatus; hHosted: boolean }) {
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
        <div><Bot size={12} /><span>Browser execution</span><strong>{hHosted ? 'H HOSTED' : 'REPLAY'}</strong></div>
        <div><Shield size={12} /><span>Agent controller</span><strong>{hHosted && nemoClawEnforced(nemoStatus) ? 'NEMOCLAW' : hHosted && hStatus.mode === 'cloud' ? 'HOST DIRECT' : 'DEMO ONLY'}</strong></div>
        <div><AudioLines size={12} /><span>Voice</span><strong>CAPTURED</strong></div>
      </div>
    </aside>
  );
}

function BootSequence({ hStatus, nemoStatus }: { hStatus: HComputerStatus; nemoStatus: NemoClawStatus }) {
  const hReady = hComputerReady(hStatus, nemoStatus);
  const sandboxReady = nemoClawEnforced(nemoStatus);
  const controlledRun = sandboxReady && hReady;
  const checks = sandboxReady
    ? ['NemoClaw sandbox verified', 'Network policy applied', 'Credential provider attached', hReady ? 'H hosted browser requested' : 'Deterministic replay attached']
    : ['Runtime check completed', 'Sandbox isolation not active', 'No sandbox credential mounted', hReady ? 'Host-direct H request started' : 'Deterministic replay attached'];
  return (
    <main className="boot-stage">
      <motion.div className="boot-core" initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
        <div className="boot-orbit"><i /><i /><i /><Shield size={28} /></div>
        <span>{controlledRun ? 'CONTROLLED EXECUTION LAYER' : sandboxReady ? 'SANDBOX READY · DEMO REPLAY' : 'DETERMINISTIC DEMO MODE'}</span>
        <h1>{controlledRun ? 'Starting sandboxed controller' : 'Starting visual workflow replay'}</h1>
        <p>{controlledRun
          ? 'NemoClaw constrains the local Python controller and brokers its H credential. H runs the visual browser in its own hosted environment.'
          : sandboxReady
            ? 'The NemoClaw sandbox is ready, but H Computer is not available. The sandbox remains idle while the product workflow replays locally.'
          : 'No NemoClaw sandbox is active for this run. The product workflow remains demonstrable without presenting the replay as isolated execution.'}</p>
        <div className="boot-checks">
          {checks.map((item, index) => (
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
  if (window.location.pathname.startsWith('/labs/electrisim')) return <ElectrisimLab />;
  if (window.location.pathname.startsWith('/study')) return <OperatorWorkbench />;

  const [phase, setPhase] = useState<AppPhase>('home');
  const [command, setCommand] = useState('');
  const [commandSource, setCommandSource] = useState<CommandSource>('text');
  const [listening, setListening] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [voiceError, setVoiceError] = useState('');
  const [stepIndex, setStepIndex] = useState(-1);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [review, setReview] = useState<ReviewRecord | null>(null);
  const [hStatus, setHStatus] = useState<HComputerStatus>(defaultHStatus);
  const [nemoStatus, setNemoStatus] = useState<NemoClawStatus>(defaultNemoClawStatus);
  const [gradiumStatus, setGradiumStatus] = useState<GradiumStatus>(defaultGradiumStatus);
  const [runtimeChecked, setRuntimeChecked] = useState(false);
  const [hSessionId, setHSessionId] = useState<string | null>(null);
  const [hSessionState, setHSessionState] = useState<string>('idle');
  const [hAgentViewUrl, setHAgentViewUrl] = useState<string | null>(null);
  const [hSessionError, setHSessionError] = useState('');
  const [paused, setPaused] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [editingEvidenceId, setEditingEvidenceId] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<'run' | 'evidence' | 'report'>('run');
  const runVersion = useRef(0);
  const pausedRef = useRef(false);
  const clockRef = useRef(8);
  const hSessionIdRef = useRef<string | null>(null);
  const hSessionStateRef = useRef('idle');
  const hSessionStartRef = useRef<Promise<string | null> | null>(null);
  const voiceCaptureRef = useRef<VoiceCapture | null>(null);

  const updateHSessionId = (value: string | null) => {
    hSessionIdRef.current = value;
    setHSessionId(value);
  };

  const updateHSessionState = (value: string) => {
    hSessionStateRef.current = value;
    setHSessionState(value);
  };

  useEffect(() => {
    let active = true;
    const readStatus = async (url: string): Promise<unknown> => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} unavailable`);
      return response.json() as Promise<unknown>;
    };

    Promise.allSettled([
      readStatus('/api/hcomputer/status'),
      readStatus('/api/nemoclaw/status'),
      readStatus('/api/gradium/status'),
    ])
      .then(([hResult, nemoResult, gradiumResult]) => {
        if (!active) return;
        const nextH = hResult.status === 'fulfilled'
          ? normalizeHComputerStatus(hResult.value)
          : { ...defaultHStatus, message: 'API server is offline; H Computer will not be called.' };
        const nextNemo = nemoResult.status === 'fulfilled'
          ? normalizeNemoClawStatus(nemoResult.value)
          : nextH.sandbox ?? { ...defaultNemoClawStatus, message: 'NemoClaw status endpoint is unavailable.' };
        const nextGradium = gradiumResult.status === 'fulfilled'
          ? normalizeGradiumStatus(gradiumResult.value)
          : { ...defaultGradiumStatus, message: 'Gradium speech endpoint is unavailable; type the command instead.' };
        setHStatus(nextH);
        setNemoStatus(nextNemo);
        setGradiumStatus(nextGradium);
      })
      .finally(() => { if (active) setRuntimeChecked(true); });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!hSessionId || isTerminalHState(hSessionState)) return;
    const timer = window.setInterval(() => {
      fetch(`/api/hcomputer/sessions/${encodeURIComponent(hSessionId)}`)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('Session status unavailable')))
        .then((snapshot: HSessionSnapshot) => {
          updateHSessionState(sessionState(snapshot));
          const agentViewUrl = sessionAgentViewUrl(snapshot);
          if (agentViewUrl) setHAgentViewUrl(agentViewUrl);
        })
        .catch(() => updateHSessionState('connection_lost'));
    }, 3500);
    return () => window.clearInterval(timer);
  }, [hSessionId, hSessionState]);

  const activeStep = stepIndex >= 0 ? automationSteps[stepIndex] : undefined;
  const isReviewPhase = phase === 'review' || phase === 'approved' || phase === 'exported';
  const phaseIndex = phaseOrder.indexOf(phase);
  const unresolvedCount = evidence.some((item) => item.id === 'MCC-01' && item.clearingTime == null) ? 1 : 0;
  const editingEvidence = evidence.find((item) => item.id === editingEvidenceId) ?? null;
  const hExecution = useMemo(
    () => hExecutionPresentation(hSessionId, hSessionState),
    [hSessionId, hSessionState],
  );
  const voiceMessage = listening
    ? 'Listening · click stop when finished'
    : voicePhase === 'requesting'
      ? 'Waiting for microphone permission…'
      : voicePhase === 'transcribing'
        ? 'Gradium is transcribing the command…'
        : voicePhase === 'error'
          ? voiceError
          : gradiumStatus.message;

  const updateCommand = (value: string) => {
    setCommand(value);
    setCommandSource('text');
    if (voicePhase === 'error') {
      setVoicePhase('idle');
      setVoiceError('');
    }
  };

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
    const resolvedCommand = command.trim() || commandText;
    if (!command.trim()) setCommand(resolvedCommand);
    setAudit(seedAudit.map((event) => event.id === 'AU-002'
      ? commandSource === 'gradium'
        ? { ...event, detail: `“${resolvedCommand}”` }
        : { ...event, actor: 'System', type: 'TEXT_COMMAND_SUBMITTED', detail: `“${resolvedCommand}”` }
      : event));
    clockRef.current = 8;
    setPhase('plan');
  };

  const releaseVoiceCapture = (capture: VoiceCapture) => {
    window.clearTimeout(capture.timeoutId);
    capture.processor.onaudioprocess = null;
    capture.processor.disconnect();
    capture.source.disconnect();
    capture.sink.disconnect();
    capture.stream.getTracks().forEach((track) => track.stop());
    void capture.context.close().catch(() => undefined);
  };

  const finishVoiceCapture = async () => {
    const capture = voiceCaptureRef.current;
    if (!capture) return;
    voiceCaptureRef.current = null;
    releaseVoiceCapture(capture);
    setListening(false);

    if (capture.frameCount < capture.context.sampleRate / 4) {
      setVoicePhase('error');
      setVoiceError('No speech was captured. Try again or type the command.');
      return;
    }

    setVoicePhase('transcribing');
    setVoiceError('');
    try {
      const audio = encodeWav(capture.chunks, capture.frameCount, capture.context.sampleRate);
      const response = await fetch('/api/gradium/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: audio,
        signal: AbortSignal.timeout(30_000),
      });
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(isRecord(payload) ? firstString(payload.message, payload.detail) : undefined);
      }
      const transcript = isRecord(payload) ? firstString(payload.text, payload.transcript) : undefined;
      if (!transcript) throw new Error('Gradium returned an empty transcript.');
      setCommand(transcript.trim());
      setCommandSource('gradium');
      setVoicePhase('idle');
    } catch (error) {
      setVoicePhase('error');
      setVoiceError(error instanceof Error && error.message
        ? error.message
        : 'Gradium transcription failed. Try again or type the command.');
    }
  };

  const startVoice = async () => {
    if (voiceCaptureRef.current) {
      await finishVoiceCapture();
      return;
    }
    if (!gradiumStatus.configured || !gradiumStatus.available) {
      setVoicePhase('error');
      setVoiceError(gradiumStatus.message);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
      setVoicePhase('error');
      setVoiceError('This browser does not support microphone capture. Type the command instead.');
      return;
    }

    setVoicePhase('requesting');
    setVoiceError('');
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      context = new AudioContext({ sampleRate: 24_000 });
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(2048, 1, 1);
      const sink = context.createGain();
      sink.gain.value = 0;
      const capture: VoiceCapture = {
        context,
        stream,
        source,
        processor,
        sink,
        chunks: [],
        frameCount: 0,
        timeoutId: 0,
      };
      processor.onaudioprocess = (event) => {
        const active = voiceCaptureRef.current;
        if (!active) return;
        const maximumFrames = active.context.sampleRate * 10;
        const remaining = maximumFrames - active.frameCount;
        if (remaining <= 0) return;
        const samples = event.inputBuffer.getChannelData(0);
        const copied = new Float32Array(Math.min(samples.length, remaining));
        copied.set(samples.subarray(0, copied.length));
        active.chunks.push(copied);
        active.frameCount += copied.length;
      };
      source.connect(processor);
      processor.connect(sink);
      sink.connect(context.destination);
      voiceCaptureRef.current = capture;
      capture.timeoutId = window.setTimeout(() => void finishVoiceCapture(), 10_000);
      setListening(true);
      setVoicePhase('listening');
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      if (context) void context.close().catch(() => undefined);
      setListening(false);
      setVoicePhase('error');
      setVoiceError('Microphone access was denied or unavailable. Type the command instead.');
    }
  };

  useEffect(() => () => {
    const capture = voiceCaptureRef.current;
    if (!capture) return;
    voiceCaptureRef.current = null;
    releaseVoiceCapture(capture);
  }, []);

  const startCloudSession = async (): Promise<string | null> => {
    if (!hComputerReady(hStatus, nemoStatus)) return null;
    updateHSessionState('starting');
    setHSessionError('');
    setHAgentViewUrl(null);
    try {
      const response = await fetch('/api/hcomputer/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(60_000),
      });
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(apiErrorMessage(payload, 'Cloud session could not be started'));
      const session = payload as HSessionSnapshot;
      const id = sessionId(session);
      if (!id) throw new Error('H returned a successful response without a session ID');
      updateHSessionId(id);
      setHAgentViewUrl(
        sessionAgentViewUrl(session)
        ?? `https://platform.hcompany.ai/agents/sessions/${encodeURIComponent(id)}`,
      );
      updateHSessionState(sessionState(session));
      appendAudit(
        'H Computer',
        'CLOUD_SESSION_ATTACHED',
        `${hStatus.mode === 'sandbox' ? 'NemoClaw-contained Python controller attached' : 'Host Python adapter attached'} H hosted browser session ${id.slice(0, 8)}`,
      );
      return id;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cloud session could not be started';
      updateHSessionId(null);
      updateHSessionState('fallback');
      setHAgentViewUrl(null);
      setHSessionError(message);
      appendAudit('System', 'CLOUD_SESSION_FALLBACK', `H Computer cloud start failed: ${message}. Deterministic visual replay continued.`);
      return null;
    }
  };

  const requestHControl = async (action: 'pause' | 'resume' | 'cancel', id = hSessionIdRef.current) => {
    if (!id) return true;
    const response = await fetch(
      action === 'cancel' ? `/api/hcomputer/sessions/${encodeURIComponent(id)}` : `/api/hcomputer/sessions/${encodeURIComponent(id)}/${action}`,
      { method: action === 'cancel' ? 'DELETE' : 'POST' },
    );
    if (!response.ok) {
      if (action === 'cancel') {
        const snapshot = await fetch(`/api/hcomputer/sessions/${encodeURIComponent(id)}`).catch(() => null);
        if (snapshot?.ok) {
          const state = sessionState(await snapshot.json() as HSessionSnapshot);
          updateHSessionState(state);
          if (isTerminalHState(state)) {
            updateHSessionId(null);
            return true;
          }
        }
      }
      return false;
    }
    updateHSessionState(action === 'pause' ? 'paused' : action === 'resume' ? 'running' : 'interrupted');
    if (action === 'cancel') updateHSessionId(null);
    return true;
  };

  const waitForHSettlement = async (id: string, version: number) => {
    let remaining = 165_000;
    while (remaining > 0 && runVersion.current === version) {
      if (pausedRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        continue;
      }
      const startedAt = Date.now();
      try {
        const response = await fetch(`/api/hcomputer/sessions/${encodeURIComponent(id)}`);
        if (!response.ok) throw new Error('H session status unavailable');
        const state = sessionState(await response.json() as HSessionSnapshot);
        updateHSessionState(state);
        if (isTerminalHState(state)) return { safe: true, state };
      } catch {
        updateHSessionState('connection_lost');
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1_500));
      remaining -= Date.now() - startedAt + 1_500;
    }
    const canceled = await requestHControl('cancel', id).catch(() => false);
    return { safe: canceled, state: canceled ? 'interrupted' : 'cancel_failed' };
  };

  const startRun = async () => {
    const version = ++runVersion.current;
    setEvidence([]); setSelectedId(undefined); setReview(null); setStepIndex(-1); setPaused(false); pausedRef.current = false;
    updateHSessionId(null); updateHSessionState('idle'); setHAgentViewUrl(null); setHSessionError('');
    setPhase('booting');
    const hSessionPromise = startCloudSession();
    hSessionStartRef.current = hSessionPromise;
    if (nemoClawEnforced(nemoStatus) && hComputerReady(hStatus, nemoStatus)) {
      appendAudit('NemoClaw', 'CONTROLLED_SESSION_REQUESTED', `Sandbox ${nemoStatus.sandboxName} requested the local Python controller; attachment awaits an H session ID`);
    } else if (hStatus.mode === 'cloud' && hComputerReady(hStatus, nemoStatus)) {
      appendAudit('System', 'HOST_DIRECT_SESSION_REQUESTED', 'NemoClaw enforcement is off; the host Python adapter requested H\'s hosted browser directly');
    } else if (nemoClawEnforced(nemoStatus)) {
      appendAudit('System', 'DEMO_RUNTIME_SELECTED', `NemoClaw sandbox ${nemoStatus.sandboxName} is ready but remained idle because H Computer is unavailable; deterministic replay started`);
    } else if (nemoStatus.ready) {
      appendAudit('System', 'DEMO_RUNTIME_SELECTED', `NemoClaw sandbox ${nemoStatus.sandboxName} is ready but enforcement is disabled; deterministic replay started without an isolation claim`);
    } else {
      appendAudit('System', 'DEMO_RUNTIME_SELECTED', 'NemoClaw sandbox unavailable; deterministic visual replay started without claiming an isolated session');
    }
    await waitWithPause(1250, version);
    if (runVersion.current !== version) return;
    const liveSessionId = await hSessionPromise;
    hSessionStartRef.current = null;
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
      appendAudit(
        liveSessionId ? step.actor : 'System',
        eventTypeByStep[step.id],
        liveSessionId ? step.detail : `${step.detail} · deterministic local replay`,
        step.equipmentId,
      );
      await waitWithPause(step.duration, version);
      if (runVersion.current !== version) return;
      if (step.evidenceId) {
        const item = evidenceCatalog.find((entry) => entry.evidenceId === step.evidenceId);
        if (item) setEvidence((items) => items.some((entry) => entry.evidenceId === item.evidenceId) ? items : [...items, { ...item }]);
        if (step.equipmentId === 'MCC-01') appendAudit('Extractor', 'EXCEPTION_CREATED', 'EX-001 · Protective-device clearing time was not visible; no value inferred', 'MCC-01');
      }
    }

    if (liveSessionId) {
      appendAudit('H Computer', 'WAITING_FOR_LIVE_SESSION', 'Local workbench replay complete; report gate is waiting for the hosted browser session to settle');
      const outcome = await waitForHSettlement(liveSessionId, version);
      if (runVersion.current !== version) return;
      if (!outcome.safe) {
        pausedRef.current = true;
        setPaused(true);
        appendAudit('System', 'LIVE_SESSION_CANCEL_FAILED', 'H session status could not be verified or canceled; report review remains blocked');
        return;
      }
      if (outcome.state === 'completed') {
        appendAudit('H Computer', 'LIVE_WORKFLOW_CONFIRMED', 'H hosted browser session completed before the report review gate opened');
      } else {
        appendAudit('System', 'DETERMINISTIC_EVIDENCE_FALLBACK', `H session ended as ${outcome.state}; the report uses the clearly labeled deterministic workbench evidence`);
      }
    }

    setPhase('review');
    setSelectedId('MCC-01');
    appendAudit('System', 'HUMAN_APPROVAL_REQUIRED', 'Automation stopped before draft export; engineer review gate engaged');
  };

  const togglePause = async () => {
    const next = !paused;
    if (hSessionIdRef.current && !isTerminalHState(hSessionStateRef.current)) {
      const controlled = await requestHControl(next ? 'pause' : 'resume').catch(() => false);
      if (!controlled) {
        appendAudit('System', 'H_SESSION_CONTROL_FAILED', `Could not ${next ? 'pause' : 'resume'} the hosted H session; local state was not changed`);
        return;
      }
    }
    pausedRef.current = next;
    setPaused(next);
    appendAudit('System', next ? 'SESSION_PAUSED' : 'SESSION_RESUMED', next ? 'Engineer paused computer-use automation' : 'Engineer resumed computer-use automation');
  };

  const cancelLiveSession = async () => {
    if (hSessionStartRef.current) {
      await hSessionStartRef.current.catch(() => null);
      hSessionStartRef.current = null;
    }
    if (!hSessionIdRef.current || isTerminalHState(hSessionStateRef.current)) return true;
    return requestHControl('cancel').catch(() => false);
  };

  const resetDemo = async () => {
    if (!await cancelLiveSession()) {
      appendAudit('System', 'H_SESSION_CANCEL_FAILED', 'Reset blocked because the hosted H session could not be canceled');
      return;
    }
    const voiceCapture = voiceCaptureRef.current;
    if (voiceCapture) {
      voiceCaptureRef.current = null;
      releaseVoiceCapture(voiceCapture);
    }
    runVersion.current += 1;
    pausedRef.current = false;
    setPhase('home'); setCommand(''); setCommandSource('text'); setListening(false); setVoicePhase('idle'); setVoiceError(''); setStepIndex(-1); setEvidence([]); setSelectedId(undefined);
    setAudit([]); setReview(null); updateHSessionId(null); updateHSessionState('idle'); setHAgentViewUrl(null); setHSessionError(''); setPaused(false); setApprovalOpen(false); setEditingEvidenceId(null); setAuditOpen(false); setMobileTab('run');
    clockRef.current = 8;
  };

  const stopRun = async () => {
    if (!await cancelLiveSession()) {
      appendAudit('System', 'H_SESSION_CANCEL_FAILED', 'Stop blocked because the hosted H session could not be canceled');
      return;
    }
    runVersion.current += 1;
    pausedRef.current = false;
    setPaused(false);
    updateHSessionId(null);
    updateHSessionState('interrupted');
    setHAgentViewUrl(null);
    setHSessionError('');
    setPhase('plan');
    appendAudit('System', 'SESSION_STOPPED', 'Computer-use workflow stopped by the engineer');
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
      <GlobalHeader phase={phase} hStatus={hStatus} nemoStatus={nemoStatus} runtimeChecked={runtimeChecked} onAudit={() => setAuditOpen(true)} onReset={resetDemo} />

      <AnimatePresence mode="wait">
        {phase === 'home' && <ProjectHome key="home" command={command} onCommand={updateCommand} onPlan={resolveCommand} listening={listening} voiceAvailable={gradiumStatus.configured && gradiumStatus.available} voicePhase={voicePhase} voiceMessage={voiceMessage} onVoice={startVoice} />}
        {phase === 'plan' && <TaskPlan key="plan" hStatus={hStatus} nemoStatus={nemoStatus} gradiumStatus={gradiumStatus} runtimeChecked={runtimeChecked} command={command || commandText} commandSource={commandSource} onBack={() => setPhase('home')} onStart={startRun} />}
        {phase === 'booting' && <BootSequence key="booting" hStatus={hStatus} nemoStatus={nemoStatus} />}
        {phase === 'running' && (
          <motion.main key="running" className={`cockpit-layout${paused ? ' is-paused' : ''}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <WorkflowRail stepIndex={stepIndex} phase={phase} hStatus={hStatus} nemoStatus={nemoStatus} hHosted={hExecution.isHosted} />
            <div className={`cockpit-center mobile-${mobileTab}`}>
              <div className={`workspace-label ${hExecution.className}`}>
                <span><i /> {hExecution.label}</span>
                <div className="workspace-runtime">
                  {hAgentViewUrl && hExecution.isHosted && <a href={hAgentViewUrl} target="_blank" rel="noreferrer"><ExternalLink size={11} /> Agent View</a>}
                  <strong title={hSessionError || hExecution.status}>{hExecution.status}</strong>
                </div>
              </div>
              <StudyWorkbench step={activeStep} stepIndex={stepIndex} selectedId={selectedId} captured={evidence} onSelect={setSelectedId} />
            </div>
            <div className={`cockpit-evidence mobile-${mobileTab}`}><EvidenceRail evidence={evidence} selectedId={selectedId} onSelect={setSelectedId} /></div>
          </motion.main>
        )}
        {isReviewPhase && (
          <motion.main key="review" className="review-layout" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <WorkflowRail stepIndex={automationSteps.length} phase={phase} hStatus={hStatus} nemoStatus={nemoStatus} hHosted={hExecution.isHosted} />
            <div className={`review-center mobile-${mobileTab}`}><ReportPreview evidence={evidence} review={review} selectedId={selectedId} onSelectEvidence={setSelectedId} /></div>
            <ReviewInspector phase={phase} evidence={evidence} review={review} onApprove={() => setApprovalOpen(true)} onExport={exportDraft} onAudit={() => setAuditOpen(true)} onRecapture={requestRecapture} onEdit={setEditingEvidenceId} onFlag={flagEvidence} />
          </motion.main>
        )}
      </AnimatePresence>

      {(phase === 'running' || isReviewPhase) && (
        <div className="command-dock">
          <div className="dock-voice"><AudioLines size={16} /><div className="mini-wave">{[1,2,3,4,5,6,7,8].map((bar) => <i key={bar} />)}</div><span>{commandSource === 'gradium' ? 'GRADIUM COMMAND CAPTURED' : 'TEXT COMMAND CAPTURED'}</span></div>
          <div className="dock-status"><i className={phase === 'review' ? 'is-warning' : phaseIndex >= 5 ? 'is-ok' : ''} /><span>{phase === 'running' ? activeStep?.actor : phaseIndex >= 5 ? 'ENGINEER' : 'SYSTEM'}</span><strong>{currentStatus}</strong></div>
          <div className="dock-actions">
            {phase === 'running' && <><button className="button-secondary" onClick={() => void togglePause()}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? 'Resume' : 'Pause'}</button><button className="stop-button" onClick={() => void stopRun()}><Square size={12} /> Stop</button></>}
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
