"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const API = "http://localhost:3000";

type Run = {
  id: string;
  sopId: string;
  status: string;
  currentState: string | null;
  createdAt: string;
  updatedAt: string;
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDur(startIso: string, endIso: string) {
  const secs = Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000
  );
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

const STATUS_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  COMPLETED: { color: "#2dd4a0", bg: "#0a2620", border: "#1a4a38" },
  ACTIVE: { color: "#facc15", bg: "#1a1400", border: "#4a3a00" },
  FAILED: { color: "#ef4444", bg: "#1a0808", border: "#6b2230" },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? { color: "#8890a8", bg: "#1a1e2a", border: "#2a2f3d" };
  return (
    <span
      style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: ".08em",
        padding: "3px 10px",
        borderRadius: 4,
        background: c.bg,
        color: c.color,
        border: `1px solid ${c.border}`,
      }}
    >
      {status}
    </span>
  );
}

export default function ReportsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "COMPLETED" | "ACTIVE" | "FAILED">("ALL");

  const fetchRuns = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/runs`);
      if (!res.ok) throw new Error(`${res.status}`);
      setRuns(await res.json());
    } catch (e: any) {
      setError(`Could not reach backend: ${e.message}`);
    }
    setLoading(false);
  };

  useEffect(() => { fetchRuns(); }, []);

  const filtered = runs.filter((r) => {
    const matchSearch =
      r.sopId.toLowerCase().includes(search.toLowerCase()) ||
      r.id.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "ALL" || r.status === filter;
    return matchSearch && matchFilter;
  });

  const counts = {
    ALL: runs.length,
    COMPLETED: runs.filter((r) => r.status === "COMPLETED").length,
    ACTIVE: runs.filter((r) => r.status === "ACTIVE").length,
    FAILED: runs.filter((r) => r.status === "FAILED").length,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#060810",
        color: "#d4d8e8",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <style>{`
        @keyframes fade-in { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
        .report-row { transition: background .15s; }
        .report-row:hover { background: rgba(255,255,255,0.025) !important; }
        .filter-pill { border-radius: 999px; padding: 5px 16px; font-size: 11px; font-weight: 600; cursor: pointer; border: 1.5px solid; transition: all .15s; font-family: 'IBM Plex Mono', monospace; }
        .action-btn { border-radius: 6px; padding: 5px 12px; font-size: 11px; font-weight: 600; cursor: pointer; transition: all .15s; font-family: 'IBM Plex Mono', monospace; }
      `}</style>

      {/* Top bar */}
      <div
        style={{
          height: 56,
          background: "#07090c",
          borderBottom: "1px solid #1c2130",
          padding: "0 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button
            onClick={() => router.push("/")}
            style={{
              background: "none",
              border: "none",
              color: "#4b5563",
              cursor: "pointer",
              fontSize: 12,
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            ← CANVAS
          </button>
          <span style={{ color: "#2a2f3d" }}>|</span>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              fontWeight: 600,
              color: "#d4d8e8",
              letterSpacing: ".06em",
            }}
          >
            COMPLIANCE REPORTS
          </span>
        </div>

        <button
          onClick={fetchRuns}
          style={{
            background: "none",
            border: "1px solid #2a2f3d",
            color: "#8890a8",
            borderRadius: 6,
            padding: "6px 14px",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          ↻ Refresh
        </button>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px 60px", animation: "fade-in .35s ease" }}>

        {/* Summary Stat Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 28 }}>
          {(["ALL", "COMPLETED", "ACTIVE", "FAILED"] as const).map((key) => {
            const c = STATUS_COLORS[key] ?? { color: "#d4d8e8", bg: "#0e1117", border: "#1c2130" };
            return (
              <div
                key={key}
                style={{
                  background: "#0e1117",
                  border: `1px solid ${filter === key ? c.border : "#1c2130"}`,
                  borderRadius: 10,
                  padding: "18px 20px",
                  cursor: "pointer",
                  transition: "border-color .15s",
                }}
                onClick={() => setFilter(key)}
              >
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 9,
                    color: "#4b5563",
                    textTransform: "uppercase",
                    letterSpacing: ".1em",
                    marginBottom: 8,
                  }}
                >
                  {key === "ALL" ? "Total Runs" : key}
                </div>
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 28,
                    fontWeight: 700,
                    color: key === "ALL" ? "#d4d8e8" : c.color,
                  }}
                >
                  {counts[key]}
                </div>
              </div>
            );
          })}
        </div>

        {/* Filter + Search bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 20,
            flexWrap: "wrap",
          }}
        >
          <input
            type="text"
            placeholder="Search by SOP ID or Run ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1,
              minWidth: 200,
              background: "#0e1117",
              border: "1px solid #1c2130",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              color: "#d4d8e8",
              outline: "none",
              fontFamily: "'DM Sans', sans-serif",
            }}
          />

          {(["ALL", "COMPLETED", "ACTIVE", "FAILED"] as const).map((f) => {
            const c = STATUS_COLORS[f] ?? { color: "#8890a8", bg: "transparent", border: "#2a2f3d" };
            const active = filter === f;
            return (
              <button
                key={f}
                className="filter-pill"
                onClick={() => setFilter(f)}
                style={{
                  background: active ? c.bg : "transparent",
                  color: active ? c.color : "#4b5563",
                  borderColor: active ? c.border : "#2a2f3d",
                }}
              >
                {f} ({counts[f]})
              </button>
            );
          })}
        </div>

        {/* Table */}
        <div
          style={{
            background: "#0e1117",
            border: "1px solid #1c2130",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {/* Table header */}
          <div
            style={{
              background: "#090a0f",
              borderBottom: "1px solid #1c2130",
              padding: "12px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                fontWeight: 600,
                color: "#4b5563",
                textTransform: "uppercase",
                letterSpacing: ".1em",
              }}
            >
              {filtered.length} Run{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>

          {loading ? (
            <div style={{ padding: "40px 24px", color: "#4b5563", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 }}>
              Loading…
            </div>
          ) : error ? (
            <div style={{ padding: "40px 24px", color: "#ef4444", fontSize: 13 }}>{error}</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "48px 24px", color: "#4b5563", fontSize: 13, textAlign: "center" }}>
              No runs found.{" "}
              {search && (
                <button
                  onClick={() => setSearch("")}
                  style={{ background: "none", border: "none", color: "#4da6ff", cursor: "pointer", fontSize: 13 }}
                >
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1c2130" }}>
                  {["SOP Template", "Run ID", "Status", "Started", "Duration", "Actions"].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "10px 16px",
                        textAlign: "left",
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 9,
                        color: "#4b5563",
                        textTransform: "uppercase",
                        letterSpacing: ".08em",
                        fontWeight: 600,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((run, i) => (
                  <tr
                    key={run.id}
                    className="report-row"
                    style={{
                      borderBottom: i < filtered.length - 1 ? "1px solid #1c2130" : "none",
                      background: "transparent",
                    }}
                  >
                    {/* SOP name */}
                    <td style={{ padding: "14px 16px" }}>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#d4d8e8",
                        }}
                      >
                        {run.sopId}
                      </span>
                    </td>

                    {/* Run ID */}
                    <td style={{ padding: "14px 16px" }}>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 10,
                          color: "#565d75",
                        }}
                      >
                        {run.id.slice(0, 8)}…
                      </span>
                    </td>

                    {/* Status */}
                    <td style={{ padding: "14px 16px" }}>
                      <StatusBadge status={run.status} />
                    </td>

                    {/* Started */}
                    <td style={{ padding: "14px 16px" }}>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 10,
                          color: "#8890a8",
                        }}
                      >
                        {fmt(run.createdAt)}
                      </span>
                    </td>

                    {/* Duration */}
                    <td style={{ padding: "14px 16px" }}>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 10,
                          color: "#565d75",
                        }}
                      >
                        {fmtDur(run.createdAt, run.updatedAt)}
                      </span>
                    </td>

                    {/* Actions */}
                    <td style={{ padding: "14px 16px" }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        {run.status === "ACTIVE" && (
                          <button
                            className="action-btn"
                            onClick={() => router.push(`/runs/${run.id}`)}
                            style={{
                              background: "rgba(250,204,21,0.1)",
                              border: "1px solid rgba(250,204,21,0.3)",
                              color: "#facc15",
                            }}
                          >
                            ▶ Dashboard
                          </button>
                        )}

                        {run.status === "COMPLETED" && (
                          <button
                            className="action-btn"
                            onClick={() => router.push(`/runs/${run.id}/report`)}
                            style={{
                              background: "rgba(45,212,160,0.1)",
                              border: "1px solid rgba(45,212,160,0.3)",
                              color: "#2dd4a0",
                            }}
                          >
                            📋 View Report
                          </button>
                        )}

                        <button
                          className="action-btn"
                          onClick={() => router.push(`/runs/${run.id}`)}
                          style={{
                            background: "rgba(77,166,255,0.08)",
                            border: "1px solid rgba(77,166,255,0.25)",
                            color: "#4da6ff",
                          }}
                        >
                          Status
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer note */}
        <div
          style={{
            marginTop: 28,
            textAlign: "center",
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            color: "#2a2f3d",
          }}
        >
          SOP Compliance Engine · Reports Archive · {runs.length} total runs
        </div>
      </div>
    </div>
  );
}
