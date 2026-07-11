export type AppPhase =
  | 'home'
  | 'plan'
  | 'booting'
  | 'running'
  | 'review'
  | 'approved'
  | 'exported';

export type EvidenceStatus =
  | 'verified'
  | 'needs_review'
  | 'accepted'
  | 'deferred'
  | 'rejected'
  | 'recapture_queued';

export type SourceType = 'extracted' | 'generated' | 'engineer';

export interface ProjectFile {
  name: string;
  type: string;
  size: string;
  status: 'ready' | 'warning';
}

export interface EquipmentResult {
  id: string;
  description: string;
  voltage: string;
  role: string;
  boltedFault: number | null;
  arcingCurrent: number | null;
  clearingTime: number | null;
  incidentEnergy: number | null;
  boundary: number | null;
  ppe: string;
}

export interface Evidence extends EquipmentResult {
  evidenceId: string;
  sourceScreen: string;
  screenshot: string;
  capturedAt: string;
  action: string;
  confidence: number;
  status: EvidenceStatus;
  provenance: SourceType;
  engineerNote?: string;
  missingFields?: string[];
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  actor: 'System' | 'Gradium' | 'Planner' | 'NemoClaw' | 'H Computer' | 'Extractor' | 'Report agent' | 'Engineer';
  type: string;
  target?: string;
  detail: string;
}

export interface AutomationStep {
  id: string;
  label: string;
  detail: string;
  actor: AuditEvent['actor'];
  duration: number;
  screen: 'projects' | 'model' | 'settings' | 'results' | 'equipment' | 'report';
  equipmentId?: string;
  evidenceId?: string;
}

export interface ReviewRecord {
  reviewer: string;
  role: string;
  timestamp: string;
  unresolvedCount: number;
  disclaimerAccepted: boolean;
}

export interface HComputerStatus {
  configured: boolean;
  reachable: boolean;
  targetConfigured: boolean;
  region: 'eu' | 'us';
  mode: HComputerMode;
  message: string;
  agent?: string;
  sandbox?: NemoClawStatus;
}

export interface GradiumStatus {
  configured: boolean;
  available: boolean;
  message: string;
  maxAudioBytes?: number;
}

export type HComputerMode = 'sandbox' | 'cloud' | 'demo';

export interface NemoClawStatus {
  available: boolean;
  ready: boolean;
  required: boolean;
  sandboxName: string;
  message: string;
  configured?: boolean;
  enforced?: boolean;
  phase?: string;
  mode?: 'required' | 'preferred' | 'off';
  cliAvailable?: boolean;
  openshellAvailable?: boolean;
  providerAttached?: boolean;
  policyApplied?: boolean;
  workerReady?: boolean;
}

export interface HSessionSnapshot {
  id?: string;
  sessionId?: string;
  status?: string | HSessionState;
  state?: string | HSessionState;
  session?: {
    id?: string;
    status?: string | HSessionState;
    state?: string | HSessionState;
  };
}

export interface HSessionState {
  status?: string | HSessionState;
  state?: string | HSessionState;
}
