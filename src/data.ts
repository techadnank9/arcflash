import type { AuditEvent, AutomationStep, EquipmentResult, Evidence, ProjectFile } from './types';

export const project = {
  id: 'CV-104',
  name: 'CV-104 Conveyor Electrical Distribution',
  number: 'CV104-AF-2026',
  client: 'West Ridge Processing Plant',
  revision: 'Rev C',
  studyCase: 'Case A — Normal Utility / Main-Tie Open',
  shortCase: 'Study Case A',
  modelStatus: 'Ready',
  reportStatus: 'Not started',
  defaultReviewer: 'A. Patel, P.E.',
};

export const projectFiles: ProjectFile[] = [
  { name: 'CV-104_Model.afp', type: 'Power-system model', size: '2.8 MB', status: 'ready' },
  { name: 'CV-104_One-Line_RevC.pdf', type: 'One-line diagram', size: '1.1 MB', status: 'ready' },
  { name: 'CV-104_Equipment_Register.xlsx', type: 'Equipment register', size: '84 KB', status: 'ready' },
  { name: 'CV-104_Protection_Data.xlsx', type: 'Protection data', size: '62 KB', status: 'warning' },
  { name: 'ArcFlash_Draft_Template.docx', type: 'Report template', size: '360 KB', status: 'ready' },
];

export const equipment: EquipmentResult[] = [
  {
    id: 'U-01', description: 'Utility source', voltage: '13.8 kV', role: 'Source only',
    boltedFault: null, arcingCurrent: null, clearingTime: null, incidentEnergy: null, boundary: null,
    ppe: 'Not evaluated',
  },
  {
    id: 'T-01', description: '1,500 kVA transformer', voltage: '13.8 kV / 480 V', role: 'Model input',
    boltedFault: null, arcingCurrent: null, clearingTime: null, incidentEnergy: null, boundary: null,
    ppe: 'Not evaluated',
  },
  {
    id: 'SWGR-01', description: 'Main switchgear', voltage: '480 V', role: 'Arc-flash result',
    boltedFault: 31.7, arcingCurrent: 26.3, clearingTime: 0.087, incidentEnergy: 6.3, boundary: 55,
    ppe: 'Arc rating ≥ 8 cal/cm²',
  },
  {
    id: 'MCC-01', description: 'Motor-control centre', voltage: '480 V', role: 'Review required',
    boltedFault: 22.4, arcingCurrent: 18.6, clearingTime: null, incidentEnergy: 3.6, boundary: 38,
    ppe: 'Arc rating ≥ 4 cal/cm² · provisional',
  },
  {
    id: 'CV-104', description: '250 hp conveyor motor', voltage: '480 V', role: 'Arc-flash result',
    boltedFault: 11.8, arcingCurrent: 9.7, clearingTime: 0.05, incidentEnergy: 1.2, boundary: 18,
    ppe: 'Arc rating ≥ 4 cal/cm²',
  },
];

const findEquipment = (id: string) => {
  const item = equipment.find((entry) => entry.id === id);
  if (!item) throw new Error(`Unknown equipment ${id}`);
  return item;
};

export const evidenceCatalog: Evidence[] = [
  {
    ...findEquipment('SWGR-01'), evidenceId: 'EV-001',
    sourceScreen: 'Arc Flash Results / SWGR-01',
    screenshot: 'SWGR-01_arcflash_caseA_103023.png', capturedAt: '10:30:23',
    action: 'Read result row and captured equipment detail', confidence: 0.99, status: 'verified', provenance: 'extracted',
  },
  {
    ...findEquipment('MCC-01'), evidenceId: 'EV-002',
    sourceScreen: 'Arc Flash Results / MCC-01',
    screenshot: 'MCC-01_arcflash_caseA_103027.png', capturedAt: '10:30:27',
    action: 'Captured visible values; created missing-data exception', confidence: 0.73,
    status: 'needs_review', provenance: 'extracted', missingFields: ['protectiveDeviceClearingTime'],
  },
  {
    ...findEquipment('CV-104'), evidenceId: 'EV-003',
    sourceScreen: 'Arc Flash Results / CV-104',
    screenshot: 'CV-104_arcflash_caseA_103031.png', capturedAt: '10:30:31',
    action: 'Read result row and captured equipment detail', confidence: 0.98, status: 'verified', provenance: 'extracted',
  },
];

