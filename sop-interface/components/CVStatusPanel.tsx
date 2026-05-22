"use client";
import React, { useState } from "react";

interface YoloState { peopleCount:number; secondVerifier:boolean; ppeStatus:"PASS"|"FAIL"|"UNKNOWN"; stationOccupied:boolean; processActivity:string; detectedObjects:string[]; updatedAt?:string; }
interface CVStatusPanelProps { yoloState: YoloState | null; expectedContainer?: string | null; }


function Tile({ label, value, pass, warn }: { label:string; value:string; pass?:boolean; warn?:boolean }) {
  const color = pass?"#2dd4a0":warn?"#f59e0b":"#ef4444";
  const bg = pass?"#0a2620":warn?"#1a1200":"#1a0808";
  const border = pass?"#1a4a38":warn?"#4a3600":"#6b2230";
  return (
    <div style={{ background:bg, border:`1px solid ${border}`, borderRadius:8, padding:"14px 16px", display:"flex", flexDirection:"column", gap:6 }}>
      <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, color:"#4b5563", textTransform:"uppercase", letterSpacing:".1em" }}>{label}</span>
      <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:16, fontWeight:700, color }}>{value}</span>
    </div>
  );
}

export default function CVStatusPanel({ yoloState, expectedContainer }: CVStatusPanelProps) {
  const [imgError, setImgError] = useState(false);
  const offline = yoloState === null;
  const updatedAt = yoloState?.updatedAt ? new Date(yoloState.updatedAt).toLocaleTimeString() : null;
  const containerDetected = expectedContainer && yoloState
    ? yoloState.detectedObjects.map(o => o.toLowerCase()).includes(expectedContainer.toLowerCase())
    : false;

  return (
    <div style={{ background:"#0e1117", border:"1px solid #1c2130", borderRadius:10, padding:"18px 20px", fontFamily:"'DM Sans',sans-serif", display:"flex", flexDirection:"column", gap:14 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, fontWeight:600, color:"#4b5563", letterSpacing:".1em", textTransform:"uppercase" }}>CV Status — YOLO</span>
        {updatedAt&&<span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, color:"#3a4055" }}>Updated {updatedAt}</span>}
      </div>

      {offline&&<div style={{ background:"#1a1200", border:"1px solid #4a3600", borderRadius:6, padding:"10px 14px", fontFamily:"'IBM Plex Mono',monospace", fontSize:11, color:"#f59e0b" }}>⚠ CV SERVICE OFFLINE — start sop-cv-service</div>}

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
        <Tile label="People Present" value={offline?"—":String(yoloState!.peopleCount)} pass={!offline&&yoloState!.peopleCount>=1} warn={offline} />
        <Tile label="Second Verifier" value={offline?"—":yoloState!.secondVerifier?"YES":"NO"} pass={!offline&&yoloState!.secondVerifier} warn={offline} />
        <Tile label="PPE Status" value={offline?"—":yoloState!.ppeStatus} pass={!offline&&yoloState!.ppeStatus==="PASS"} warn={!offline&&yoloState!.ppeStatus==="UNKNOWN"} />
        <Tile label="Station" value={offline?"—":yoloState!.stationOccupied?"OCCUPIED":"EMPTY"} pass={!offline&&yoloState!.stationOccupied} warn={offline} />
      </div>

      {!offline&&(
        <>
          <div style={{ background:"#090a0f", border:"1px solid #1c2130", borderRadius:6, padding:"10px 14px", display:"flex", alignItems:"center", gap:12 }}>
            <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, color:"#4b5563", textTransform:"uppercase" }}>Activity</span>
            <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:12, fontWeight:600, color:["IDLE","UNKNOWN"].includes(yoloState!.processActivity)?"#3a4055":"#f59e0b" }}>{yoloState!.processActivity}</span>
            {yoloState!.detectedObjects.length>0&&<><span style={{ color:"#1c2130" }}>|</span><span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11, color:"#8890a8" }}>{yoloState!.detectedObjects.join(", ")}</span></>}
          </div>
          {expectedContainer && (
            <div style={{ background: containerDetected?"#0a2620":"#0d0f14", border:`1px solid ${containerDetected?"#1a4a38":"#1c2130"}`, borderRadius:6, padding:"10px 14px", display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:14, color: containerDetected?"#2dd4a0":"#3a4055" }}>{containerDetected?"✓":"○"}</span>
              <div>
                <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, color:"#4b5563", textTransform:"uppercase", letterSpacing:".08em", marginBottom:3 }}>Expected Container</div>
                <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:12, fontWeight:600, color: containerDetected?"#2dd4a0":"#565d75" }}>
                  {expectedContainer} — {containerDetected?"DETECTED IN FRAME":"NOT DETECTED"}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div style={{ borderRadius:8, overflow:"hidden", border:"1px solid #1c2130", background:"#060810" }}>
        <div style={{ padding:"6px 10px", background:"#090a0f", borderBottom:"1px solid #1c2130", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:"#4b5563", textTransform:"uppercase" }}>Live Camera</span>
          <span style={{ fontSize:8, fontFamily:"'IBM Plex Mono',monospace", color:imgError?"#f59e0b":"#2dd4a0", background:imgError?"#1a1200":"#0a2620", border:`1px solid ${imgError?"#4a3600":"#1a4a38"}`, padding:"1px 6px", borderRadius:2 }}>{imgError?"STREAM OFFLINE":"● LIVE"}</span>
        </div>
        {!imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="http://localhost:8001/video_feed" alt="YOLO live feed" style={{ width:"100%", display:"block", maxHeight:360, objectFit:"contain", background:"#000" }} onError={()=>setImgError(true)} />
        ) : (
          <div style={{ height:160, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:8 }}>
            <span style={{ fontSize:28, opacity:0.3 }}>📷</span>
            <span style={{ fontSize:11, color:"#3a4055", fontFamily:"'IBM Plex Mono',monospace" }}>CV service not running</span>
          </div>
        )}
      </div>
    </div>
  );
}
