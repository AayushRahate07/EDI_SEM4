/* eslint-disable */
"use client";
import React, { useEffect, useRef } from "react";

interface RunEvent { id:string; eventType:string; payload:any; validationResult:string; timestamp:string; }
interface EventLogPanelProps { events: RunEvent[]; }

const STYLES: Record<string,{bg:string;border:string;color:string;label:string}> = {
  STEP_SUCCESS:        {bg:"#0a2620",border:"#1a4a38",color:"#2dd4a0",label:"PASS"},
  DEVIATION_TRIGGERED: {bg:"#1a0808",border:"#6b2230",color:"#ef4444",label:"DEVIATION"},
  EXECUTE_STEP:        {bg:"#1a1200",border:"#4a3600",color:"#f59e0b",label:"EXECUTE"},
};

function fmt(ts:string){try{return new Date(ts).toLocaleTimeString("en-GB",{hour12:false})}catch{return "??"}}

function describe(e:RunEvent):string {
  if(e.eventType==="STEP_SUCCESS") return "Step validated and completed";
  if(e.eventType==="DEVIATION_TRIGGERED") return "Deviation: input out of bounds";
  if(e.eventType==="EXECUTE_STEP"){
    if(e.payload?.verified_entity) return `Scan: ${e.payload.verified_entity}`;
    if(e.payload?.value!==undefined) return `Weight: ${e.payload.value}`;
    return "Step execution attempted";
  }
  return JSON.stringify(e.payload).slice(0,60);
}

export default function EventLogPanel({ events }: EventLogPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(()=>{ if(ref.current) ref.current.scrollTop=ref.current.scrollHeight; }, [events.length]);

  return (
    <div style={{ background:"#0e1117", border:"1px solid #1c2130", borderRadius:10, overflow:"hidden", fontFamily:"'IBM Plex Mono',monospace", display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"12px 18px", background:"#090a0f", borderBottom:"1px solid #1c2130", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontSize:10, fontWeight:600, color:"#4b5563", letterSpacing:".1em", textTransform:"uppercase" }}>Audit Event Log</span>
        <span style={{ fontSize:9, color:"#3a4055" }}>{events.length} event{events.length!==1?"s":""}</span>
      </div>
      <div ref={ref} style={{ flex:1, overflowY:"auto", maxHeight:260, padding:"6px 0", background:"#060810" }}>
        {events.length===0 ? (
          <div style={{ padding:"30px 20px", textAlign:"center", fontSize:11, color:"#3a4055" }}>No events yet. Start executing workflow steps.</div>
        ) : events.map((e,i)=>{
          const s = STYLES[e.eventType]||{bg:"#0d0f14",border:"#1c2130",color:"#565d75",label:e.eventType.slice(0,6)};
          return (
            <div key={e.id||i} style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"5px 14px", borderLeft:`2px solid ${s.border}`, marginLeft:4 }}>
              <span style={{ fontSize:10, color:"#3a4055", flexShrink:0, paddingTop:1 }}>[{fmt(e.timestamp)}]</span>
              <span style={{ fontSize:8, fontWeight:600, padding:"2px 5px", borderRadius:2, background:s.bg, border:`1px solid ${s.border}`, color:s.color, flexShrink:0 }}>{s.label}</span>
              <span style={{ fontSize:10, color:"#8890a8", lineHeight:1.5 }}>{describe(e)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
