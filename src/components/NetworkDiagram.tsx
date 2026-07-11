import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';

interface NetworkDiagramProps {
  activeId?: string;
  compact?: boolean;
  onSelect?: (id: string) => void;
}

const nodes = [
  { id: 'U-01', label: 'Utility', detail: '13.8 kV', x: 66, shape: 'source' },
  { id: 'T-01', label: 'Transformer', detail: '1,500 kVA', x: 220, shape: 'transformer' },
  { id: 'SWGR-01', label: 'Switchgear', detail: '480 V', x: 382, shape: 'bus' },
  { id: 'MCC-01', label: 'MCC', detail: '480 V', x: 544, shape: 'bus' },
  { id: 'CV-104', label: 'Conveyor', detail: '250 hp', x: 704, shape: 'motor' },
];

export function NetworkDiagram({ activeId, compact = false, onSelect }: NetworkDiagramProps) {
  return (
    <div className={`network-diagram${compact ? ' is-compact' : ''}`}>
      <div className="diagram-grid" aria-hidden="true" />
      <svg viewBox="0 0 770 230" role="img" aria-label="CV-104 electrical one-line diagram">
        <defs>
          <filter id="amber-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <line className="diagram-conductor" x1="66" y1="104" x2="704" y2="104" />
        <motion.line
          className="diagram-energy"
          x1="66" y1="104" x2="704" y2="104"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: 'easeOut' }}
        />
        {nodes.map((node) => {
          const active = node.id === activeId;
          return (
            <g
              key={node.id}
              className={`diagram-node${active ? ' is-active' : ''}`}
              transform={`translate(${node.x} 104)`}
              onClick={() => onSelect?.(node.id)}
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect ? 0 : undefined}
              onKeyDown={(event) => {
                if (onSelect && (event.key === 'Enter' || event.key === ' ')) onSelect(node.id);
              }}
            >
              {active && <circle className="node-glow" r="28" filter="url(#amber-glow)" />}
              {node.shape === 'source' && (
                <>
                  <circle className="node-body" r="19" />
                  <path className="node-symbol" d="M-11 0 C-6 -13, 6 13, 11 0" />
                </>
              )}
              {node.shape === 'transformer' && (
                <>
                  <circle className="node-body" cx="-8" r="15" />
                  <circle className="node-body" cx="8" r="15" />
                </>
              )}
              {node.shape === 'bus' && (
                <>
                  <rect className="node-body" x="-24" y="-17" width="48" height="34" rx="2" />
                  <line className="node-symbol" x1="-16" y1="-7" x2="16" y2="-7" />
                  <line className="node-symbol" x1="-16" y1="1" x2="16" y2="1" />
                  <line className="node-symbol" x1="-16" y1="9" x2="8" y2="9" />
                </>
              )}
              {node.shape === 'motor' && (
                <>
                  <circle className="node-body" r="20" />
                  <text className="motor-symbol" textAnchor="middle" y="6">M</text>
                </>
              )}
              <text className="node-id" textAnchor="middle" y="48">{node.id}</text>
              <text className="node-label" textAnchor="middle" y="66">{node.label}</text>
              <text className="node-detail" textAnchor="middle" y="81">{node.detail}</text>
            </g>
          );
        })}
      </svg>
      {!compact && (
        <div className="diagram-legend">
          <span><Zap size={12} /> Normal utility · main closed</span>
          <span>IEEE 1584-2018</span>
          <span>60 Hz</span>
        </div>
      )}
    </div>
  );
}
