"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NodeData {
  id: string;
  title: string;
  type: "VERIFICATION" | "MEASUREMENT";
  config: {
    expectedEntity: string;
    targetValue: number;
    tolerance: number;
  };
  x: number;
  y: number;
  isAiGenerated?: boolean; // For conditional crimson red styling
  isManuallyConfirmed?: boolean; // For human verification checkmarks
}

interface Edge {
  from: string;
  to: string;
  condition?: "DEFAULT" | "RESOLVE" | "RETRY" | "REJECT" | string; // ◄ Add condition labels
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_WIDTH = 280;
// Actual rendered node height: header (~40px) + body (~38px) = ~78px; ports extend 6px outside
const NODE_HEIGHT = 78;

// ─── Utility ──────────────────────────────────────────────────────────────────

let _idCounter = 0;
function uid() {
  return `step_${Date.now()}_${_idCounter++}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface WorkflowNodeProps {
  node: NodeData;
  index: number;
  isSelected: boolean;
  isConnectingFrom: boolean;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onPortMouseDown: (e: React.MouseEvent, id: string, dir: "in" | "out") => void;
  onClick: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
}

function WorkflowNode({
  node,
  index,
  isSelected,
  onMouseDown,
  onPortMouseDown,
  onClick,
  onContextMenu,
}: WorkflowNodeProps) {
  const isV = node.type === "VERIFICATION";

  return (
    <div
      data-nodeid={node.id}
      style={{
        position: "absolute",
        left: node.x,
        top: node.y,
        width: NODE_WIDTH,
        cursor: "grab",
        userSelect: "none",
      }}
      onMouseDown={(e) => onMouseDown(e, node.id)}
      onClick={(e) => {
        e.stopPropagation();
        onClick(node.id);
      }}
      onContextMenu={(e) => onContextMenu(e, node.id)}
    >
      {/* Top port (in) */}
      <div
        data-port="in"
        data-nodeid={node.id}
        onMouseDown={(e) => {
          e.stopPropagation();
          onPortMouseDown(e, node.id, "in");
        }}
        style={{
          position: "absolute",
          top: -6,
          left: "50%",
          transform: "translateX(-50%)",
          width: 12,
          height: 12,
          borderRadius: "50%",
          border: `2px solid ${isSelected ? "#f5a623" : "#3a4055"}`,
          background: isSelected ? "#f5a623" : "#1a1e2a",
          cursor: "crosshair",
          zIndex: 10,
          transition: "border-color .1s, background .1s",
        }}
      />

      {/* Node card */}
      <div
        style={{
          background: node.isAiGenerated
            ? node.isManuallyConfirmed
              ? "#1c1216"
              : "#2a1418" // Crimson Red variations if AI
            : "#1a1e2a", // Standard dark blue
          border: `1.5px solid ${
            isSelected
              ? "#f5a623"
              : node.isAiGenerated && !node.isManuallyConfirmed
                ? "#f87171" // Bright red outline for unconfirmed AI nodes
                : "#2a2f3d"
          }`,
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: isSelected
            ? "0 0 0 1px #f5a623, 0 8px 32px rgba(245,166,35,.15)"
            : "0 4px 16px rgba(0,0,0,.4)",
          transition:
            "border-color .15s, box-shadow .15s, background-color .15s",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px 8px",
            borderBottom: "1px solid #222638",
            position: "relative",
          }}
        >
          {node.isManuallyConfirmed && (
            <span
              style={{
                color: "#10b981",
                fontWeight: "bold",
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              ✓
            </span>
          )}
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 9,
              fontWeight: 500,
              letterSpacing: ".08em",
              padding: "2px 6px",
              borderRadius: 4,
              textTransform: "uppercase",
              background: isV ? "#0a2620" : "#0a1830",
              color: isV ? "#2dd4a0" : "#4da6ff",
              border: `1px solid ${isV ? "#1a4a38" : "#1a3060"}`,
              flexShrink: 0,
            }}
          >
            {isV ? "Verify" : "Measure"}
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#d4d8e8",
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {node.title}
          </span>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 9,
              color:
                node.isAiGenerated && !node.isManuallyConfirmed
                  ? "#f87171"
                  : "#565d75",
              flexShrink: 0,
            }}
          >
            {node.isAiGenerated && !node.isManuallyConfirmed
              ? "AI"
              : `#${index + 1}`}
          </span>
        </div>

        {/* Body */}
        <div style={{ padding: "10px 12px" }}>
          {isV ? (
            node.config.expectedEntity ? (
              <div style={{ fontSize: 11, color: "#8890a8", lineHeight: 1.5 }}>
                Label:{" "}
                <span style={{ color: "#d4d8e8", fontWeight: 500 }}>
                  {node.config.expectedEntity}
                </span>
              </div>
            ) : (
              <div
                style={{
                  fontSize: 11,
                  color: "#3a4055",
                  fontStyle: "italic",
                  lineHeight: 1.5,
                }}
              >
                No label set
              </div>
            )
          ) : (
            <div style={{ fontSize: 11, color: "#8890a8", lineHeight: 1.5 }}>
              Target:{" "}
              <span style={{ color: "#d4d8e8", fontWeight: 500 }}>
                {node.config.targetValue}mg
              </span>{" "}
              ±{" "}
              <span style={{ color: "#d4d8e8", fontWeight: 500 }}>
                {node.config.tolerance}mg
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom port (out) */}
      <div
        data-port="out"
        data-nodeid={node.id}
        onMouseDown={(e) => {
          e.stopPropagation();
          onPortMouseDown(e, node.id, "out");
        }}
        style={{
          position: "absolute",
          bottom: -6,
          left: "50%",
          transform: "translateX(-50%)",
          width: 12,
          height: 12,
          borderRadius: "50%",
          border: `2px solid ${isSelected ? "#f5a623" : "#3a4055"}`,
          background: isSelected ? "#f5a623" : "#1a1e2a",
          cursor: "crosshair",
          zIndex: 10,
          transition: "border-color .1s, background .1s",
        }}
      />
    </div>
  );
}

// ─── SVG Edges ────────────────────────────────────────────────────────────────

interface EdgesLayerProps {
  nodes: NodeData[];
  edges: Edge[];
  selectedId: string | null;
  connectingFrom: string | null;
  mousePos: { x: number; y: number } | null;
  canvasSize: { width: number; height: number };
}

function EdgesLayer({
  nodes,
  edges,
  selectedId,
  connectingFrom,
  mousePos,
  canvasSize,
}: EdgesLayerProps) {
  const getPortPos = (nodeId: string, port: "in" | "out") => {
    const n = nodes.find((n) => n.id === nodeId);
    if (!n) return { x: 0, y: 0 };
    return {
      x: n.x + NODE_WIDTH / 2,
      y: port === "out" ? n.y + NODE_HEIGHT : n.y,
    };
  };

  const makeCubic = (x1: number, y1: number, x2: number, y2: number) => {
    const dy = y2 - y1;
    const dx = x2 - x1;
    const baseCp = Math.min(Math.abs(dy) * 0.5, 80);

    if (dy < -20) {
      const loopDirection = dx >= 0 ? 120 : -120;
      return `M${x1},${y1} C${x1 + loopDirection},${y1 + 60} ${x2 + loopDirection},${y2 - 60} ${x2},${y2}`;
    }
    return `M${x1},${y1} C${x1},${y1 + baseCp} ${x2},${y2 - baseCp} ${x2},${y2}`;
  };

  return (
    <svg
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
        overflow: "visible",
      }}
      width={canvasSize.width}
      height={canvasSize.height}
    >
      {/* Keeping your existing <defs> markers untouched... */}