export const automationSteps: AutomationStep[] = [
  { id: 'session', label: 'Start isolated workspace', detail: 'Apply application and file allowlist', actor: 'NemoClaw', duration: 1050, screen: 'projects' },
  { id: 'launch', label: 'Open study application', detail: 'Launch OpenGrid Study Workbench', actor: 'H Computer', duration: 950, screen: 'projects' },
  { id: 'project', label: 'Load CV-104 project', detail: 'Open model revision C', actor: 'H Computer', duration: 1200, screen: 'model' },
  { id: 'case', label: 'Verify Study Case A', detail: 'Normal utility · main-tie open', actor: 'H Computer', duration: 1100, screen: 'settings' },
  { id: 'module', label: 'Open arc-flash results', detail: 'IEEE 1584-2018 · 480 V', actor: 'H Computer', duration: 1050, screen: 'results' },
  { id: 'capture-swgr', label: 'Capture SWGR-01', detail: 'Incident energy 6.3 cal/cm²', actor: 'Extractor', duration: 1250, screen: 'equipment', equipmentId: 'SWGR-01', evidenceId: 'EV-001' },
  { id: 'capture-mcc', label: 'Capture MCC-01', detail: 'Missing clearing time detected', actor: 'Extractor', duration: 1350, screen: 'equipment', equipmentId: 'MCC-01', evidenceId: 'EV-002' },
  { id: 'capture-motor', label: 'Capture CV-104', detail: 'Incident energy 1.2 cal/cm²', actor: 'Extractor', duration: 1250, screen: 'equipment', equipmentId: 'CV-104', evidenceId: 'EV-003' },
  { id: 'draft', label: 'Assemble report draft', detail: 'Attach evidence and surface exceptions', actor: 'Report agent', duration: 1500, screen: 'report' },
];

export const seedAudit: AuditEvent[] = [
  { id: 'AU-001', timestamp: '10:30:00', actor: 'System', type: 'SESSION_CREATED', detail: 'ArcFlash Copilot session created' },
  { id: 'AU-002', timestamp: '10:30:03', actor: 'Gradium', type: 'VOICE_TRANSCRIBED', detail: '“Generate the draft arc-flash report for CV-104 using Study Case A.”' },
  { id: 'AU-003', timestamp: '10:30:04', actor: 'Planner', type: 'PROJECT_RESOLVED', target: 'CV-104', detail: 'Revision C and Study Case A resolved' },
  { id: 'AU-004', timestamp: '10:30:05', actor: 'Planner', type: 'TASK_PLAN_CREATED', detail: '9-step evidence collection plan created' },
];

export const studyAssumptions = [
  ['Method', 'IEEE 1584-2018'],
  ['Configuration', 'Normal utility · main closed · main-tie open'],
  ['System voltage', '480 V'],
  ['Working distance', '18 in'],
  ['Clearing-time cap', '2.0 s'],
  ['Transformer tap', 'Nominal'],
  ['Motor contribution', 'Operating'],
];

export const commandText = 'Generate the draft arc-flash report for CV-104 using Study Case A.';

export const exceptionText = 'Breaker clearing time is not available for MCC-01. The incident-energy result was extracted, but its calculation basis requires engineer verification.';

export const openSourceStack = [
  { name: 'pandapower', purpose: 'IEC 60909 short-circuit study', license: 'BSD-3-Clause' },
  { name: 'OpenDSS', purpose: 'Distribution-system validation', license: 'BSD-style' },
  { name: 'arcflash', purpose: 'IEEE 1584 calculation adapter', license: 'MIT' },
];
