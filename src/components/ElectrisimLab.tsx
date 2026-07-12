import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  CircleDot,
  Cloud,
  ExternalLink,
  Eye,
  Gauge,
  History,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Square,
  TerminalSquare,
  Zap,
} from 'lucide-react';
import {
  isTerminalElectrisimState,
  normalizeElectrisimCalculation,
  normalizeElectrisimChanges,
  normalizeElectrisimSession,
  readElectrisimApiError,
  type ElectrisimBrowserEvent,
  type ElectrisimCalculation,
  type ElectrisimSession,
} from '../lib/electrisim';

const DEMO_CHECKPOINTS = [
  {
    id: 'editor',
    label: 'Open the public Electrisim editor',
    detail: 'Open app.electrisim.com directly without signing in.',
    match: /app\.electrisim\.com|editor free|public editor/i,
  },
  {
    id: 'device-dialog-closed',
    label: 'Close the Device dialog',
    detail: 'Close the initial dialog without choosing Create New Diagram or Open Existing Diagram.',
    match: /clos(?:e|ed|ing)[^.]{0,60}device dialog|device dialog[^.]{0,60}clos(?:e|ed|ing)|dismiss(?:ed)?[^.]{0,60}device dialog/i,
  },
  {
    id: 'palette-items',
    label: 'Locate Line and Generator ~',
    detail: 'Use only the Line below Bus and Generator (~) below Source.',
    match: /palette[^.]{0,120}line[^.]{0,120}(?:generator|source|tilde|~)|line[^.]{0,80}(?:generator|source|tilde|~)[^.]{0,80}palette/i,
  },
  {
    id: 'line-placed',
    label: 'Draw the Line below Bus',
    detail: 'Press and hold Line, move right below Simulate, then release on the grid.',
    match: /(?:drag(?:ged)?|drop(?:ped)?|plac(?:e|ed)|add(?:ed)?)[^.]{0,80}(?:one )?line|line[^.]{0,50}(?:drag|drop|place)/i,
  },
  {
    id: 'source-placed',
    label: 'Draw Generator (~) below Source',
    detail: 'Press and hold Generator, move right below Simulate, then release beside Line.',
    match: /(?:drag(?:ged)?|drop(?:ped)?|plac(?:e|ed)|add(?:ed)?)[^.]{0,100}(?:generator|tilde|~)|(?:generator|tilde)[^.]{0,60}(?:drag|drop|place)/i,
  },
  {
    id: 'visual-confirmation',
    label: 'Confirm both items on canvas',
    detail: 'Visually verify the Line and Generator (~) before ending the session.',
    match: /line[^.]{0,100}(?:generator|tilde|~)[^.]{0,100}(?:visible|canvas|confirm)|(?:visible|confirm)[^.]{0,100}line[^.]{0,100}(?:generator|tilde|~)/i,
    requiresObservation: true,
  },
  {
    id: 'safe-stop',
    label: 'Stop without saving or simulation',
    detail: 'No login, subscription, calculation, export, save, or connected storage.',
    match: /without (?:saving|save|simulation)|did not (?:save|simulate)|no simulation|stopped before[^.]{0,80}(?:save|simulation)|remains unsaved/i,
    requiresObservation: true,
  },
] as const;

const DEMO_HEADERS = { 'X-ArcFlash-Demo': 'electrisim-public-v1' } as const;
const DEMO_JSON_HEADERS = { ...DEMO_HEADERS, 'Content-Type': 'application/json' } as const;

function sessionStatus(state: string): { label: string; tone: 'idle' | 'active' | 'success' | 'warning' } {
  switch (state.toLowerCase()) {
    case 'starting': return { label: 'Starting H browser', tone: 'active' };
    case 'pending':
    case 'queued': return { label: 'Waiting for H browser', tone: 'active' };
    case 'running':
    case 'in_progress': return { label: 'H browser active', tone: 'active' };
    case 'completed': return { label: 'H run completed', tone: 'success' };
    case 'failed': return { label: 'H run failed', tone: 'warning' };
    case 'timed_out': return { label: 'H run timed out', tone: 'warning' };
    case 'interrupted':
    case 'cancelled':
    case 'canceled': return { label: 'H run stopped', tone: 'warning' };
    default: return { label: state === 'idle' ? 'Not started' : state.replace(/_/g, ' '), tone: 'idle' };
  }
}