      {edges.map((e) => {
        const from = getPortPos(e.from, "out");
        const to = getPortPos(e.to, "in");
        const isHL = selectedId === e.from || selectedId === e.to;

        // Calculate the exact midpoints of the path to draw text labels
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;

        return (
          <g key={`${e.from}-${e.to}`}>
            {/* The Bezier path */}
            <path
              d={makeCubic(from.x, from.y, to.x, to.y)}
              fill="none"
              stroke={
                e.condition === "REJECT"
                  ? "#f87171"
                  : e.condition === "RESOLVE"
                    ? "#2dd4a0"
                    : isHL
                      ? "#f5a623"
                      : "#2a2f3d"
              }
              strokeWidth={isHL ? 2 : 1.5}
              markerEnd={isHL ? "url(#arr-selected)" : "url(#arr-default)"}
            />

            {/* Conditional Text Badge pill inside SVG space */}
            {e.condition && e.condition !== "DEFAULT" && (
              <g
                transform={`translate(${midX}, ${midY - 10})`}
                style={{ pointerEvents: "auto", cursor: "pointer" }}
              >
                <rect
                  x="-32"
                  y="-8"
                  width="64"
                  height="16"
                  rx="4"
                  fill="#11131a"
                  stroke={
                    e.condition === "REJECT"
                      ? "#ef4444"
                      : e.condition === "RESOLVE"
                        ? "#10b981"
                        : "#3b82f6"
                  }
                  strokeWidth="1"
                />
                <text
                  textAnchor="middle"
                  y="3"
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "8px",
                    fontWeight: 600,
                    fill:
                      e.condition === "REJECT"
                        ? "#f87171"
                        : e.condition === "RESOLVE"
                          ? "#2dd4a0"
                          : "#60a5fa",
                    textTransform: "uppercase",
                  }}
                >
                  {e.condition}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
interface SidebarProps {
  node: NodeData | undefined;
  allNodes: NodeData[];
  edges: Edge[];
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  onUpdateTitle: (id: string, val: string) => void;
  onUpdateConfig: (
    id: string,
    key: keyof NodeData["config"],
    val: string | number,
  ) => void;
  onUpdateStatus: (
    id: string,
    field: "isManuallyConfirmed",
    val: boolean,
  ) => void;
  onUpdateSequenceCsv: (
    nodeId: string,
    type: "prev" | "next",
    csvValue: string,
  ) => void;
  onInjectAiNodes: (rawText: string) => void;
  onAddManualNode: (type: "VERIFICATION" | "MEASUREMENT") => void;
  onSaveAndValidate: () => void;
}

function Sidebar({
  node,
  allNodes,
  edges,
  setEdges,
  onUpdateTitle,
  onUpdateConfig,
  onUpdateStatus,
  onUpdateSequenceCsv,
  onInjectAiNodes,
  onAddManualNode,
  onSaveAndValidate,
}: SidebarProps) {
  const [aiInput, setAiInput] = useState("");
  const [localPrev, setLocalPrev] = useState("");
  const [localNext, setLocalNext] = useState("");

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "#161922",
    border: "1px solid #242936",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 12,
    color: "#d4d8e8",
    fontFamily: "'DM Sans', sans-serif",
    outline: "none",
    transition: "border-color .15s",
  };
  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 10,
    color: "#6b7280",
    fontWeight: 600,
    marginBottom: 5,
    letterSpacing: ".05em",
    textTransform: "uppercase",
  };
  const sectionStyle: React.CSSProperties = {
    padding: "12px 16px",
    borderBottom: "1px solid #1a1d26",
  };
  const actionBtnStyle: React.CSSProperties = {
    flex: 1,
    padding: "8px 0",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    border: "1px solid #242936",
    background: "#161922",
    color: "#9ca3af",
    transition: "all .15s ease",
  };

  // 2. Compute edge conversions
  const incomingIds = edges.filter((e) => e.to === node?.id).map((e) => e.from);
  const outgoingIds = edges.filter((e) => e.from === node?.id).map((e) => e.to);

  const prevCsv = incomingIds
    .map((id) => {
      const idx = allNodes.findIndex((n) => n.id === id);
      return idx !== -1 ? idx + 1 : id;
    })
    .join(", ");

  const nextCsv = outgoingIds
    .map((id) => {
      const idx = allNodes.findIndex((n) => n.id === id);
      return idx !== -1 ? idx + 1 : id;
    })
    .join(", ");

  // 3. Sync local text buffers exclusively when the active node target switches
  useEffect(() => {
    setLocalPrev(prevCsv);
    setLocalNext(nextCsv);
  }, [node?.id]); // ◄ Crucial boundary: ignores state typing mutations

  return (
    <div
      style={{
        width: 292, // ◄ Expanded Width
        background: "#0d0f14",
        borderLeft: "1px solid #1a1d26",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* Dynamic Action Toolbar */}
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid #1a1d26",
          background: "#090a0f",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "#4b5563",
            letterSpacing: ".05em",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Canvas Controls
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button
            style={actionBtnStyle}
            onClick={() => onAddManualNode("VERIFICATION")}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#2dd4a0";
              e.currentTarget.style.borderColor = "#134e3a";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "#9ca3af";
              e.currentTarget.style.borderColor = "#242936";
            }}
          >
            + Verify Step
          </button>
          <button
            style={actionBtnStyle}
            onClick={() => onAddManualNode("MEASUREMENT")}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#4da6ff";
              e.currentTarget.style.borderColor = "#1e3a8a";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "#9ca3af";
              e.currentTarget.style.borderColor = "#242936";
            }}
          >
            + Measure Step
          </button>
        </div>
        <button
          onClick={onSaveAndValidate}
          style={{
            width: "100%",
            background: "#2563eb",
            color: "#ffffff",
            border: "none",
            padding: "8px 0",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(37,99,235,0.2)",
          }}
        >
          Validate &amp; Save Configuration
        </button>
      </div>

      {/* Workspace Header */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #1a1d26",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#090a0f",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "#9ca3af" }}>
          Properties Panel
        </span>
        {node && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 9,
              color: node.type === "VERIFICATION" ? "#2dd4a0" : "#4da6ff",
              background: node.type === "VERIFICATION" ? "#0a2620" : "#0a1830",
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            {node.type}
          </span>
        )}
      </div>

      {/* Main Configuration Content Panel */}
      {node ? (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {/* AI Confirmation Status Checkbox Toggle */}
          {node.isAiGenerated && (
            <div
              style={{
                ...sectionStyle,
                background: node.isManuallyConfirmed
                  ? "transparent"
                  : "#1c0d10",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <input
                type="checkbox"
                id="confirm-ai"
                checked={!!node.isManuallyConfirmed}
                onChange={(e) =>
                  onUpdateStatus(
                    node.id,
                    "isManuallyConfirmed",
                    e.target.checked,
                  )
                }
                style={{ cursor: "pointer", width: 14, height: 14 }}
              />
              <label
                htmlFor="confirm-ai"
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: node.isManuallyConfirmed ? "#9ca3af" : "#ef4444",
                  cursor: "pointer",
                }}
              >
                {node.isManuallyConfirmed
                  ? "Layout Verified"
                  : "Awaiting Manual Validation"}
              </label>
            </div>
          )}

          <div style={sectionStyle}>
            <label style={labelStyle}>Preceding Step Indices</label>
            <input
              style={inputStyle}
              type="text"
              placeholder="e.g. 1, 2"
              value={localPrev}
              onChange={(e) => {
                setLocalPrev(e.target.value);
                onUpdateSequenceCsv(node.id, "prev", e.target.value);
              }}
            />
          </div>

          <div style={sectionStyle}>
            <label style={labelStyle}>Succeeding Step Indices</label>
            <input
              style={inputStyle}
              type="text"
              placeholder="e.g. 3, 4"
              value={localNext}
              onChange={(e) => {
                setLocalNext(e.target.value);
                onUpdateSequenceCsv(node.id, "next", e.target.value);
              }}
            />
          </div>

          {outgoingIds.length > 0 && (
            <div style={sectionStyle}>
              <label style={labelStyle}>Branching Conditions</label>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  marginTop: 4,
                }}
              >
                {edges
                  .filter((e) => e.from === node.id)
                  .map((edge, i) => {
                    const targetNodeIdx = allNodes.findIndex(
                      (n) => n.id === edge.to,
                    );
                    const displayLabel =
                      targetNodeIdx !== -1
                        ? `To Step #${targetNodeIdx + 1}`
                        : "To Route";

                    return (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            color: "#8890a8",
                            fontFamily: "'IBM Plex Mono', monospace",
                          }}
                        >
                          {displayLabel}:
                        </span>
                        <select
                          value={edge.condition || "DEFAULT"}
                          onChange={(e) => {
                            setEdges((prev) =>
                              prev.map((ed) =>
                                ed.from === edge.from && ed.to === edge.to
                                  ? { ...ed, condition: e.target.value }
                                  : ed,
                              ),
                            );
                          }}
                          style={{
                            background: "#161922",
                            border: "1px solid #242936",
                            borderRadius: 4,
                            padding: "4px 8px",
                            fontSize: 11,
                            color: "#d4d8e8",
                            outline: "none",
                          }}
                        >
                          <option value="DEFAULT">Unconditional (→)</option>
                          <option value="RESOLVE">RESOLVE (Success)</option>
                          <option value="RETRY">RETRY (Loop back)</option>
                          <option value="REJECT">REJECT (Failure)</option>
                        </select>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          <div style={sectionStyle}>
            <label style={labelStyle}>Display Title</label>
            <input
              style={inputStyle}
              type="text"
              value={node.title}
              onChange={(e) => onUpdateTitle(node.id, e.target.value)}
            />
          </div>

          {node.type === "VERIFICATION" && (
            <div style={sectionStyle}>
              <label style={labelStyle}>Expected Label</label>
              <input
                style={inputStyle}
                type="text"
                placeholder="e.g. Powder Container"
                value={node.config.expectedEntity}
                onChange={(e) =>
                  onUpdateConfig(node.id, "expectedEntity", e.target.value)
                }
              />
            </div>
          )}

          {node.type === "MEASUREMENT" && (
            <>
              <div style={sectionStyle}>
                <label style={labelStyle}>Target Weight (mg)</label>
                <input
                  style={inputStyle}
                  type="number"
                  value={node.config.targetValue}
                  onChange={(e) =>
                    onUpdateConfig(
                      node.id,
                      "targetValue",
                      Number(e.target.value),
                    )
                  }
                />
              </div>
              <div style={sectionStyle}>
                <label style={labelStyle}>Tolerance (± mg)</label>
                <input
                  style={inputStyle}
                  type="number"
                  value={node.config.tolerance}
                  onChange={(e) =>
                    onUpdateConfig(node.id, "tolerance", Number(e.target.value))
                  }
                />
              </div>
            </>
          )}
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            padding: "24px 16px",
            fontSize: 11,
            color: "#4b5563",
            lineHeight: 1.6,
            textAlign: "center",
          }}
        >
          Select any workflow element canvas card to inspect configuration
          variables.
        </div>
      )}

      {/* Shortened and Compacted AI Panel */}
      <div
        style={{
          margin: 12,
          background: "#11131a",
          border: "1px solid #1a1d26",
          borderRadius: 6,
          padding: 10,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "#3b82f6",
            marginBottom: 6,
            letterSpacing: ".02em",
          }}
        >
          ✦ SOP Document Ingestion
        </div>

        <label
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            justifyContent: "center",
            padding: "6px",
            background: "#161922",
            border: "1px dashed #242936",
            borderRadius: 4,
            cursor: "pointer",
            marginBottom: 6,
          }}
        >
          <span style={{ fontSize: 11 }}>📄</span>
          <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 500 }}>
            Upload Document
          </span>
          <input
            type="file"
            accept=".txt,.md,.json,text/plain"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (evt) => {
                if (typeof evt.target?.result === "string")
                  onInjectAiNodes(evt.target.result);
              };
              reader.readAsText(file);
              e.target.value = "";
            }}
          />
        </label>

        <textarea
          style={{
            width: "100%",
            height: "42px",
            background: "#0d0f14",
            border: "1px solid #242936",
            borderRadius: 4,
            padding: "5px",
            fontSize: 11,
            color: "#d4d8e8",
            resize: "none",
            outline: "none",
            marginBottom: 6,
          }}
          placeholder="Or paste guidelines text directly..."
          value={aiInput}
          onChange={(e) => setAiInput(e.target.value)}
        />
        <button
          onClick={() => {
            if (!aiInput.trim()) return;
            onInjectAiNodes(aiInput);
            setAiInput("");
          }}
          style={{
            width: "100%",
            background: "#1d4ed8",
            color: "#ffffff",
            border: "none",
            padding: "5px 0",
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Parse Excerpt
        </button>
      </div>
    </div>
  );
}
// ─── Validation Banner ────────────────────────────────────────────────────────

