"use client";
import React, { useState } from "react";

interface Deviation { stepId:string; issue:string; timestamp:string; }
interface DeviationAlertProps { deviations:Deviation[]; nodes:Array<{id:string;title:string}>; }

export default function DeviationAlert({ deviations, nodes }: DeviationAlertProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = deviations.filter(d=>!dismissed.has(d.timestamp));
  if(visible.length===0) return null;
  const latest = visible[visible.length-1];
  const node = nodes.find(n=>n.id===latest.stepId);
  const fmt = (ts:string)=>{try{return new Date(ts).toLocaleTimeString("en-GB",{hour12:false})}catch{return ts}};

  return (
    <div style={{ background:"#1a0a0a", border:"1px solid #7f1d1d", borderLeft:"4px solid #ef4444", borderRadius:8, padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:16, fontFamily:"'DM Sans',sans-serif", animation:"dev-pulse 2s ease-in-out infinite" }}>
      <div style={{ display:"flex", alignItems:"center", gap:14 }}>
        <span style={{ fontSize:22, color:"#ef4444", flexShrink:0 }}>⚠</span>
        <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700, color:"#ef4444", letterSpacing:".1em", textTransform:"uppercase" }}>Deviation Detected</span>
            {visible.length>1&&<span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, color:"#f87171", background:"#2d0a0a", border:"1px solid #7f1d1d", padding:"1px 6px", borderRadius:3 }}>+{visible.length-1} more</span>}
          </div>
          <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
            <span style={{ fontSize:12, color:"#fca5a5" }}>{latest.issue}</span>
            {node&&<span style={{ fontSize:12, color:"#565d75" }}>Step: <span style={{ color:"#8890a8" }}>{node.title}</span></span>}
            <span style={{ fontSize:11, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace" }}>{fmt(latest.timestamp)}</span>
          </div>
        </div>
      </div>
      <button onClick={()=>setDismissed(prev=>new Set([...prev,latest.timestamp]))}
        style={{ background:"rgba(127,29,29,0.3)", border:"1px solid #7f1d1d", color:"#fca5a5", borderRadius:5, padding:"6px 14px", fontSize:10, fontWeight:600, fontFamily:"'IBM Plex Mono',monospace", cursor:"pointer", letterSpacing:".06em", textTransform:"uppercase", flexShrink:0 }}>
        Acknowledge
      </button>
      <style>{`@keyframes dev-pulse{0%,100%{border-left-color:#ef4444}50%{border-left-color:#7f1d1d}}`}</style>
    </div>
  );
}
