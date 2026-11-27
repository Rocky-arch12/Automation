import { useEffect } from 'react';
import { Code } from 'lucide-react';
import { useAlphaSignal } from '../../context/AlphaSignalContext';

export function JsonInspectorModal() {
  const { selectedJsonData, closeJsonInspector } = useAlphaSignal();

  useEffect(() => {
    if (!selectedJsonData) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeJsonInspector();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedJsonData, closeJsonInspector]);

  if (!selectedJsonData) return null;

  return (
    <div
      className="modal-overlay"
      id="json-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="json-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeJsonInspector();
      }}
    >
      <div className="modal-content modal-content-lg">
        <div className="modal-header">
          <div className="modal-title" id="json-modal-title">
            <Code size={18} style={{ color: 'var(--info-text)' }} />
            Raw AI Intent &amp; Extraction Payload
          </div>
          <button
            type="button"
            className="close-btn"
            onClick={closeJsonInspector}
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        <div className="modal-body">
          <pre className="code-json" id="json-viewer">
            {JSON.stringify(selectedJsonData, null, 2)}
          </pre>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={closeJsonInspector}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
