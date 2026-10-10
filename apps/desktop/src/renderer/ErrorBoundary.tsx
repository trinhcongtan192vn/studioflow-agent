import { Component, type ReactNode } from 'react';

/**
 * Lỗi giao diện trong một khu (tab) chỉ làm hỏng khu đó, không làm trắng cả cửa sổ (2026-10-10: bấm ảnh ở tab
 * Xem trước → trang trắng). Hiện lỗi + nút thử lại; đổi `resetKey` (video, tab) cũng dựng lại khu.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string; label?: string },
  { error?: Error; key?: string }
> {
  state: { error?: Error; key?: string } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(
    p: { resetKey?: string },
    s: { error?: Error; key?: string },
  ): { error?: Error; key?: string } | null {
    return p.resetKey !== s.key ? { error: undefined, key: p.resetKey } : null;
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-box" role="alert" data-testid="error-boundary">
        <p className="error">
          {this.props.label ?? 'Khu này'} gặp lỗi: {this.state.error.message}
        </p>
        <button onClick={() => this.setState({ error: undefined })}>Thử lại</button>
      </div>
    );
  }
}