interface ValidationBannerProps {
  errors: string[];
  onDismiss: () => void;
}

function ValidationBanner({ errors, onDismiss }: ValidationBannerProps) {
  if (!errors.length) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 14,
        left: "50%",
        transform: "translateX(-50%)",
        background: "#1e1018",
        border: "1px solid #6b2230",
        color: "#f87171",
        fontSize: 12,
        padding: "10px 16px",
        borderRadius: 10,
        zIndex: 100,
        maxWidth: 400,
        fontFamily: "'DM Sans', sans-serif",
        boxShadow: "0 8px 24px rgba(0,0,0,.5)",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <span style={{ fontSize: 14, flexShrink: 0 }}>⚠</span>
      <div style={{ flex: 1 }}>
        {errors.map((err, i) => (
          <div key={i} style={{ lineHeight: 1.6 }}>
            {err}
          </div>
        ))}
      </div>
      <button
        onClick={onDismiss}
        style={{
          background: "none",
          border: "none",
          color: "#6b2230",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          flexShrink: 0,
          padding: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SopBuilder() {
  const [nodes, setNodes] = useState<NodeData[]>([]);

  const handleSopFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const textContent = event.target?.result;
      if (typeof textContent === "string") {
        // Feed the plain text content directly into your existing generator pipeline
        injectAiParsedNodes(textContent);
      }
    };
    reader.readAsText(file);

    // Clear input value so the same file can be uploaded again if edited
    e.target.value = "";
  };

  const [edges, setEdges] = useState<Edge[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{
    id: string;
    ox: number;
    oy: number;
  } | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [toast, setToast] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Canvas pan state
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, px: 0, py: 0 });

  const canvasRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  // ── Canvas size: grows to always contain all nodes + padding ───────────────

  const canvasSize = React.useMemo(() => {
    const PAD = 300;
    const maxX = nodes.reduce((m, n) => Math.max(m, n.x + NODE_WIDTH), 600);
    const maxY = nodes.reduce((m, n) => Math.max(m, n.y + NODE_HEIGHT), 400);
    return { width: maxX + PAD, height: maxY + PAD };
  }, [nodes]);

  // ── Drag + connect ─────────────────────────────────────────────────────────

  const onNodeMouseDown = useCallback(
    (e: React.MouseEvent, id: string) => {
      if ((e.target as HTMLElement).dataset.port) return;
      e.stopPropagation();

      const node = nodes.find((n) => n.id === id)!;

      // Lock offsets directly to the cursor's screen position
      setDragging({
        id,
        ox: e.clientX - node.x,
        oy: e.clientY - node.y,
      });
      setSelectedId(id);
    },
    [nodes],
  );

  const onPortMouseDown = useCallback(
    (e: React.MouseEvent, id: string, dir: "in" | "out") => {
      e.stopPropagation();
      if (dir === "out") setConnectingFrom(id);
    },
    [],
  );

  // Canvas pan on middle-button or empty space drag
  const onCanvasMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // 1. If background canvas is panning, run your native pan calculations
      if (isPanning.current) {
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        setPan({ x: panStart.current.px + dx, y: panStart.current.py + dy });
        return;
      }

      // 2. If an actual node card is being dragged across the screen
      if (dragging) {
        const SIDEBAR_PANEL_WIDTH = 292; // Match your new broader sidebar layout width
        const currentWindowWidth = window.innerWidth;

        // Calculate where the cursor wants to place the node card using your ox/oy offsets
        let proposedX = e.clientX - dragging.ox;
        let proposedY = e.clientY - dragging.oy;

        // Strict Right Boundary Clamp: Keep it completely in front of the sidebar
        if (proposedX + NODE_WIDTH > currentWindowWidth - SIDEBAR_PANEL_WIDTH) {
          proposedX =
            currentWindowWidth - SIDEBAR_PANEL_WIDTH - NODE_WIDTH - 16;
        }

        // Left, Top, and Bottom Padding Boundary Clamps to prevent flying off-screen
        if (proposedX < 16) proposedX = 16;
        if (proposedY < 16) proposedY = 16;

        // Commit coordinates instantly to layout tree state arrays using dragging.id
        setNodes((currentNodes) =>
          currentNodes.map((n) =>
            n.id === dragging.id ? { ...n, x: proposedX, y: proposedY } : n,
          ),
        );
      }
    },
    [dragging],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const inner = innerRef.current;
      if (!inner) return;
      const rect = inner.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (isPanning.current) {
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        setPan({ x: panStart.current.px + dx, y: panStart.current.py + dy });
        return;
      }

      if (dragging) {
        const SIDEBAR_PANEL_WIDTH = 292;
        const currentWindowWidth = window.innerWidth;

        // Clean, unwarped screen-space delta calculation
        let proposedX = e.clientX - dragging.ox;
        let proposedY = e.clientY - dragging.oy;

        // Strict Right Boundary Clamp
        if (proposedX + NODE_WIDTH > currentWindowWidth - SIDEBAR_PANEL_WIDTH) {
          proposedX =
            currentWindowWidth - SIDEBAR_PANEL_WIDTH - NODE_WIDTH - 16;
        }

        // Left and Top Boundary Clamps
        if (proposedX < 16) proposedX = 16;
        if (proposedY < 16) proposedY = 16;

        setNodes((prevNodes) =>
          prevNodes.map((n) =>
            n.id === dragging.id ? { ...n, x: proposedX, y: proposedY } : n,
          ),
        );
      }

      if (connectingFrom) setMousePos({ x: mx, y: my });
    };

    const onUp = (e: MouseEvent) => {
      isPanning.current = false;

      if (connectingFrom) {
        const el = e.target as HTMLElement;
        if (el.dataset.port === "in" && el.dataset.nodeid) {
          const toId = el.dataset.nodeid;
          if (
            toId !== connectingFrom &&
            !edges.find((ed) => ed.from === connectingFrom && ed.to === toId)
          ) {
            setEdges((prev) => [...prev, { from: connectingFrom, to: toId }]);
          }
        }
        setConnectingFrom(null);
        setMousePos(null);
      }
      setDragging(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, connectingFrom, edges]); // ◄ Now perfectly stable without needing nodes array triggers

  // ── Auto-scroll canvas when a new node is added below the viewport ─────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const last = nodes[nodes.length - 1];
    // Scroll so the last node is visible (accounting for pan)
    const nodeBottom = last.y + NODE_HEIGHT + pan.y + 80;
    if (nodeBottom > canvas.clientHeight) {
      canvas.scrollTo({
        top: nodeBottom - canvas.clientHeight + 40,
        behavior: "smooth",
      });
    }
  }, [nodes.length]); // only fire when node count changes

  // ── Nodes ─────────────────────────────────────────────────────────────────

  const addNode = (type: "VERIFICATION" | "MEASUREMENT") => {
    const newId = uid();
    const last = nodes[nodes.length - 1];
    const x = last ? last.x : 160;
    const y = last ? last.y + 200 : 80;
    const newNode: NodeData = {
      id: newId,
      title: type === "VERIFICATION" ? "New Verification" : "New Measurement",
      type,
      config: { expectedEntity: "", targetValue: 100, tolerance: 2 },
      x,
      y,
    };
    setNodes((prev) => [...prev, newNode]);
    if (last && !edges.find((e) => e.from === last.id)) {
      setEdges((prev) => [...prev, { from: last.id, to: newId }]);
    }
    setSelectedId(newId);
  };

  const injectAiParsedNodes = (rawText: string) => {
    // 1. Split the massive raw text paragraph into individual steps using "Step" anchors
    const stepBlocks = rawText.split(/Step\s+\d+:/i);

    const stepsToInject: Array<{
      type: "VERIFICATION" | "MEASUREMENT";
      title: string;
      config: {
        expectedEntity: string;
        targetValue: number;
        tolerance: number;
      };
    }> = [];

    stepBlocks.forEach((block, index) => {
      const trimmedBlock = block.trim();
      if (!trimmedBlock) return;

      // --- Heuristic A: Look for Verifications ---
      if (/verify|scan|barcode|label|check/i.test(trimmedBlock)) {
        // Extract whatever entity follows words like "verify", "scan", or "container"
        const entityMatch = trimmedBlock.match(
          /(?:verify|scan|check)\s+([A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+){0,2})/i,
        );

        stepsToInject.push({
          type: "VERIFICATION",
          title: entityMatch
            ? `Verify ${entityMatch[1].trim()}`
            : "AI Extracted Verification",
          config: {
            expectedEntity: entityMatch
              ? entityMatch[1].trim()
              : "Parsed Label Asset",
            targetValue: 0,
            tolerance: 0,
          },
        });
      }
      // --- Heuristic B: Look for Measurements ---
      else if (/weigh|measure|mg|g|mL|\d+/i.test(trimmedBlock)) {
        // Extract the metric number (e.g., 400mg, 10mL)
        const valueMatch = trimmedBlock.match(/(\d+)\s*(?:mg|g|mL|ml)/i);
        const toleranceMatch = trimmedBlock.match(
          /(?:tolerance|margin|±)\s*(?:of\s*)?(\d+)/i,
        );

        stepsToInject.push({
          type: "MEASUREMENT",
          title: trimmedBlock.split(/[.\n]/)[0].substring(0, 30) + "...", // Dynamic short title snippet
          config: {
            expectedEntity: "",
            targetValue: valueMatch ? Number(valueMatch[1]) : 100,
            tolerance: toleranceMatch ? Number(toleranceMatch[1]) : 2,
          },
        });
      }
    });

    if (stepsToInject.length === 0) {
      alert("Could not break down text into distinct workflow metrics.");
      return;
    }

    // 2. Programmatic Node Generation with coordinated layout offsets
    const addedNodes: NodeData[] = [];
    const newEdges: Edge[] = [];

    const tailNode = nodes[nodes.length - 1];
    let lastX = tailNode ? tailNode.x : 160;
    let lastY = tailNode ? tailNode.y : 80;
    let precedingNodeId = tailNode ? tailNode.id : null;

    stepsToInject.forEach((parsedStep, index) => {
      const generatedId = `step_ai_${index}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      lastY += 200; // Drop down cleanly below the preceding node position

      const newNode: NodeData = {
        id: generatedId,
        title: parsedStep.title,
        type: parsedStep.type,
        config: parsedStep.config,
        x: lastX,
        y: lastY,
        isAiGenerated: true,
        isManuallyConfirmed: false,
      };

      addedNodes.push(newNode);

      if (precedingNodeId) {
        newEdges.push({ from: precedingNodeId, to: generatedId });
      }
      precedingNodeId = generatedId;
    });

    // 3. Fire state mutations side-by-side cleanly in the primary execution tick
    setNodes((currentNodes) => [...currentNodes, ...addedNodes]);
    setEdges((currentEdges) => [...currentEdges, ...newEdges]);
    setSelectedId(addedNodes[addedNodes.length - 1].id);
  };

  const deleteNode = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    setSelectedId((s) => (s === id ? null : s));
  }, []);

  const updateTitle = (id: string, val: string) =>
    setNodes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, title: val } : n)),
    );

  const updateConfig = (
    id: string,
    key: keyof NodeData["config"],
    val: string | number,
  ) =>
    setNodes((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, config: { ...n.config, [key]: val } } : n,
      ),
    );

  const updateStatus = (
    id: string,
    field: "isManuallyConfirmed",
    val: boolean,
  ) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, [field]: val } : n)),
    );
  };

  const updateSequenceCsv = (
    nodeId: string,
    type: "prev" | "next",
    csvValue: string,
  ) => {
    // 1. Break the user input string down by comma tokens
    const tokens = csvValue
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    // 2. Map indices (1-indexed matching screen text) to real system string keys
    const targetIds = tokens
      .map((token) => {
        if (/^\d+$/.test(token)) {
          const targetIndex = parseInt(token, 10) - 1;
          return nodes[targetIndex]?.id || null;
        }
        return nodes.some((n) => n.id === token) ? token : null;
      })
      .filter((id): id is string => id !== null);

    // 3. Re-route edges dynamically on the exact same rendering cycle
    if (type === "prev") {
      setEdges((prev) => {
        const remainingEdges = prev.filter((e) => e.to !== nodeId);
        const freshIncomingEdges = targetIds.map((fromId) => ({
          from: fromId,
          to: nodeId,
        }));
        return [...remainingEdges, ...freshIncomingEdges];
      });
    } else {
      setEdges((prev) => {
        const remainingEdges = prev.filter((e) => e.from !== nodeId);
        const freshOutgoingEdges = targetIds.map((toId) => ({
          from: nodeId,
          to: toId,
        }));
        return [...remainingEdges, ...freshOutgoingEdges];
      });
    }
  };
  // ── Validate + Compile ────────────────────────────────────────────────────

  const validate = (): string[] => {
    const errors: string[] = [];

    if (nodes.length === 0) {
      return ["The canvas workspace is empty. Create at least one step node."];
    }

    // 1. Identify your true workflow root (the start node)
    const rootNode = nodes[0];

    // 2. Build a bidirectional connectivity map (Treating the graph as undirected for isolation checks)
    const connectedNodeIds = new Set<string>([rootNode.id]);
    let structureMutated = true;

    // Run a clean relaxation loop to find all reachable nodes regardless of edge direction
    while (structureMutated) {
      structureMutated = false;
      edges.forEach((edge) => {
        const hasFrom = connectedNodeIds.has(edge.from);
        const hasTo = connectedNodeIds.has(edge.to);

        // If either side is connected, then both sides are part of the valid cluster
        if (hasFrom && !hasTo) {
          connectedNodeIds.add(edge.to);
          structureMutated = true;
        } else if (!hasFrom && hasTo) {
          connectedNodeIds.add(edge.from);
          structureMutated = true;
        }
      });
    }

    // 3. Collect the human-readable titles of truly disconnected floating steps
    const disconnectedNodes = nodes.filter(
      (node) => !connectedNodeIds.has(node.id),
    );

    if (disconnectedNodes.length > 0) {
      const uniqueTitles = Array.from(
        new Set(disconnectedNodes.map((n) => `"${n.title}"`)),
      );
      errors.push(
        `Disconnected node(s): ${uniqueTitles.join(", ")}. Connect all steps before saving.`,
      );
    }

    return errors;
  };

  const compile = async () => {
    const errs = validate();
    if (errs.length) {
      setValidationErrors(errs);
      return;
    }
    setValidationErrors([]);

    // 1. Serialize the component state into the verified JSON structure
    const sopPayload = {
      template_id: `SOP-${Date.now()}`,
      version: "1.0.0",
      start_node_id: nodes[0]?.id || null,
      nodes: nodes.map((n) => {
        const outgoingEdges = edges.filter((e) => e.from === n.id);

        return {
          id: n.id,
          type: n.type,
          title: n.title,
          config:
            n.type === "VERIFICATION"
              ? { verified_entity: n.config.expectedEntity || null }
              : {
                  target_value: n.config.targetValue,
                  tolerance: n.config.tolerance,
                },
          transitions: outgoingEdges.map((e) => ({
            target_node_id: e.to,
            condition: e.condition || "DEFAULT",
          })),
        };
      }),
    };

    console.log("Compiled SOP Payload:", sopPayload);

    try {
      // 2. Shoot the payload straight over to your NestJS server database
      const response = await fetch("http://localhost:3000/api/sop/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Add Authorization tokens here if your NestJS guards require them
          // "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(sopPayload),
      });

      if (!response.ok) {
        throw new Error(`Server responded with status: ${response.status}`);
      }

      const result = await response.json();
      console.log("NestJS DB Save Result:", result);

      // Trigger UI success notification on successful save
      setToast(true);
      setTimeout(() => setToast(false), 2500);
    } catch (error) {
      console.error("HTTP Transmission Error to NestJS:", error);
      setValidationErrors([
        "Failed to save SOP configuration to the backend server. Connection refused.",
      ]);
    }
  };

  const selectedNode = nodes.find((n) => n.id === selectedId);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        width: "100%",
        fontFamily: "'DM Sans', sans-serif",
        background: "#0d0f14",
        color: "#d4d8e8",
      }}
    >
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=DM+Sans:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
        input:focus { border-color: #f5a623 !important; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2a2f3d; border-radius: 2px; }
      `}</style>

      {/* Canvas — scrollable so nodes at bottom are always reachable */}
      {/* Canvas Viewport Container Box */}
      <div
        ref={canvasRef}
        style={{
          flex: 1,
          position: "relative",
          overflow: "auto",
          background: "#0d0f14",
        }}
        onMouseMove={onCanvasMouseMove}
        onMouseDown={(e) => {
          // Initialize canvas background panning only when clicking on raw empty space
          if (e.target === canvasRef.current || e.target === innerRef.current) {
            e.preventDefault();
            isPanning.current = true;
            panStart.current = {
              x: e.clientX,
              y: e.clientY,
              px: pan.x,
              py: pan.y,
            };
            setSelectedId(null);
          }
        }}
        onClick={() => setSelectedId(null)}
      >
        {/* Inner layer that grows with content and holds dots bg */}
        <div
          ref={innerRef}
          style={{
            position: "relative",
            width: canvasSize.width,
            height: canvasSize.height,
            backgroundImage:
              "radial-gradient(circle, #1e2235 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        >
          {/* Canvas label */}
          <div
            style={{
              position: "absolute",
              top: 16,
              left: 20,
              fontFamily: "monospace",
              fontSize: 20,
              color: "#565d75",
              letterSpacing: ".06em",
              pointerEvents: "none",
            }}
          >
            SOP WORKFLOW CANVAS
          </div>

          {/* Validation banner */}
          <ValidationBanner
            errors={validationErrors}
            onDismiss={() => setValidationErrors([])}
          />
          {/* Edges SVG */}
          <EdgesLayer
            nodes={nodes}
            edges={edges}
            selectedId={selectedId}
            connectingFrom={connectingFrom}
            mousePos={mousePos}
            canvasSize={canvasSize}
          />

          {/* Nodes */}
          {nodes.map((n, i) => (
            <WorkflowNode
              key={n.id}
              node={n}
              index={i}
              isSelected={selectedId === n.id}
              isConnectingFrom={connectingFrom === n.id}
              onMouseDown={onNodeMouseDown}
              onPortMouseDown={onPortMouseDown}
              onClick={setSelectedId}
              onContextMenu={deleteNode}
            />
          ))}

          {/* Toast */}
          <div
            style={{
              position: "fixed",
              bottom: 80,
              left: "50%",
              transform: "translateX(-50%)",
              background: "#1a1e2a",
              border: "1px solid #1a4a38",
              color: "#2dd4a0",
              fontSize: 12,
              padding: "8px 16px",
              borderRadius: 8,
              opacity: toast ? 1 : 0,
              transition: "opacity .3s",
              pointerEvents: "none",
              whiteSpace: "nowrap",
              fontFamily: "'IBM Plex Mono', monospace",
              zIndex: 200,
            }}
          >
            ✓ Template compiled — check console
          </div>
        </div>
      </div>

      {/* Sidebar */}
      {/* Find this right at the bottom edge of your main return layout render */}
      <Sidebar
        node={selectedNode}
        allNodes={nodes}
        edges={edges}
        setEdges={setEdges}
        onUpdateTitle={updateTitle}
        onUpdateConfig={updateConfig}
        onUpdateStatus={updateStatus}
        onUpdateSequenceCsv={updateSequenceCsv}
        onInjectAiNodes={injectAiParsedNodes}
        onAddManualNode={(type) => {
          // Simple callback to handle manual node additions on click
          const newId = `step_manual_${Date.now()}`;
          const tailNode = nodes[nodes.length - 1];
          setNodes((prev) => [
            ...prev,
            {
              id: newId,
              title:
                type === "VERIFICATION"
                  ? "Manual Verification"
                  : "Manual Measurement",
              type: type,
              config: { expectedEntity: "", targetValue: 0, tolerance: 0 },
              x: tailNode ? tailNode.x : 100,
              y: tailNode ? tailNode.y + 180 : 100,
              isAiGenerated: false,
            },
          ]);
        }}
        onSaveAndValidate={() => {
          compile();
        }}
      />
    </div>
  );
}
