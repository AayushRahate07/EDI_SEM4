"use client";
import React, { useState } from "react";

interface YoloState {
  peopleCount: number;
  secondVerifier: boolean;
  ppeStatus: "PASS" | "FAIL" | "UNKNOWN";
  ppeGloves?: "PASS" | "FAIL" | "UNKNOWN";
  stationOccupied: boolean;
  processActivity: string;
  detectedObjects: string[];
  cam2Online?: boolean;
  updatedAt?: string;
}
interface CVStatusPanelProps {
  yoloState: YoloState | null;
  expectedContainer?: string | null;
}

function Tile({ label, value, pass, warn, sub }: { label: string; value: string; pass?: boolean; warn?: boolean; sub?: string }) {
  const color  = pass ? "#2dd4a0" : warn ? "#f59e0b" : "#ef4444";
  const bg     = pass ? "#0a2620" : warn ? "#1a1200" : "#1a0808";
  const border = pass ? "#1a4a38" : warn ? "#4a3600" : "#6b2230";
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: "#4b5563", textTransform: "uppercase", letterSpacing: ".1em" }}>{label}</span>
      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, fontWeight: 700, color }}>{value}</span>
      {sub && <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: "#3a4055" }}>{sub}</span>}
    </div>
  );
}

function CameraFeed({ url, label, badge, cam2 }: { url: string; label: string; badge?: string; cam2?: boolean }) {
  const [err, setErr] = useState(false);
  const accentColor = cam2 ? "#f59e0b" : "#2dd4a0";
  const accentBg    = cam2 ? "#1a1200" : "#0a2620";
  const accentBorder = cam2 ? "#4a3600" : "#1a4a38";
  return (
    <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid #1c2130", background: "#060810" }}>
      <div style={{ padding: "5px 10px", background: "#090a0f", borderBottom: "1px solid #1c2130", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: "#4b5563", textTransform: "uppercase" }}>{label}</span>
        <span style={{ fontSize: 8, fontFamily: "'IBM Plex Mono',monospace", color: err ? "#f59e0b" : accentColor, background: err ? "#1a1200" : accentBg, border: `1px solid ${err ? "#4a3600" : accentBorder}`, padding: "1px 6px", borderRadius: 2 }}>
          {err ? "OFFLINE" : (badge ?? "● LIVE")}
        </span>
      </div>
      {!err ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} style={{ width: "100%", display: "block", maxHeight: 180, objectFit: "cover" }} onError={() => setErr(true)} />
      ) : (
        <div style={{ height: 140, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 24, opacity: 0.3 }}>📷</span>
          <span style={{ fontSize: 10, color: "#3a4055", fontFamily: "'IBM Plex Mono',monospace" }}>{cam2 ? "Phone IP cam offline" : "CV service not running"}</span>
        </div>
      )}
    </div>
  );
}

export default function CVStatusPanel({ yoloState, expectedContainer }: CVStatusPanelProps) {
  const offline   = yoloState === null;
  const updatedAt = yoloState?.updatedAt ? new Date(yoloState.updatedAt).toLocaleTimeString() : null;
  const cam2Online = yoloState?.cam2Online ?? false;

  const containerDetected = expectedContainer && yoloState
    ? yoloState.detectedObjects.map(o => o.toLowerCase()).includes(expectedContainer.toLowerCase())
    : false;

  const gloves      = yoloState?.ppeGloves ?? "UNKNOWN";
  const glovesLabel = gloves === "PASS" ? "DETECTED ✓" : gloves === "FAIL" ? "BARE HANDS ✗" : "UNKNOWN";

  return (
    <div style={{ background: "#0e1117", border: "1px solid #1c2130", borderRadius: 10, padding: "18px 20px", fontFamily: "'DM Sans',sans-serif", display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, fontWeight: 600, color: "#4b5563", letterSpacing: ".1em", textTransform: "uppercase" }}>CV Status — YOLO</span>
          {!offline && (
            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8, color: cam2Online ? "#f59e0b" : "#3a4055", background: cam2Online ? "#1a1200" : "#0d0f14", border: `1px solid ${cam2Online ? "#4a3600" : "#1c2130"}`, padding: "1px 6px", borderRadius: 2 }}>
              {cam2Online ? "● CAM2 DESK ONLINE" : "○ CAM2 OFFLINE"}
            </span>
          )}
        </div>
        {updatedAt && <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: "#3a4055" }}>Updated {updatedAt}</span>}
      </div>

      {offline && <div style={{ background: "#1a1200", border: "1px solid #4a3600", borderRadius: 6, padding: "10px 14px", fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#f59e0b" }}>⚠ CV SERVICE OFFLINE — start sop-cv-service</div>}

      {/* PPE + People grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Tile label="People Present"  value={offline ? "—" : String(yoloState!.peopleCount)}          pass={!offline && yoloState!.peopleCount >= 1} warn={offline} />
        <Tile label="Second Verifier" value={offline ? "—" : yoloState!.secondVerifier ? "YES" : "NO"} pass={!offline && yoloState!.secondVerifier} warn={offline} />
        <Tile label="PPE (Coat+Mask)" value={offline ? "—" : yoloState!.ppeStatus}                    pass={!offline && yoloState!.ppeStatus === "PASS"} warn={!offline && yoloState!.ppeStatus === "UNKNOWN"} sub="cam1" />
        <Tile label="Gloves"          value={offline ? "—" : glovesLabel}                              pass={!offline && gloves === "PASS"} warn={!offline && gloves === "UNKNOWN"} sub={cam2Online ? "cam2" : "cam2 offline"} />
        <Tile label="Station"         value={offline ? "—" : yoloState!.stationOccupied ? "OCCUPIED" : "EMPTY"} pass={!offline && yoloState!.stationOccupied} warn={offline} />
      </div>

      {/* Activity + objects row */}
      {!offline && (
        <>
          <div style={{ background: "#090a0f", border: "1px solid #1c2130", borderRadius: 6, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: "#4b5563", textTransform: "uppercase" }}>Activity</span>
            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, fontWeight: 600, color: ["IDLE", "UNKNOWN"].includes(yoloState!.processActivity) ? "#3a4055" : "#f59e0b" }}>{yoloState!.processActivity}</span>
            {yoloState!.detectedObjects.length > 0 && <>
              <span style={{ color: "#1c2130" }}>|</span>
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#8890a8" }}>{yoloState!.detectedObjects.join(", ")}</span>
            </>}
          </div>

          {/* Expected container row */}
          {expectedContainer && (
            <div style={{ background: containerDetected ? "#0a2620" : "#0d0f14", border: `1px solid ${containerDetected ? "#1a4a38" : "#1c2130"}`, borderRadius: 6, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 14, color: containerDetected ? "#2dd4a0" : "#3a4055" }}>{containerDetected ? "✓" : "○"}</span>
              <div>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: "#4b5563", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 3 }}>Expected Container</div>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, fontWeight: 600, color: containerDetected ? "#2dd4a0" : "#565d75" }}>
                  {expectedContainer} — {containerDetected ? "DETECTED IN FRAME" : "NOT DETECTED"}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Camera feeds */}
      <div style={{ display: "grid", gridTemplateColumns: cam2Online ? "1fr 1fr" : "1fr", gap: 8 }}>
        {!offline && (
          <CameraFeed url="http://localhost:8001/video_feed"  label="Live Camera — Cam1 (Operator)" />
        )}
        {cam2Online && (
          <CameraFeed url="http://localhost:8001/video_feed2" label="Live Camera — Cam2 (Desk)" badge="● LIVE" cam2 />
        )}
      </div>
    </div>
  );
}
