import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { getRuntimeConfig } from './runtime/runtimeConfig';
import { applyTheme, readStoredTheme } from './theme/applyTheme';
import './theme/themes.css';
import './components/ui/theme-picker.css';
import './components/ui/markdown.css';
import './features/messages/messages.css';
import './features/organization/organization.css';
import './features/projects/project-board.css';
import './features/settings/settings.css';
import '@xyflow/react/dist/style.css';
import './features/workflows/workflows.css';
import './index.css';

applyTheme(readStoredTheme());

// 顶层 Error Boundary — 抓 React render 时的 throw,显示具体错误
class TopErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[TopErrorBoundary]', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, padding: 24,
          background: '#FAFAF9', color: '#0C0A09',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          fontSize: 12, overflow: 'auto',
        }}>
          <div style={{ color: '#B91C1C', fontWeight: 600, marginBottom: 8 }}>
            ⚠ React 渲染错误
          </div>
          <div style={{ marginBottom: 12, fontSize: 14, fontWeight: 600 }}>
            {this.state.error.message}
          </div>
          <pre style={{
            background: '#F5F5F4', padding: 12, borderRadius: 6,
            whiteSpace: 'pre-wrap', fontSize: 11, color: '#44403C',
          }}>
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

async function renderApp(): Promise<void> {
  await getRuntimeConfig();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <TopErrorBoundary>
        <App />
      </TopErrorBoundary>
    </React.StrictMode>,
  );
}

void renderApp();