function formatTimestamp(value?: string): string {
  if (!value) return 'LIVE';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value.slice(0, 8).toUpperCase()
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function displayUrl(value?: string): string {
  if (!value) return 'Waiting for the first browser observation';
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return value;
  }
}

function numberValue(value: number | null, digits = 3): string {
  return value === null ? 'Not calculated' : value.toFixed(digits).replace(/\.0+$/, '');
}

function mergeSession(previous: ElectrisimSession, next: ElectrisimSession): ElectrisimSession {
  return {
    ...previous,
    ...next,
    agentViewUrl: next.agentViewUrl ?? previous.agentViewUrl,
    currentUrl: next.currentUrl ?? previous.currentUrl,
    summary: next.summary ?? previous.summary,
    screenshotUrl: next.screenshotUrl ?? previous.screenshotUrl,
    workflow: next.workflow ?? previous.workflow,
  };
}

function Brand() {
  return (
    <div className="brand-mark" aria-label="ArcFlash Copilot">
      <i><span /></i>
      <div><strong>ARCFLASH<span>/</span></strong><small>COPILOT</small></div>
    </div>
  );
}

export function ElectrisimLab() {
  const [session, setSession] = useState<ElectrisimSession | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [controlAction, setControlAction] = useState<'start' | 'stop' | 'reset' | null>(null);
  const [browserEvents, setBrowserEvents] = useState<ElectrisimBrowserEvent[]>([]);
  const [changesState, setChangesState] = useState<'idle' | 'waiting' | 'live' | 'unavailable'>('idle');
  const [calculation, setCalculation] = useState<ElectrisimCalculation | null>(null);
  const [calculationError, setCalculationError] = useState('');
  const [calculationRunning, setCalculationRunning] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const changesIndexRef = useRef(0);
  const previewObjectUrlRef = useRef<string | undefined>(undefined);

  const currentStatus = sessionStatus(session?.state ?? 'idle');
  const sessionIsActive = Boolean(session && !isTerminalElectrisimState(session.state));
  const latestFrame = [...browserEvents].reverse().find((event) => event.screenshotUrl);
  const rawFrameSource = latestFrame?.screenshotUrl ?? session?.screenshotUrl;
  const currentUrl = [...browserEvents].reverse().find((event) => event.currentUrl)?.currentUrl ?? session?.currentUrl;
  const observedText = browserEvents
    .map((event) => `${event.currentUrl ?? ''} ${event.label} ${event.detail ?? ''}`)
    .join(' ') + ` ${session?.summary ?? ''}`;
  const confirmedText = browserEvents
    .filter((event) => event.kind === 'observation')
    .map((event) => `${event.currentUrl ?? ''} ${event.label} ${event.detail ?? ''}`)
    .join(' ') + ` ${session?.summary ?? ''}`;
  const observedCheckpoints = useMemo(
    () => DEMO_CHECKPOINTS.map((checkpoint) => checkpoint.match.test(
      'requiresObservation' in checkpoint ? confirmedText : observedText,
    )),
    [confirmedText, observedText],
  );
  const checkpoints = useMemo(() => DEMO_CHECKPOINTS.map((checkpoint) => ({
    ...checkpoint,
    label: session?.workflow?.checkpoints.find((item) => item.id === checkpoint.id)?.label ?? checkpoint.label,
  })), [session?.workflow]);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const replacePreview = (next?: string, objectUrl = false) => {
      if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = objectUrl && next ? next : undefined;
      setPreviewUrl(next);
    };

    if (!session?.id || !rawFrameSource) {
      replacePreview();
      return () => controller.abort();
    }
    if (rawFrameSource.startsWith('data:image/')) {
      replacePreview(rawFrameSource);
      return () => controller.abort();
    }

    void fetch(`/api/electrisim/sessions/${encodeURIComponent(session.id)}/screenshots`, {
      method: 'POST',
      headers: DEMO_JSON_HEADERS,
      body: JSON.stringify({ source: rawFrameSource }),
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error('Screenshot proxy unavailable');
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) throw new Error('Screenshot proxy returned non-image content');
      const objectUrl = URL.createObjectURL(blob);
      if (disposed) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      replacePreview(objectUrl, true);
    }).catch((error: unknown) => {
      if (!disposed && (!(error instanceof DOMException) || error.name !== 'AbortError')) replacePreview();
    });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [rawFrameSource, session?.id]);

  useEffect(() => () => {
    if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current);
  }, []);

  useEffect(() => {
    if (!session?.id) return;
    let disposed = false;
    let timer = 0;
    let controller: AbortController | null = null;
    let terminalSeen = isTerminalElectrisimState(session.state);
    let terminalDrainFailures = 0;

    const poll = async () => {
      controller = new AbortController();
      const encodedId = encodeURIComponent(session.id);
      const fromIndex = changesIndexRef.current;
      const [snapshotResult, changesResult] = await Promise.allSettled([
        fetch(`/api/electrisim/sessions/${encodedId}`, { signal: controller.signal }),
        fetch(`/api/electrisim/sessions/${encodedId}/changes?from_index=${fromIndex}&wait_for_seconds=0`, {
          signal: controller.signal,
        }),
      ]);
      if (disposed) return;

      if (snapshotResult.status === 'fulfilled' && snapshotResult.value.ok) {
        const payload: unknown = await snapshotResult.value.json().catch(() => undefined);
        const next = normalizeElectrisimSession(payload, session.id, session.state);
        if (next) {
          terminalSeen ||= isTerminalElectrisimState(next.state);
          setSession((previous) => previous ? mergeSession(previous, next) : next);
        }
        setSessionError('');
      } else if (snapshotResult.status === 'rejected' && snapshotResult.reason?.name !== 'AbortError') {
        setSessionError('Session status is temporarily unavailable; the H run may still be active.');
      }

      let changesPageResolved = false;
      let receivedNewEvents = false;
      if (changesResult.status === 'fulfilled' && changesResult.value.ok) {
        const payload: unknown = await changesResult.value.json().catch(() => undefined);
        const changes = normalizeElectrisimChanges(payload, fromIndex);
        changesPageResolved = true;
        receivedNewEvents = changes.nextIndex > fromIndex;
        if (changes.state) terminalSeen ||= isTerminalElectrisimState(changes.state);
        changesIndexRef.current = Math.max(changesIndexRef.current, changes.nextIndex);
        if (changes.events.length > 0) {
          setChangesState('live');
          setBrowserEvents((previous) => {
            const seen = new Set(previous.map((event) => event.key));
            const additions = changes.events.filter((event) => !seen.has(event.key));
            return [...previous, ...additions].slice(-24);
          });
          const lastEvent = changes.events[changes.events.length - 1];
          setSession((previous) => previous ? {
            ...previous,
            currentUrl: lastEvent.currentUrl ?? previous.currentUrl,
            screenshotUrl: lastEvent.screenshotUrl ?? previous.screenshotUrl,
            summary: changes.answer ?? previous.summary,
          } : previous);
        } else {
          setChangesState((previous) => previous === 'live' ? previous : 'waiting');
          if (changes.answer) {
            setSession((previous) => previous ? { ...previous, summary: changes.answer } : previous);
          }
        }
      } else if (changesResult.status === 'fulfilled' && changesResult.value.status === 404) {
        changesPageResolved = true;
        setChangesState('unavailable');
      }

      if (terminalSeen && changesPageResolved && !receivedNewEvents) return;
      if (terminalSeen && !changesPageResolved) terminalDrainFailures += 1;
      else terminalDrainFailures = 0;
      if (terminalSeen && terminalDrainFailures >= 3) return;
      if (!disposed) timer = window.setTimeout(poll, terminalSeen ? 250 : 2_500);
    };

    void poll();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, [session?.id, session?.state]);

  const startSession = async () => {
    if (session || controlAction) return;
    setControlAction('start');
    setSessionError('');
    setBrowserEvents([]);
    setChangesState('waiting');
    changesIndexRef.current = 0;
    try {
      const response = await fetch('/api/electrisim/sessions', {
        method: 'POST',
        headers: DEMO_JSON_HEADERS,
        signal: AbortSignal.timeout(60_000),
      });
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(readElectrisimApiError(payload, 'The H browser session could not be started.'));
      const next = normalizeElectrisimSession(payload, undefined, 'starting');
      if (!next) throw new Error('H returned a successful response without a session ID.');
      setSession(next);
    } catch (error) {
      setChangesState('idle');
      setSessionError(error instanceof Error ? error.message : 'The H browser session could not be started.');
    } finally {
      setControlAction(null);
    }
  };

  const stopSession = async () => {
    if (!session || !sessionIsActive || controlAction) return false;
    setControlAction('stop');
    setSessionError('');
    try {
      const response = await fetch(`/api/electrisim/sessions/${encodeURIComponent(session.id)}`, {
        method: 'DELETE',
        headers: DEMO_HEADERS,
        signal: AbortSignal.timeout(30_000),
      });
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(readElectrisimApiError(payload, 'The H browser session could not be stopped.'));
      const next = normalizeElectrisimSession(payload, session.id, 'interrupted');
      if (next) setSession((previous) => previous ? mergeSession(previous, next) : next);
      return true;
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'The H browser session could not be stopped.');
      return false;
    } finally {
      setControlAction(null);
    }
  };

  const resetLab = async () => {
    if (controlAction) return;
    setControlAction('reset');
    setSessionError('');
    try {
      if (session && sessionIsActive) {
        const response = await fetch(`/api/electrisim/sessions/${encodeURIComponent(session.id)}`, {
          method: 'DELETE',
          headers: DEMO_HEADERS,
          signal: AbortSignal.timeout(30_000),
        });
        const payload: unknown = await response.json().catch(() => undefined);
        if (!response.ok) {
          throw new Error(readElectrisimApiError(payload, 'Reset was blocked because the live H session could not be stopped.'));
        }
      }
      setSession(null);
      setBrowserEvents([]);
      setChangesState('idle');
      setCalculation(null);
      setCalculationError('');
      changesIndexRef.current = 0;
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'The lab could not be reset safely.');
    } finally {
      setControlAction(null);
    }
  };

  const runCalculation = async () => {
    if (calculationRunning) return;
    setCalculationRunning(true);
    setCalculationError('');
    try {
      const response = await fetch('/api/electrisim/calculations/cv104', {
        method: 'POST',
        headers: DEMO_JSON_HEADERS,
        signal: AbortSignal.timeout(120_000),
      });
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(readElectrisimApiError(payload, 'The open-source calculation could not run.'));
      const next = normalizeElectrisimCalculation(payload);
      if (!next) throw new Error('The calculation completed but returned an unsupported result shape.');
      setCalculation(next);
    } catch (error) {
      setCalculationError(error instanceof Error ? error.message : 'The open-source calculation could not run.');
    } finally {
      setCalculationRunning(false);
    }
  };

  return (
    <div className="electrisim-lab" data-testid="electrisim-lab">
      <header className="electrisim-header">
        <a href="/" className="electrisim-brand-link" aria-label="Back to ArcFlash Copilot home"><Brand /></a>
        <div className="electrisim-context">
          <span>PUBLIC DRAWING LAB</span>
          <strong>Electrisim</strong>
          <small>Isolated from the ArcFlash study workflow</small>
        </div>
        <a className="electrisim-site-link" href="https://app.electrisim.com/" target="_blank" rel="noreferrer">
          Open public editor <ExternalLink size={13} />
        </a>
      </header>

      <main className="electrisim-main">
        <motion.section
          className="electrisim-intro"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <a href="/" className="electrisim-back"><ArrowLeft size={13} /> Back to ArcFlash</a>
          <div>
            <span>REAL THIRD-PARTY EDITOR · UNSAVED DEMO</span>
            <h1>Electrisim public drawing lab</h1>
            <p>Watch H close the Device dialog, drag Line under Bus and Generator (~) under Source into the editor, and stop without connecting, saving, or simulating.</p>
          </div>
          <div className={`electrisim-state is-${currentStatus.tone}`} data-testid="electrisim-session-state" aria-live="polite">
            <i />
            <span>SESSION STATE</span>
            <strong>{currentStatus.label}</strong>
          </div>
        </motion.section>

        <section className="electrisim-workspace" aria-label="Electrisim browser demonstration controls">
          <aside className="electrisim-safety">
            <div className="electrisim-section-label"><ShieldCheck size={14} /><span>Requested browser scope</span></div>
            <h2>No-login drawing request</h2>
            <p>The server asks H to draw only on a fresh, blank diagram and supplies no credentials or arbitrary user URL. This remains an agent instruction, not a network allowlist inside H's hosted browser.</p>
            <dl>
              <div><dt>Requested edit</dt><dd>Drag Line and Generator right, below Simulate</dd></div>
              <div><dt>Gesture</dt><dd>Press, hold, move onto grid, then release</dd></div>
              <div><dt>Requested exclusions</dt><dd>Simulation, login, payment, upload, save, storage</dd></div>
              <div><dt>Dialog rule</dt><dd>Close Device; do not choose Create or Open</dd></div>
              <div><dt>Stop rule</dt><dd>Stop after both unconnected items are confirmed</dd></div>
            </dl>
            <div className="electrisim-safety-note"><Check size={13} /><span>The independent calculation below never uses values scraped from the website.</span></div>
          </aside>

          <div className="electrisim-browser-panel">
            <div className="electrisim-panel-head">
              <div>
                <span>H HOSTED COMPUTER</span>
                <h2>Browser session</h2>
              </div>
              <div className="electrisim-actions">
                {!session && (
                  <button className="button-primary electrisim-start" onClick={startSession} disabled={Boolean(controlAction)}>
                    {controlAction === 'start' ? <RefreshCw className="is-spinning" size={15} /> : <Play size={15} />}
                    Start public drawing demo
                  </button>
                )}
                {sessionIsActive && (
                  <button className="electrisim-stop" onClick={() => { void stopSession(); }} disabled={Boolean(controlAction)}>
                    <Square size={13} /> Stop session
                  </button>
                )}
                {(session || calculation || sessionError || calculationError) && (
                  <button className="electrisim-reset" onClick={() => { void resetLab(); }} disabled={Boolean(controlAction)}>
                    <RotateCcw size={13} /> Reset lab
                  </button>
                )}
              </div>
            </div>

            <div className="electrisim-browser-frame">
              <div className="electrisim-browser-bar">
                <span><i /><i /><i /></span>
                <div><ShieldCheck size={11} /> {displayUrl(currentUrl)}</div>
                <b>{changesState === 'live' ? 'LIVE EVENTS' : changesState === 'waiting' ? 'WAITING FOR FRAME' : 'H BROWSER'}</b>
              </div>
              <div className={`electrisim-browser-visual${latestFrame?.screenshotUrl || session?.screenshotUrl ? ' has-frame' : ''}`}>
                {previewUrl ? (
                  <motion.img
                    key={previewUrl}
                    src={previewUrl}
                    alt="Latest observation returned by the H hosted browser"
                    referrerPolicy="no-referrer"
                    initial={{ opacity: 0.35 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.25 }}
                  />
                ) : (
                  <div className="electrisim-awaiting-frame">
                    <Eye size={31} />
                    <strong>{session ? 'Waiting for H observation' : 'Browser preview appears after start'}</strong>
                    <span>{session ? 'Agent View remains the authoritative live screen.' : 'No login or subscription is required for this one unsaved edit.'}</span>
                  </div>
                )}
                {session?.agentViewUrl && (
                  <a className="electrisim-agent-view" href={session.agentViewUrl} target="_blank" rel="noreferrer">
                    <Eye size={14} /> Open H Agent View <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>

            <div className="electrisim-session-meta">
              <div><span>SESSION ID</span><strong>{session?.id ?? 'Created only after H accepts the run'}</strong></div>
              <div><span>EVENT STREAM</span><strong>{changesState === 'live' ? `${browserEvents.length} recent events received` : changesState.replace(/_/g, ' ')}</strong></div>
              <div><span>VIEW</span><strong>{session?.agentViewUrl ? 'Agent View available' : session ? 'Waiting for H link' : 'Not available yet'}</strong></div>
            </div>

            {sessionError && <div className="electrisim-error" role="alert"><AlertTriangle size={14} /><span>{sessionError}</span></div>}
          </div>
        </section>

        <section className="electrisim-observability">
          <div className="electrisim-checkpoints" data-testid="electrisim-checkpoints">
            <div className="electrisim-section-label"><Gauge size={14} /><span>Requested checkpoints</span></div>
            <h2>Safe drawing path</h2>
            <p>“Observed” requires matching H evidence. The final Bus confirmation needs an observation or final summary; session completion alone marks nothing.</p>
            <ol>
              {checkpoints.map((checkpoint, index) => {
                const observed = observedCheckpoints[index];
                return (
                  <li key={checkpoint.label} className={observed ? 'is-observed' : ''}>
                    <i>{observed ? <Check size={11} /> : String(index + 1).padStart(2, '0')}</i>
                    <div><strong>{checkpoint.label}</strong><span>{checkpoint.detail}</span></div>
                    <b>{observed ? 'OBSERVED' : session ? 'REQUESTED' : 'QUEUED'}</b>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="electrisim-trajectory">
            <div className="electrisim-section-label"><History size={14} /><span>Live H event feed</span></div>
            <h2>Browser actions</h2>
            <p>Recent observations and browser actions reported by H. Open Agent View for the full trajectory.</p>
            <div className="electrisim-event-list" aria-live="polite">
              <AnimatePresence initial={false}>
                {browserEvents.length > 0 ? browserEvents.slice(-9).reverse().map((event) => (
                  <motion.div
                    key={event.key}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className={`is-${event.kind}`}
                  >
                    <time>{formatTimestamp(event.timestamp)}</time>
                    <i>{event.kind === 'observation' ? <Eye size={11} /> : event.kind === 'action' ? <CircleDot size={11} /> : <Bot size={11} />}</i>
                    <span><strong>{event.label}</strong><small>{event.detail ?? 'Event received from H'}</small></span>
                  </motion.div>
                )) : (
                  <motion.div className="electrisim-event-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <TerminalSquare size={18} />
                    <span><strong>No browser events yet</strong><small>{session ? 'Waiting for H session changes…' : 'Start the public drawing demo to populate this feed.'}</small></span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="electrisim-final-summary">
              <span>FINAL H SUMMARY</span>
              <p>{session?.summary ?? (session && isTerminalElectrisimState(session.state)
                ? 'H returned a terminal state without a text summary. Use Agent View to inspect the recorded trajectory.'
                : 'H has not returned a final summary yet.')}</p>
            </div>
          </div>
        </section>

        <section className="electrisim-calculation" data-testid="electrisim-calculation">
          <div className="electrisim-calculation-head">
            <div>
              <div className="electrisim-section-label"><Zap size={14} /><span>Independent DigitalOcean compute</span></div>
              <h2>Independent open-source calculation</h2>
              <p>Runs the synthetic CV-104 fixture with pandapower and arcflash-calc. This is not an Electrisim result and does not use browser-extracted inputs.</p>
            </div>
            <button className="button-secondary electrisim-calculate" onClick={runCalculation} disabled={calculationRunning}>
              {calculationRunning ? <RefreshCw className="is-spinning" size={15} /> : <TerminalSquare size={15} />}
              {calculationRunning ? 'Running validation…' : 'Run independent CV-104 validation'}
            </button>
          </div>

          {calculationError && <div className="electrisim-error" role="alert"><AlertTriangle size={14} /><span>{calculationError}</span></div>}

          {calculation ? (
            <motion.div className="electrisim-calculation-result" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <div className="electrisim-engine-strip">
                <div><Cloud size={14} /><span>SHORT CIRCUIT</span><strong>{calculation.engines.short_circuit}</strong></div>
                <div><Zap size={14} /><span>ARC FLASH</span><strong>{calculation.engines.arc_flash}</strong></div>
                <div><CheckCircle2 size={14} /><span>STUDY</span><strong>{calculation.study_case}</strong></div>
              </div>
              <div className="electrisim-result-table-wrap">
                <table>
                  <thead><tr><th>Equipment</th><th>Bolted fault</th><th>Arcing current</th><th>Incident energy</th><th>Arc-flash boundary</th><th>Review state</th></tr></thead>
                  <tbody>
                    {calculation.results.map((result) => (
                      <tr key={result.equipment_id} className={result.verification_status === 'engineer_review_required' ? 'has-warning' : ''}>
                        <th>{result.equipment_id}</th>
                        <td>{numberValue(result.pandapower_bolted_fault_ka)} <small>kA</small></td>
                        <td>{numberValue(result.arcflash_validation.arcing_current_ka)} <small>kA</small></td>
                        <td>{numberValue(result.arcflash_validation.incident_energy_cal_cm2, 4)} {result.arcflash_validation.incident_energy_cal_cm2 !== null && <small>cal/cm²</small>}</td>
                        <td>{numberValue(result.arcflash_validation.arc_flash_boundary_in, 2)} {result.arcflash_validation.arc_flash_boundary_in !== null && <small>in</small>}</td>
                        <td><span>{result.verification_status.replace(/_/g, ' ')}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="electrisim-disclaimer"><AlertTriangle size={14} /><span>{calculation.disclaimer}</span></div>
            </motion.div>
          ) : (
            <div className="electrisim-calculation-empty">
              <TerminalSquare size={22} />
              <div><strong>No independent calculation has run</strong><span>The browser demo works separately; running this validation is optional.</span></div>
            </div>
          )}
        </section>
      </main>

      <footer className="electrisim-footer">
        <span><ShieldCheck size={11} /> Fixed unsaved edit · no credentials supplied</span>
        <span><Bot size={11} /> H operates the browser</span>
        <span><Zap size={11} /> DigitalOcean runs independent calculations</span>
      </footer>
    </div>
  );
}

export default ElectrisimLab;
