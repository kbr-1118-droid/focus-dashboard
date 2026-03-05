import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "2rem",
          color: "#fff",
          backgroundColor: "#1a1a2e",
          minHeight: "100vh",
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center"
        }}>
          <h1 style={{ fontSize: "2rem", marginBottom: "1rem", color: "#ff6b6b" }}>
            앗! 오류가 발생했습니다.
          </h1>
          <p style={{ marginBottom: "2rem", color: "#b8b8d8" }}>
            앱을 실행하는 도중 문제가 생겼습니다.<br />
            잠시 후 다시 시도하거나, 관리자에게 문의해주세요.
          </p>
          
          <div style={{
            textAlign: "left",
            backgroundColor: "#0d0d18",
            padding: "1rem",
            borderRadius: "8px",
            maxWidth: "600px",
            width: "100%",
            overflow: "auto",
            border: "1px solid #2e2e48"
          }}>
            <p style={{ color: "#ff6b6b", fontWeight: "bold", marginBottom: "0.5rem" }}>
              Error Message:
            </p>
            <pre style={{ margin: 0, color: "#e0e0e0", fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>
              {this.state.error?.toString()}
            </pre>
            {this.state.errorInfo && (
              <>
                <p style={{ color: "#ff6b6b", fontWeight: "bold", marginTop: "1rem", marginBottom: "0.5rem" }}>
                  Component Stack:
                </p>
                <pre style={{ margin: 0, color: "#8080aa", fontSize: "0.8rem", whiteSpace: "pre-wrap" }}>
                  {this.state.errorInfo.componentStack}
                </pre>
              </>
            )}
          </div>

          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: "2rem",
              padding: "0.8rem 1.5rem",
              fontSize: "1rem",
              backgroundColor: "#5cc8f5",
              color: "#0d0d18",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: "bold"
            }}
          >
            페이지 새로고침
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
