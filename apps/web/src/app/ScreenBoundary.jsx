import { Component } from 'react';
import { ErrorState } from '../components/ui/States';

/**
 * Catches a screen that fails to draw (change 3.24) and shows the error state, with a way back, instead of a blank
 * page. Reset it by changing `resetKey` (the current address), so moving to another screen clears the error.
 */
export default class ScreenBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  componentDidCatch(error) {
    console.error('[screen]', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ErrorState
        title="This screen could not be shown"
        message={String(this.state.error?.message || '').slice(0, 200)}
        onRetry={() => this.setState({ error: null })}
      />
    );
  }
}
