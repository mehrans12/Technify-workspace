import { Button } from 'react-bootstrap';
import { PlaySquare, CheckCircle, XCircle, Clock, Cpu, AlertTriangle } from 'lucide-react';

export default function PreviewPane({ output, onClear }) {
  const { stdout, stderr, compile_output, status, time, memory, isRunning } = output;

  function getStatusIcon() {
    if (isRunning) return <Clock size={13} className="text-warning me-1" />;
    if (!status) return null;
    if (status.description === 'Accepted') return <CheckCircle size={13} className="text-success me-1" />;
    return <XCircle size={13} className="text-danger me-1" />;
  }

  function getStatusColor() {
    if (!status) return 'text-muted';
    if (status.description === 'Accepted') return 'text-success';
    return 'text-danger';
  }

  // Formats multiline console outputs and prepends a prompt marker `>` to each line
  function formatConsoleLines(text, colorClass = 'theme-text-primary') {
    if (!text) return null;
    const lines = text.split('\n');
    // If the last line is empty, remove it to prevent trailing empty prompts
    if (lines.length > 1 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    return lines.map((line, index) => (
      <div key={index} className={`${colorClass} mb-1`} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        <span className="text-muted me-2" style={{ userSelect: 'none' }}>&gt;</span>
        {line}
      </div>
    ));
  }

  return (
    <div className="h-100 d-flex flex-column" style={{ backgroundColor: 'var(--bg-card)' }}>
      {/* Pane Header */}
      <div className="workspace-pane-header px-3">
        <div className="workspace-pane-title">
          <span style={{ fontSize: '18px' }}>💻</span>
          <span>Live Results / Output</span>
        </div>
        
        <div className="d-flex align-items-center gap-2">
          {status && (
            <span className={`d-flex align-items-center ${getStatusColor()} me-2`} style={{ fontSize: '12px', fontWeight: '600' }}>
              {getStatusIcon()}
              {isRunning ? 'Running...' : status.description}
            </span>
          )}
          
          <Button 
            onClick={onClear}
            className="custom-outline-button py-1"
            style={{ fontSize: '11px', height: '28px' }}
          >
            Clear Console
          </Button>
        </div>
      </div>

      {/* Terminal Area */}
      <div className="flex-grow-1 p-3 overflow-auto font-monospace small scrollbar-custom" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: '6px', margin: '8px' }}>
        {isRunning ? (
          <div className="text-warning mb-1">
            <span className="text-muted me-2" style={{ userSelect: 'none' }}>&gt;</span>
            Executing code... Please wait.
          </div>
        ) : !status ? (
          <div>
            <div className="mb-1" style={{ color: 'var(--text-secondary)' }}>
              <span className="text-muted me-2" style={{ userSelect: 'none' }}>&gt;</span>
              Technify Engine initialized successfully...
            </div>
          </div>
        ) : (
          <div>
            {/* Compilation Errors */}
            {compile_output && (
              <div className="mb-3">
                <div className="text-danger fw-bold mb-1 d-flex align-items-center" style={{ userSelect: 'none' }}>
                  <AlertTriangle size={13} className="me-1" /> Compilation Error
                </div>
                {formatConsoleLines(compile_output, 'text-danger')}
              </div>
            )}

            {/* Standard Error */}
            {stderr && (
              <div className="mb-3">
                <div className="text-danger fw-bold mb-1 d-flex align-items-center" style={{ userSelect: 'none' }}>
                  <XCircle size={13} className="me-1" /> stderr
                </div>
                {formatConsoleLines(stderr, 'text-danger')}
              </div>
            )}

            {/* Standard Output (Bright Green) */}
            {stdout && (
              <div className="mb-2">
                {formatConsoleLines(stdout, 'text-success')}
              </div>
            )}

            {/* No Output Case */}
            {!stdout && !stderr && !compile_output && (
              <div className="text-muted">
                <span className="text-muted me-2" style={{ userSelect: 'none' }}>&gt;</span>
                Program finished with no output.
              </div>
            )}

            {/* Execution Telemetry Stats */}
            {(time || memory) && (
              <div className="mt-3 pt-2 d-flex gap-3" style={{ borderTop: '1px solid #1f242c', userSelect: 'none' }}>
                {time && (
                  <span className="text-muted d-flex align-items-center" style={{ fontSize: '11px' }}>
                    <Clock size={11} className="me-1" /> {time}s
                  </span>
                )}
                {memory && (
                  <span className="text-muted d-flex align-items-center" style={{ fontSize: '11px' }}>
                    <Cpu size={11} className="me-1" /> {(memory / 1024).toFixed(1)} MB
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
