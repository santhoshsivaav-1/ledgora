import { Check } from 'lucide-react';
import { FLOW_STAGES, stageIndexFor } from './salesFlow';
import { INVOICE_TYPES } from '../../utils';

// Where this document sits in the sales flow: the stages before it are done, this one is lit, the rest are ahead.
// A proforma sits outside the main line and shows no tracker.
export default function DocFlowTracker({ type, sourceDoc }) {
  const here = stageIndexFor(type);
  if (here < 0) return null;
  return (
    <div className="doc-flow" aria-label="Sales flow">
      <ol>
        {FLOW_STAGES.map((s, i) => (
          <li key={s.type} className={i < here ? 'done' : i === here ? 'here' : ''} aria-current={i === here ? 'step' : undefined}>
            <span className="doc-flow-dot">{i < here ? <Check size={11} /> : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>
      {sourceDoc?.number && (
        <p className="doc-flow-from">Raised from {INVOICE_TYPES[sourceDoc.type]?.label || 'document'} <strong>{sourceDoc.number}</strong></p>
      )}
    </div>
  );
}
