"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NodeData {
  id: string;
  title: string;
  type: "VERIFICATION" | "MEASUREMENT";
  config: {
    expectedEntity: string;
    mode: "BARCODE" | "MANUAL_ENTRY" | "POST_HOC_VISION";
    targetValue?: number | string;
    tolerance?: number | string;
    unit: "mg" | "g" | "ml" | "C";
    yoloClassName?: string;
    confidenceThreshold?: number;
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

interface ArchiveEntry {
  id: string;
  name: string;
  timestamp: number;
  nodes: NodeData[];
  edges: Edge[];
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
  isConnectingFrom,
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
              : isConnectingFrom
                ? "#f5a623"
                : node.isAiGenerated && !node.isManuallyConfirmed
                  ? "#f87171" // Bright red outline for unconfirmed AI nodes
                  : "#2a2f3d"
          }`,
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: isSelected
            ? "0 0 0 1px #f5a623, 0 8px 32px rgba(245,166,35,.15)"
            : isConnectingFrom
              ? "0 0 8px #f5a623, 0 4px 16px rgba(0,0,0,.4)"
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
              Add:{" "}
              <span style={{ color: "#d4d8e8", fontWeight: 500 }}>
                {node.config.targetValue !== undefined && node.config.targetValue !== "" ? `${node.config.targetValue}${node.config.unit || "mg"}` : "—"}
              </span>{" "}
              ±{" "}
              <span style={{ color: "#d4d8e8", fontWeight: 500 }}>
                {node.config.tolerance !== undefined && node.config.tolerance !== "" ? `${node.config.tolerance}${node.config.unit || "mg"}` : "—"}
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
      <defs>
        <marker id="arr-default" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#2a2f3d" />
        </marker>
        <marker id="arr-selected" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#f5a623" />
        </marker>
        <marker id="arr-reject" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#f87171" />
        </marker>
        <marker id="arr-resolve" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#2dd4a0" />
        </marker>
      </defs>

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
              markerEnd={
                isHL
                  ? "url(#arr-selected)"
                  : e.condition === "REJECT"
                    ? "url(#arr-reject)"
                    : e.condition === "RESOLVE"
                      ? "url(#arr-resolve)"
                      : "url(#arr-default)"
              }
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

      {connectingFrom && mousePos && (() => {
        const from = getPortPos(connectingFrom, "out");
        return (
          <path
            d={makeCubic(from.x, from.y, mousePos.x, mousePos.y)}
            fill="none"
            stroke="#f5a623"
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
        );
      })()}
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
  const [inventoryItems, setInventoryItems] = useState<{ id: string; name: string; nfcUid: string }[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);

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

  // Fetch inventory items once on mount to populate the VERIFICATION dropdown
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInventoryLoading(true);
    fetch("http://localhost:3000/api/inventory")
      .then((r) => r.json())
      .then((data) => setInventoryItems(Array.isArray(data) ? data : []))
      .catch(() => {}) // Fail silently — dropdown will just be empty if backend is offline
      .finally(() => setInventoryLoading(false));
  }, []);

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

  const [prevId, setPrevId] = useState(node?.id);
  const [lastPropPrev, setLastPropPrev] = useState(prevCsv);
  const [lastPropNext, setLastPropNext] = useState(nextCsv);
  const [localPrev, setLocalPrev] = useState(prevCsv);
  const [localNext, setLocalNext] = useState(nextCsv);

  if (node?.id !== prevId) {
    setPrevId(node?.id);
    setLastPropPrev(prevCsv);
    setLastPropNext(nextCsv);
    setLocalPrev(prevCsv);
    setLocalNext(nextCsv);
  } else {
    if (prevCsv !== lastPropPrev) {
      setLastPropPrev(prevCsv);
      setLocalPrev(prevCsv);
    }
    if (nextCsv !== lastPropNext) {
      setLastPropNext(nextCsv);
      setLocalNext(nextCsv);
    }
  }

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
          VERIFY
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
          MEASURE
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
                id={`confirm-ai-${node.id}`}
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
                htmlFor={`confirm-ai-${node.id}`}
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
            <>
              <div style={sectionStyle}>
                <label style={labelStyle}>Expected Label</label>
                <select
                  style={{
                    ...inputStyle,
                    opacity: inventoryLoading ? 0.5 : 1,
                  }}
                  value={node.config.expectedEntity}
                  onChange={(e) =>
                    onUpdateConfig(node.id, "expectedEntity", e.target.value)
                  }
                >
                  <option value="">
                    {inventoryLoading ? "Loading inventory..." : inventoryItems.length === 0 ? "No items registered" : "-- Select from Inventory --"}
                  </option>
                  {inventoryItems.map((item) => (
                    <option key={item.id} value={item.name}>
                      {item.name}{item.nfcUid ? ` (${item.nfcUid})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div style={sectionStyle}>
                <label style={labelStyle}>Verification Mode</label>
                <select
                  style={{
                    background: "#161922",
                    border: "1px solid #242936",
                    borderRadius: 4,
                    padding: "6px 10px",
                    fontSize: 12,
                    color: "#d4d8e8",
                    outline: "none",
                    width: "100%",
                  }}
                  value={node.config.mode || "MANUAL_ENTRY"}
                  onChange={(e) =>
                    onUpdateConfig(node.id, "mode", e.target.value)
                  }
                >
                  <option value="BARCODE">Barcode Scan</option>
                  <option value="MANUAL_ENTRY">Manual Entry</option>
                  <option value="POST_HOC_VISION">Post-hoc Vision</option>
                </select>
              </div>

              {node.config.mode === "POST_HOC_VISION" && (
                <>
                  <div style={sectionStyle}>
                    <label style={labelStyle}>YOLO Class Label</label>
                    <input
                      style={inputStyle}
                      type="text"
                      placeholder="e.g. powder_container (optional)"
                      value={node.config.yoloClassName || ""}
                      onChange={(e) =>
                        onUpdateConfig(node.id, "yoloClassName", e.target.value)
                      }
                    />
                  </div>
                  <div style={sectionStyle}>
                    <label style={labelStyle}>
                      Min YOLO Confidence: {(node.config.confidenceThreshold ?? 0.8).toFixed(2)}
                    </label>
                    <input
                      style={{
                        width: "100%",
                        cursor: "pointer",
                      }}
                      type="range"
                      min="0.10"
                      max="1.00"
                      step="0.05"
                      value={node.config.confidenceThreshold ?? 0.8}
                      onChange={(e) =>
                        onUpdateConfig(
                          node.id,
                          "confidenceThreshold",
                          Number(e.target.value),
                        )
                      }
                    />
                  </div>
                </>
              )}
            </>
          )}

          {node.type === "MEASUREMENT" && (
            <>
              <div style={sectionStyle}>
                <label style={labelStyle}>Weight to Add</label>
                <input
                  style={inputStyle}
                  type="number"
                  value={node.config.targetValue ?? ""}
                  onChange={(e) =>
                    onUpdateConfig(
                      node.id,
                      "targetValue",
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                />
              </div>
              <div style={sectionStyle}>
                <label style={labelStyle}>Unit</label>
                <select
                  style={{
                    background: "#161922",
                    border: "1px solid #242936",
                    borderRadius: 4,
                    padding: "6px 10px",
                    fontSize: 12,
                    color: "#d4d8e8",
                    outline: "none",
                    width: "100%",
                  }}
                  value={node.config.unit || "mg"}
                  onChange={(e) =>
                    onUpdateConfig(node.id, "unit", e.target.value)
                  }
                >
                  <option value="mg">mg</option>
                  <option value="g">g</option>
                  <option value="ml">ml</option>
                  <option value="C">C</option>
                </select>
              </div>
              <div style={sectionStyle}>
                <label style={labelStyle}>Tolerance (±)</label>
                <input
                  style={inputStyle}
                  type="number"
                  value={node.config.tolerance ?? ""}
                  onChange={(e) =>
                    onUpdateConfig(
                      node.id,
                      "tolerance",
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
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
            fontSize: 12,
            fontWeight: 400,
            color: "#3b82f6",
            marginBottom: 6,
            letterSpacing: ".02em",
          }}
        >
          SOP Document Ingestion
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
          <span className="material-symbols-outlined" style={{ fontSize: 13, color: "#9ca3af" }}>description</span>
          <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400 }}>
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
            fontWeight: 400,
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
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(7, 9, 12, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: "rgba(30, 16, 24, 0.95)",
          border: "1px solid #6b2230",
          color: "#fca5a5",
          fontSize: 12,
          padding: "24px 32px",
          borderRadius: 12,
          maxWidth: 480,
          width: "90%",
          fontFamily: "'DM Sans', sans-serif",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(107, 34, 48, 0.2)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid rgba(107, 34, 48, 0.3)", paddingBottom: 12 }}>
          <span style={{ fontSize: 18, color: "#ef4444" }}>⚠</span>
          <span style={{ fontSize: 13, fontWeight: 400, color: "#fca5a5", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Workflow Validation Errors
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "250px", overflowY: "auto" }}>
          {errors.map((err, i) => (
            <div key={i} style={{ lineHeight: 1.6, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ color: "#ef4444", flexShrink: 0 }}>•</span>
              <span style={{ flex: 1, fontWeight: 400 }}>{err}</span>
            </div>
          ))}
        </div>
        <button
          onClick={onDismiss}
          style={{
            alignSelf: "flex-end",
            background: "rgba(107, 34, 48, 0.25)",
            border: "1px solid #6b2230",
            color: "#fca5a5",
            cursor: "pointer",
            fontSize: 11,
            padding: "8px 20px",
            borderRadius: 6,
            fontWeight: 400,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
            outline: "none",
          }}
          className="error-dismiss-btn"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SopBuilder() {
  const [nodes, setNodes] = useState<NodeData[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; ox: number; oy: number; } | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showArchivesList, setShowArchivesList] = useState(false);
  const [tempSaveName, setTempSaveName] = useState("");
  const [deployToast, setDeployToast] = useState<string | null>(null);
  const [deployingRun, setDeployingRun] = useState(false);
  const [lastSavedTemplateId, setLastSavedTemplateId] = useState<string | null>(null);

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
      const inner = innerRef.current;
      if (!inner) return;
      const rect = inner.getBoundingClientRect();

      // Lock offsets relative to the inner container
      setDragging({
        id,
        ox: e.clientX - rect.left - node.x,
        oy: e.clientY - rect.top - node.y,
      });
      setSelectedId(id);
    },
    [nodes, setDragging, setSelectedId],
  );

  const onPortMouseDown = useCallback(
    (e: React.MouseEvent, id: string, dir: "in" | "out") => {
      e.stopPropagation();
      if (dir === "out") setConnectingFrom(id);
    },
    [],
  );

  // Canvas pan on middle-button or empty space drag is handled globally in useEffect

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
        const canvas = canvasRef.current;
        const scrollLeft = canvas ? canvas.scrollLeft : 0;
        const scrollTop = canvas ? canvas.scrollTop : 0;

        // Clean dragging calculation relative to the inner canvas container
        let proposedX = mx - dragging.ox;
        let proposedY = my - dragging.oy;

        // Strict Right Boundary Clamp (viewport-aware in content space)
        const maxAllowedX = scrollLeft + currentWindowWidth - SIDEBAR_PANEL_WIDTH - NODE_WIDTH - 16;
        if (proposedX > maxAllowedX) {
          proposedX = maxAllowedX;
        }

        // Left and Top Boundary Clamps (viewport-aware in content space)
        const minAllowedX = scrollLeft + 16;
        if (proposedX < minAllowedX) proposedX = minAllowedX;

        const minAllowedY = scrollTop + 16;
        if (proposedY < minAllowedY) proposedY = minAllowedY;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length]); // only fire when node count changes

  // ── Load Archives on Mount ───────────────────────────────────────────────
  useEffect(() => {
    try {
      const stored = localStorage.getItem("sop_workflow_archives");
      if (stored) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setArchives(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Failed to load local archives:", e);
    }
  }, []);

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
      config: {
        expectedEntity: "",
        mode: "MANUAL_ENTRY",
        targetValue: undefined,
        tolerance: undefined,
        unit: "mg",
      },
      x,
      y,
    };
    setNodes((prev) => [...prev, newNode]);
    if (last) {
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
        mode: "BARCODE" | "MANUAL_ENTRY" | "POST_HOC_VISION";
        targetValue?: number | string;
        tolerance?: number | string;
        unit: "mg" | "g" | "ml" | "C";
      };
    }> = [];

    stepBlocks.forEach((block) => {
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
            mode: "MANUAL_ENTRY",
            targetValue: undefined,
            tolerance: undefined,
            unit: "mg",
          },
        });
      }
      // --- Heuristic B: Look for Measurements ---
      else if (/weigh|measure|mg|g|mL|\d+/i.test(trimmedBlock)) {
        // Extract the metric number (e.g., 400mg, 10mL)
        const valueMatch = trimmedBlock.match(/(\d+)\s*(?:mg|g|mL|ml|C)/i);
        const toleranceMatch = trimmedBlock.match(
          /(?:tolerance|margin|±)\s*(?:of\s*)?(\d+)/i,
        );
        const unitMatch = trimmedBlock.match(/(mg|g|ml|mL|C)/i);
        let unit: "mg" | "g" | "ml" | "C" = "mg";
        if (unitMatch) {
          const u = unitMatch[1].toLowerCase();
          if (u === "ml") unit = "ml";
          else if (u === "g") unit = "g";
          else if (u === "c") unit = "C";
        }

        stepsToInject.push({
          type: "MEASUREMENT",
          title: trimmedBlock.split(/[.\n]/)[0].substring(0, 30) + "...", // Dynamic short title snippet
          config: {
            expectedEntity: "",
            mode: "MANUAL_ENTRY",
            targetValue: valueMatch ? Number(valueMatch[1]) : undefined,
            tolerance: toleranceMatch ? Number(toleranceMatch[1]) : undefined,
            unit,
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
    const lastX = tailNode ? tailNode.x : 160;
    let lastY = tailNode ? tailNode.y : 80;
    let precedingNodeId = tailNode ? tailNode.id : null;

    stepsToInject.forEach((parsedStep) => {
      const generatedId = uid();
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
  }, [setNodes, setEdges, setSelectedId]);

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

    // 1. Identify your true workflow root (node with no incoming edges)
    const rootNode = nodes.find((n) => !edges.some((e) => e.to === n.id)) || nodes[0];

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

    // 4. Validate that measurement nodes have all configurations completed (target and tolerance)
    nodes.forEach((node) => {
      if (node.type === "MEASUREMENT") {
        if (node.config.targetValue === undefined || node.config.targetValue === "") {
          errors.push(`Measurement step "${node.title}" must specify a weight to add.`);
        }
        if (node.config.tolerance === undefined || node.config.tolerance === "") {
          errors.push(`Measurement step "${node.title}" must specify a tolerance.`);
        }
      }
    });

    return errors;
  };

  const compile = async (customName?: string): Promise<boolean> => {
    const errs = validate();
    if (errs.length) {
      setValidationErrors(errs);
      return false;
    }
    setValidationErrors([]);

    const slugify = (text: string) => {
      return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^\w\-]+/g, "")
        .replace(/\-\-+/g, "-")
        .replace(/^-+/, "")
        .replace(/-+$/, "");
    };

    const templateId = customName && customName.trim() !== ""
      ? `SOP-${slugify(customName)}`
      : `SOP-${Date.now()}`;

    // 1. Find the true start node (no incoming edges) before building payload
    const trueStartNode = nodes.find((n) => !edges.some((e) => e.to === n.id)) || nodes[0];

    // Safety guard — validate() should have already caught this, but be explicit
    if (!trueStartNode) {
      setValidationErrors(["Cannot determine workflow start node. Add at least one step."]);
      return false;
    }

    // 2. Serialize the component state into the verified JSON structure
    const sopPayload = {
      template_id: templateId,
      version: "1.0.0",
      start_node_id: trueStartNode.id,
      nodes: nodes.map((n) => {
        const outgoingEdges = edges.filter((e) => e.from === n.id);

        return {
          id: n.id,
          type: n.type,
          title: n.title,
          x: n.x,
          y: n.y,
          config:
            n.type === "VERIFICATION"
              ? {
                  entity_name: n.config.expectedEntity || "",
                  mode: n.config.mode || "MANUAL_ENTRY",
                  confidence_threshold: n.config.confidenceThreshold !== undefined ? Number(n.config.confidenceThreshold) : undefined,
                  yolo_class_name: n.config.yoloClassName || undefined,
                }
              : {
                  target_value: n.config.targetValue !== undefined && n.config.targetValue !== "" ? Number(n.config.targetValue) : 0,
                  unit: n.config.unit || "mg",
                  tolerance_positive: n.config.tolerance !== undefined && n.config.tolerance !== "" ? Number(n.config.tolerance) : 0,
                  tolerance_negative: n.config.tolerance !== undefined && n.config.tolerance !== "" ? Number(n.config.tolerance) : 0,
                },
          next_nodes: outgoingEdges.map((e) => e.to),
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
      return true;
    } catch (error) {
      console.error("HTTP Transmission Error to NestJS:", error);
      setValidationErrors([
        "Failed to save SOP configuration to the backend server. Connection refused.",
      ]);
      return false;
    }
  };

  // ── Archives & Deployment Operations ──────────────────────────────────────
  const saveToArchives = async (name: string) => {
    if (!name.trim()) return;
    const success = await compile(name);
    if (!success) return; // Validation failed, errors already set

    const newEntry: ArchiveEntry = {
      id: `archive_${Date.now()}`,
      name: name.trim(),
      timestamp: Date.now(),
      nodes,
      edges,
    };

    const updated = [newEntry, ...archives];
    setArchives(updated);
    try {
      localStorage.setItem("sop_workflow_archives", JSON.stringify(updated));
    } catch (e) {
      console.error("Failed to save to localStorage:", e);
    }
    setShowSaveModal(false);
    setTempSaveName("");
  };

  const loadFromArchive = (archive: ArchiveEntry) => {
    setNodes(archive.nodes);
    setEdges(archive.edges);
    setSelectedId(null);
    setShowArchivesList(false);
  };

  const deleteFromArchive = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = archives.filter((a) => a.id !== id);
    setArchives(updated);
    try {
      localStorage.setItem("sop_workflow_archives", JSON.stringify(updated));
    } catch (err) {
      console.error("Failed to delete from localStorage:", err);
    }
  };

  const startActiveRun = async () => {
    if (deployingRun) return;
    setDeployingRun(true);
    setDeployToast(null);

    // Step 1: compile + save template (uses a stable name so repeat deploys upsert)
    const runName = tempSaveName.trim() || `SOP-Run-${Date.now()}`;
    const success = await compile(runName);
    if (!success) { setDeployingRun(false); return; }

    // Step 2: derive the templateId from compile() logic (mirrors slugify logic)
    const slugify = (t: string) => t.toLowerCase().trim().replace(/\s+/g,"-").replace(/[^\w\-]+/,"").replace(/\-\-+/g,"-").replace(/^-+/,"").replace(/-+$/,"");
    const templateId = `SOP-${slugify(runName)}`;

    // Step 3: start a run
    try {
      const r = await fetch("http://localhost:3000/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sopId: templateId }),
      });
      if (!r.ok) {
        const err = await r.json();
        setValidationErrors([`Failed to start run: ${err.message ?? r.status}`]);
        setDeployingRun(false);
        return;
      }
      const { run_id } = await r.json();
      setLastSavedTemplateId(templateId);
      // Redirect to execution dashboard
      window.location.href = `/runs/${run_id}`;
    } catch {
      setValidationErrors(["Cannot reach backend. Is sop-engine running on port 3000?"]);
      setDeployingRun(false);
    }
  };

  const selectedNode = nodes.find((n) => n.id === selectedId);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100%",
        fontFamily: "'DM Sans', sans-serif",
        background: "#0d0f14",
        color: "#d4d8e8",
      }}
    >
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=DM+Sans:wght@400;500;600&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap');
        * { box-sizing: border-box; }
        input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
        input:focus { border-color: #6366f1 !important; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25) !important; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2a2f3d; border-radius: 2px; }

        /* Premium Top Bar HUD Buttons */
        .topbar-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 400;
          font-family: 'DM Sans', sans-serif;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          outline: none;
          position: relative;
          user-select: none;
        }

        .btn-archives {
          background: rgba(22, 25, 34, 0.45);
          border: 1px solid rgba(212, 216, 232, 0.1);
          color: #a3a8be;
        }
        .btn-archives:hover {
          background: rgba(43, 49, 66, 0.95);
          border-color: rgba(212, 216, 232, 0.45);
          color: #ffffff;
        }

        .btn-save {
          background: rgba(99, 102, 241, 0.05);
          border: 1px solid rgba(99, 102, 241, 0.25);
          color: #a5b4fc;
        }
        .btn-save:hover {
          background: rgba(99, 102, 241, 0.85);
          border-color: rgba(129, 140, 248, 0.9);
          color: #ffffff;
        }

        .btn-inventory {
          background: rgba(245, 158, 11, 0.05);
          border: 1px solid rgba(245, 158, 11, 0.3);
          color: #fbbf24;
        }
        .btn-inventory:hover {
          background: rgba(245, 158, 11, 0.8);
          border-color: rgba(251, 191, 36, 0.85);
          color: #ffffff;
        }

        .btn-deploy {
          background: rgba(16, 185, 129, 0.05);
          border: 1px solid rgba(16, 185, 129, 0.35);
          color: #34d399;
        }
        .btn-deploy:hover {
          background: rgba(16, 185, 129, 0.8);
          border-color: rgba(52, 211, 153, 0.85);
          color: #ffffff;
        }

        /* Material Symbols Outlined Custom styles */
        .material-symbols-outlined {
          font-size: 16px;
          font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 20;
          display: inline-block;
          vertical-align: middle;
          line-height: 1;
        }

        .error-dismiss-btn:hover {
          background: rgba(107, 34, 48, 0.5) !important;
          border-color: #fca5a5 !important;
          color: #ffffff !important;
        }
      `}</style>

      {/* Top Bar Header */}
      <div
        style={{
          height: 60,
          background: "#07090c",
          borderBottom: "1px solid #1f2430",
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 100,
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
        }}
      >
        {/* Left - Heading exact same form! */}
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 20,
            color: "#565d75",
            letterSpacing: ".06em",
            fontWeight: 400,
            textShadow: "0 0 10px rgba(86, 93, 117, 0.2)",
          }}
        >
          SOP WORKFLOW CANVAS
        </div>

        {/* Right - Control actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => setShowArchivesList(true)}
            className="topbar-btn btn-archives"
          >
            <span className="material-symbols-outlined">folder_open</span>
            <span>Archives ({archives.length})</span>
          </button>

          <button
            onClick={() => window.open("/admin/inventory", "_blank")}
            className="topbar-btn btn-inventory"
          >
            <span className="material-symbols-outlined">nfc</span>
            <span>Inventory</span>
          </button>

          <button
            onClick={() => {
              setTempSaveName(`SOP-Template-${archives.length + 1}`);
              setShowSaveModal(true);
            }}
            className="topbar-btn btn-save"
          >
            <span className="material-symbols-outlined">save</span>
            <span>Save Template</span>
          </button>

          <button
            onClick={startActiveRun}
            disabled={deployingRun}
            className="topbar-btn btn-deploy"
            style={{ opacity: deployingRun ? 0.6 : 1 }}
          >
            <span className="material-symbols-outlined">bolt</span>
            <span>{deployingRun ? "Starting Run..." : "Deploy Compliance"}</span>
          </button>
        </div>
      </div>

      {/* Main Workspace Split View */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative" }}>
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
              ✓ Template saved to engine
            </div>
          </div>
        </div>

        {/* Sidebar */}
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
          onAddManualNode={addNode}
          onSaveAndValidate={() => {
            setTempSaveName(`SOP-Template-${archives.length + 1}`);
            setShowSaveModal(true);
          }}
        />
      </div>

      {/* Save Modal */}
      {showSaveModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 500,
          }}
        >
          <div
            style={{
              background: "#07090c",
              border: "1px solid #242936",
              borderRadius: 12,
              padding: 24,
              width: 400,
              boxShadow: "0 10px 40px rgba(0, 0, 0, 0.6)",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            <h3
              style={{
                marginTop: 0,
                fontSize: 16,
                color: "#d4d8e8",
                fontWeight: 400,
                fontFamily: "monospace",
                letterSpacing: ".05em",
                borderBottom: "1px solid #1a202c",
                paddingBottom: 12,
              }}
            >
              SAVE SOP WORKFLOW TEMPLATE
            </h3>
            <p style={{ fontSize: 12, color: "#8890a8", margin: "12px 0 6px 0" }}>
              Enter a name for this active canvas workflow:
            </p>
            <input
              type="text"
              value={tempSaveName}
              onChange={(e) => setTempSaveName(e.target.value)}
              placeholder="e.g. Chemical Mixing Routine"
              style={{
                width: "100%",
                background: "#161922",
                border: "1px solid #242936",
                borderRadius: 6,
                padding: "10px 12px",
                fontSize: 13,
                color: "#d4d8e8",
                outline: "none",
                marginBottom: 20,
              }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tempSaveName.trim()) {
                  saveToArchives(tempSaveName);
                }
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button
                onClick={() => setShowSaveModal(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#565d75",
                  fontSize: 12,
                  fontFamily: "'IBM Plex Mono', monospace",
                  cursor: "pointer",
                  padding: "8px 12px",
                }}
              >
                CANCEL
              </button>
              <button
                onClick={() => saveToArchives(tempSaveName)}
                disabled={!tempSaveName.trim()}
                style={{
                  background: "linear-gradient(135deg, #4f46e5 0%, #2563eb 100%)",
                  border: "none",
                  borderRadius: 6,
                  color: "#ffffff",
                  fontSize: 12,
                  fontWeight: 400,
                  fontFamily: "'IBM Plex Mono', monospace",
                  padding: "8px 20px",
                  cursor: tempSaveName.trim() ? "pointer" : "not-allowed",
                  opacity: tempSaveName.trim() ? 1 : 0.5,
                  boxShadow: "0 0 10px rgba(99, 102, 241, 0.3)",
                }}
              >
                SAVE & VERIFY
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archives Overlay Drawer */}
      {showArchivesList && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 500,
          }}
          onClick={() => setShowArchivesList(false)}
        >
          <div
            style={{
              background: "#07090c",
              border: "1px solid #242936",
              borderRadius: 16,
              padding: 28,
              width: 550,
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.7)",
              fontFamily: "'DM Sans', sans-serif",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: "1px solid #1a202c",
                paddingBottom: 16,
                marginBottom: 20,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: 16,
                  color: "#d4d8e8",
                  fontWeight: 400,
                  fontFamily: "monospace",
                  letterSpacing: ".05em",
                }}
              >
                SAVED SOP ARCHIVES
              </h3>
              <button
                onClick={() => setShowArchivesList(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#565d75",
                  fontSize: 18,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                paddingRight: 6,
              }}
            >
              {archives.length === 0 ? (
                <div
                  style={{
                    padding: "40px 0",
                    textAlign: "center",
                    color: "#565d75",
                    fontSize: 13,
                    fontStyle: "italic",
                  }}
                >
                  No archived workflows found. Click &quot;Save Template&quot; to store one!
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {archives.map((archive) => {
                    const date = new Date(archive.timestamp).toLocaleString();
                    const measureCount = archive.nodes.filter((n) => n.type === "MEASUREMENT").length;
                    const verifyCount = archive.nodes.filter((n) => n.type === "VERIFICATION").length;

                    return (
                      <div
                        key={archive.id}
                        onClick={() => loadFromArchive(archive)}
                        style={{
                          background: "#11141d",
                          border: "1px solid #1d2230",
                          borderRadius: 8,
                          padding: "16px 20px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          transition: "all 0.2s ease",
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 400,
                              color: "#adc6ff",
                            }}
                          >
                            {archive.name}
                          </span>
                          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: "#565d75" }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 12, marginRight: -4, verticalAlign: "middle" }}>calendar_today</span>
                            <span>{date}</span>
                            <span>•</span>
                            <span style={{ color: "#34d399", display: "inline-flex", alignItems: "center", gap: 3 }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 12, verticalAlign: "middle" }}>check_circle</span>
                              <span>{verifyCount} Verify</span>
                            </span>
                            <span style={{ color: "#818cf8", display: "inline-flex", alignItems: "center", gap: 3 }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 12, verticalAlign: "middle" }}>straighten</span>
                              <span>{measureCount} Measure</span>
                            </span>
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 12 }}>
                          <button
                            onClick={(e) => deleteFromArchive(archive.id, e)}
                            style={{
                              background: "rgba(239, 68, 68, 0.1)",
                              border: "1px solid rgba(239, 68, 68, 0.2)",
                              color: "#f87171",
                              borderRadius: 4,
                              fontSize: 10,
                              fontFamily: "'IBM Plex Mono', monospace",
                              padding: "6px 12px",
                              cursor: "pointer",
                              transition: "all 0.2s ease",
                            }}
                          >
                            DELETE
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* YOLO Deploy Toast */}
      {deployToast && (
        <div
          style={{
            position: "fixed",
            bottom: 40,
            right: 40,
            background: "rgba(7, 9, 12, 0.95)",
            backdropFilter: "blur(10px)",
            border: "1px solid #10b981",
            color: "#d4d8e8",
            fontSize: 12,
            padding: "16px 24px",
            borderRadius: 8,
            boxShadow: "0 10px 30px rgba(16, 185, 129, 0.35)",
            zIndex: 600,
            maxWidth: 400,
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ color: "#34d399", fontWeight: 400 }}>✓ COMPLIANCE SYSTEM READY</span>
            <span>{deployToast}</span>
          </div>
        </div>
      )}

      {/* Screen-Centered Global Validation Banner */}
      <ValidationBanner
        errors={validationErrors}
        onDismiss={() => setValidationErrors([])}
      />
    </div>
  );
}
