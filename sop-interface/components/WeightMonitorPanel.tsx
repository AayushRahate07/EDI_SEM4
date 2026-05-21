"use client";
import React, { useState } from "react";

interface WeightState { currentWeight:number|null; initialWeight:number|null; unit:string; ocrConfidence:number; updatedAt?:string; }
interface WeightMonitorPanelProps { targetValue:number; tolerancePositive:number; toleranceNegative:number; unit:string; weightState:WeightState; runId:string; onEventSent?:()=>void; }

export default function WeightMonitorPanel({ targetValue, tolerancePositive, toleranceNegative, unit, weightState, runId, onEventSent }: WeightMonitorPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [captured, setCaptured] = useState(false);
  const [manualInput, setManualInput] = useState("");

  const { currentWeight: ocrWeight, initialWeight, ocrConfidence } = weightState;
  const manualWeight = manualInput !== "" ? parseFloat(manualInput) : null;
  const currentWeight = (manualWeight !== null && !isNaN(manualWeight)) ? manualWeight : ocrWeight;
  const isManualMode = manualWeight !== null && !isNaN(manualWeight);

  const lowerBound = targetValue - toleranceNegative;
  const upperBound = targetValue + tolerancePositive;
  const delta = currentWeight !== null && initialWeight !== null ? currentWeight - initialWeight : null;
  const passCheck = currentWeight !== null ? currentWeight >= lowerBound && currentWeight <= upperBound : null;
  const confColor = ocrConfidence >= 90 ? "#2dd4a0" : ocrConfidence >= 70 ? "#f59e0b" : "#ef4444";
  const fmt = (w:number|null) => w!==null ? `${w.toFixed(2)}${unit}` : "—";
  const deltaStr = delta !== null ? `${delta>=0?"+":""}${delta.toFixed(2)}${unit}` : "—";

  const handleCapture = async () => {
    if (currentWeight === null || isNaN(currentWeight)) return;
    setLoading(true); setError(null);
    try {
      await fetch(`http://localhost:3000/runs/${runId}/events`, { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ type:"EXECUTE_STEP", payload:{ value: currentWeight } }) });
      setCaptured(true); onEventSent?.();
    } catch { setError("Failed to send to backend."); } finally { setLoading(false); }
  };

  return (
    <div style={{ background:"#0e1117", border:"1px solid #1c2130", borderRadius:10, padding:"18px 20px", fontFamily:"'DM Sans',sans-serif", display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, fontWeight:600, color:"#4b5563", letterSpacing:".1em", textTransform:"uppercase" }}>Weight Monitor</span>
        <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, color: isManualMode?"#f59e0b":"#4da6ff", background:isManualMode?"#1a1200":"#0a1830", border:`1px solid ${isManualMode?"#4a3600":"#1a3060"}`, padding:"2px 7px", borderRadius:3 }}>
          {isManualMode?"MANUAL OVERRIDE":"LIVE OCR"}
        </span>
      </div>

      {/* Big weight display */}
      <div style={{ background:"#090a0f", border:"1px solid #1c2130", borderRadius:8, padding:"18px 20px", textAlign:"center" }}>
        <div style={{ fontSize:10, fontFamily:"'IBM Plex Mono',monospace", color:"#4b5563", textTransform:"uppercase", letterSpacing:".08em", marginBottom:8 }}>Current Reading</div>
        <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:38, fontWeight:600, color:passCheck===true?"#2dd4a0":passCheck===false?"#ef4444":"#d4d8e8", letterSpacing:".06em", transition:"color 0.3s" }}>{fmt(currentWeight)}</div>
        {ocrConfidence>0&&<div style={{ marginTop:8, fontSize:10, color:"#565d75", fontFamily:"'IBM Plex Mono',monospace" }}>OCR: <span style={{ color:confColor }}>{ocrConfidence}%</span></div>}
      </div>

      {/* Metrics grid */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
        {[{l:"Initial",v:fmt(initialWeight),c:"#8890a8"},{l:"Target",v:fmt(targetValue),c:"#d4d8e8"},{l:"Delta",v:deltaStr,c:delta!==null&&delta>=0?"#2dd4a0":"#f59e0b"},
          {l:"Lower",v:fmt(lowerBound),c:"#565d75"},{l:"Upper",v:fmt(upperBound),c:"#565d75"},{l:"Tolerance",v:`±${tolerancePositive}${unit}`,c:"#8890a8"}
        ].map(m=>(
          <div key={m.l} style={{ background:"#0d0f14", border:"1px solid #1c2130", borderRadius:6, padding:"10px 12px" }}>
            <div style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:"#4b5563", textTransform:"uppercase", letterSpacing:".06em", marginBottom:5 }}>{m.l}</div>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:13, fontWeight:600, color:m.c }}>{m.v}</div>
          </div>
        ))}
      </div>

      {/* OCR confidence bar */}
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
          <span style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:"#4b5563", textTransform:"uppercase" }}>OCR Confidence</span>
          <span style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:confColor }}>{ocrConfidence}%</span>
        </div>
        <div style={{ height:4, background:"#1c2130", borderRadius:2, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${ocrConfidence}%`, background:confColor, borderRadius:2, transition:"width 0.3s ease" }} />
        </div>
      </div>

      {/* Pass/fail banner */}
      {passCheck!==null&&(
        <div style={{ background:passCheck?"#0a2620":"#1a0808", border:`1px solid ${passCheck?"#1a4a38":"#6b2230"}`, borderRadius:6, padding:"10px 14px", display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:16, color:passCheck?"#2dd4a0":"#ef4444" }}>{passCheck?"✓":"✗"}</span>
          <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:600, color:passCheck?"#2dd4a0":"#ef4444", letterSpacing:".06em" }}>{passCheck?"WITHIN TOLERANCE — PASS":"OUT OF RANGE — FAIL"}</span>
        </div>
      )}

      {/* Live scale feed */}
      <div style={{ borderRadius:8, overflow:"hidden", border:"1px solid #1c2130", background:"#060810" }}>
        <div style={{ padding:"6px 10px", background:"#090a0f", borderBottom:"1px solid #1c2130", fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:"#4b5563", textTransform:"uppercase" }}>Live Scale Feed</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="http://localhost:8001/video_feed" alt="Scale live feed" style={{ width:"100%", display:"block", maxHeight:160, objectFit:"cover" }} onError={e=>{(e.target as HTMLImageElement).style.display="none";}} />
      </div>

      {/* Manual input */}
      {!captured&&(
        <div style={{ background:"#090a0f", border:"1px solid #242936", borderRadius:8, padding:"14px 16px", display:"flex", flexDirection:"column", gap:8 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:"#4b5563", textTransform:"uppercase", letterSpacing:".08em" }}>Manual Weight Input</span>
            <span style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:isManualMode?"#f59e0b":"#3a4055" }}>{isManualMode?"● MANUAL OVERRIDE":"○ OCR MODE"}</span>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <input id="manual-weight-input" type="number" step="0.01" value={manualInput} onChange={e=>{setManualInput(e.target.value);setCaptured(false);}} placeholder={`Enter weight in ${unit}...`}
              style={{ flex:1, background:"#161922", border:"1px solid #242936", borderRadius:6, padding:"8px 12px", fontSize:13, color:"#d4d8e8", fontFamily:"'IBM Plex Mono',monospace", outline:"none" }} />
            <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:12, color:"#565d75", alignSelf:"center" }}>{unit}</span>
          </div>
        </div>
      )}

      {/* Capture button */}
      {!captured ? (
        <button id="capture-weight-btn" onClick={handleCapture} disabled={loading||currentWeight===null||(!isManualMode&&ocrConfidence<50)}
          style={{ background:"linear-gradient(135deg,#0a1830 0%,#0a2620 100%)", border:"1px solid #10b981", color:"#2dd4a0", borderRadius:6, padding:"10px 0", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"'IBM Plex Mono',monospace", letterSpacing:".08em", textTransform:"uppercase", opacity:(loading||currentWeight===null||(!isManualMode&&ocrConfidence<50))?0.4:1 }}>
          {loading?"Sending...":`Submit ${currentWeight!==null?fmt(currentWeight):"—"} → Engine`}
        </button>
      ) : (
        <div style={{ background:"#0a2620", border:"1px solid #1a4a38", borderRadius:6, padding:"10px 0", textAlign:"center", fontSize:11, color:"#2dd4a0", fontFamily:"'IBM Plex Mono',monospace" }}>
          ✓ Reading submitted — awaiting engine validation
        </div>
      )}
      {error&&<div style={{ fontSize:11, color:"#ef4444", fontFamily:"'IBM Plex Mono',monospace" }}>{error}</div>}
    </div>
  );
}
