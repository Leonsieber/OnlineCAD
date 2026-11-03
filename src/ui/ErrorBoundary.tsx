// Last line of defence: if the interface crashes, offer to save the open document before reloading,
// so a bug never costs anyone their work.
import { Component, type ReactNode } from 'react';
import { useStore } from '../store/store';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('OnlineCAD crashed', error);
  }

  private download = () => {
    const { doc } = useStore.getState();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(doc)], { type: 'application/json' }));
    a.download = `${doc.name || 'model'}.ocad`;
    a.click();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-card">
          <h1>Something went wrong</h1>
          <p>OnlineCAD hit an unexpected error. Your work is autosaved in this browser, and you can also download the open document before reloading.</p>
          <pre>{this.state.error.message}</pre>
          <div className="crash-actions">
            <button className="btn" onClick={this.download}>
              Download document (.ocad)
            </button>
            <button className="btn primary" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
