/* eslint-disable */
"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import WorkflowStatusCard from "@/components/WorkflowStatusCard";
import MaterialVerificationPanel from "@/components/MaterialVerificationPanel";
import WeightMonitorPanel from "@/components/WeightMonitorPanel";
import CVStatusPanel from "@/components/CVStatusPanel";
import EventLogPanel from "@/components/EventLogPanel";
import DeviationAlert from "@/components/DeviationAlert";

const API = "http://localhost:3000";

interface SopNode { id:string; type:"VERIFICATION"|"MEASUREMENT"|"DECISION_BRANCH"; title:string; config:Record<string,any>; }
interface RunStatus {
  run_id:string; sop_id:string; status:string;
  current_step:string|null; completed_steps:string[]; deviations:any[];
  nodes:SopNode[]; yoloState:any|null; weightState:any|null;
}
interface RunEvent { id:string; eventType:string; payload:any; validationResult:string; timestamp:string; }

export default function RunDashboard() {
  const params = useParams();
  const router = useRouter();
  const runId = params?.id as string;

  const [status, setStatus] = useState<RunStatus|null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [sessionStart] = useState(Date.now());
  const [sessionTime, setSessionTime] = useState("00:00");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API}/runs/${runId}/status`);
      if (!r.ok) { setError(`Run not found (${r.status})`); return; }
      setStatus(await r.json());
      setError(null);
    } catch { setError("Backend offline — is sop-engine running?"); }
    finally { setLoading(false); }
  }, [runId]);

  const fetchEvents = useCallback(async () => {
    try {
      const r = await fetch(`${API}/runs/${runId}/events`);
      if (r.ok) setEvents(await r.json());
    } catch {}
  }, [runId]);

  useEffect(() => { fetchStatus(); fetchEvents(); }, [fetchStatus, fetchEvents]);
  useEffect(() => { const t = setInterval(fetchStatus, 1500); return ()=>clearInterval(t); }, [fetchStatus]);
  useEffect(() => { const t = setInterval(fetchEvents, 3000); return ()=>clearInterval(t); }, [fetchEvents]);
  useEffect(() => {
    const t = setInterval(()=>{
      const s = Math.floor((Date.now()-sessionStart)/1000);
      setSessionTime(`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`);
    },1000);
    return ()=>clearInterval(t);
  },[sessionStart]);

  const currentNode = status?.nodes?.find(n=>n.id===status.current_step) ?? null;
  const isComplete = status?.status==="COMPLETED";
  const hasDeviations = (status?.deviations?.length??0)>0;
  const currentYoloClass = currentNode?.config?.yolo_class_name ?? null;

  // Find the last completed measurement event to get its final weight
  const lastMeasurementEvent = [...events]
    .reverse()
    .find(e => 
      e.eventType === 'EXECUTE_STEP' && 
      e.validationResult === 'PASS' && 
      (e.payload?.final_weight !== undefined || e.payload?.value !== undefined)
    );

  const lastFinalWeight = lastMeasurementEvent
    ? (lastMeasurementEvent.payload?.final_weight ?? lastMeasurementEvent.payload?.value ?? null)
    : null;


  // Find the nearest preceding VERIFICATION step to know what material is being measured
  const precedingVerificationNode = (() => {
    if (!currentNode || !status?.nodes) return null;
    const incomingEdge = status.nodes.find(n => 
      n.type === "VERIFICATION" && 
      Array.isArray(n.config.next_nodes) && 
      n.config.next_nodes.includes(currentNode.id)
    );
    if (incomingEdge) return incomingEdge;
    const curIdx = status.nodes.findIndex(n => n.id === currentNode.id);
    if (curIdx > 0) {
      for (let i = curIdx - 1; i >= 0; i--) {
        if (status.nodes[i].type === "VERIFICATION") return status.nodes[i];
      }
    }
    return null;
  })();

  const targetYoloClass = precedingVerificationNode?.config?.yolo_class_name ?? precedingVerificationNode?.config?.entity_name ?? null;

  if (loading) return (
    <div style={{ minHeight:"100vh", background:"#060810", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ fontFamily:"'IBM Plex Mono',monospace", color:"#2dd4a0", fontSize:14 }}>Connecting to run engine...</div>
    </div>
  );

  if (error && !status) return (
    <div style={{ minHeight:"100vh", background:"#060810", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ fontFamily:"'IBM Plex Mono',monospace", color:"#ef4444", fontSize:13, textAlign:"center", lineHeight:2 }}>{error}</div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"#060810", color:"#d4d8e8", fontFamily:"'DM Sans',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background:"#090a0f", borderBottom:"1px solid #1c2130", padding:"0 32px", height:50, display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:24 }}>
          <button onClick={()=>router.push("/")} style={{ background:"none", border:"none", color:"#4b5563", cursor:"pointer", fontSize:12, fontFamily:"'IBM Plex Mono',monospace", padding:0 }}>← SOP CANVAS</button>
          <span style={{ color:"#2a2f3d" }}>|</span>
          <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:600, color:"#d4d8e8", letterSpacing:".06em" }}>EXECUTION CONSOLE</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:20 }}>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, color:"#4b5563", textTransform:"uppercase", marginBottom:2 }}>Run ID</div>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"#8890a8" }}>{runId?.slice(0,8)}...</div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, color:"#4b5563", textTransform:"uppercase", marginBottom:2 }}>SOP</div>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"#8890a8" }}>{status?.sop_id ?? "—"}</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:6, background:isComplete?"#0a1020":hasDeviations?"#1a0808":"#0a2620", border:`1px solid ${isComplete?"#3b82f6":hasDeviations?"#7f1d1d":"#1a4a38"}`, borderRadius:5, padding:"4px 12px" }}>
            <span style={{ width:6, height:6, borderRadius:"50%", background:isComplete?"#3b82f6":hasDeviations?"#ef4444":"#10b981", animation:(!isComplete&&!hasDeviations)?"pulse-h 1.5s infinite":"none" }} />
            <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, fontWeight:600, color:isComplete?"#60a5fa":hasDeviations?"#ef4444":"#2dd4a0" }}>{isComplete?"COMPLETED":hasDeviations?"DEVIATION":"ACTIVE"}</span>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, color:"#4b5563", textTransform:"uppercase" }}>Session</div>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:14, fontWeight:600, color:"#d4d8e8" }}>{sessionTime}</div>
          </div>
          {status && (
            <button onClick={()=>router.push(`/runs/${runId}/report`)}
              style={{ background:"linear-gradient(135deg,#1a1030,#0a1830)", border:"1px solid #4b5563", borderRadius:6, color:"#8890a8", padding:"6px 14px", fontSize:10, cursor:"pointer", fontFamily:"'IBM Plex Mono',monospace", letterSpacing:".06em", textTransform:"uppercase" }}>
              View Report
            </button>
          )}
        </div>
      </div>

      {/* Deviation banner */}
      {(status?.deviations?.length??0)>0&&(
        <div style={{ padding:"10px 32px 0" }}>
          <DeviationAlert deviations={status!.deviations} nodes={status!.nodes??[]} />
        </div>
      )}

      {/* WORKFLOW COMPLETE banner */}
      {isComplete&&(
        <div style={{ margin:"20px 32px 0", background:"#0a1020", border:"1px solid #3b82f6", borderRadius:10, padding:"20px 24px", textAlign:"center" }}>
          <div style={{ fontSize:28, color:"#3b82f6", marginBottom:8 }}>✓</div>
          <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:14, fontWeight:700, color:"#60a5fa", letterSpacing:".1em" }}>WORKFLOW COMPLETE</div>
          <div style={{ fontSize:12, color:"#3a4055", marginTop:6 }}>All SOP steps have been validated. See event log for full audit trail.</div>
          <button onClick={()=>router.push(`/runs/${runId}/report`)}
            style={{ marginTop:14, background:"#3b82f6", border:"none", borderRadius:6, color:"#fff", padding:"9px 24px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'IBM Plex Mono',monospace" }}>
            Generate Compliance Report →
          </button>
        </div>
      )}

      {/* Main grid */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, padding:"16px 32px 32px", maxWidth:1400, margin:"0 auto" }}>
        {/* Left column */}
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <WorkflowStatusCard
            currentStepId={status?.current_step??null}
            completedSteps={status?.completed_steps??[]}
            nodes={status?.nodes??[]}
            deviations={status?.deviations??[]}
            status={status?.status??"ACTIVE"}
          />

          {/* Active step panel */}
          {currentNode?.type==="VERIFICATION"&&!isComplete&&(
            <MaterialVerificationPanel
              key={currentNode.id}
              expectedEntity={currentNode.config.entity_name}
              expectedYoloClass={currentYoloClass}
              detectedObjects={status?.yoloState?.detectedObjects ?? []}
              runId={runId}
              onEventSent={()=>{ setTimeout(()=>{ fetchStatus(); fetchEvents(); }, 500); }}
            />
          )}
          {currentNode?.type==="MEASUREMENT"&&!isComplete&&(
            <WeightMonitorPanel
              key={currentNode.id}
              targetValue={currentNode.config.target_value}
              tolerancePositive={currentNode.config.tolerance_positive}
              toleranceNegative={currentNode.config.tolerance_negative}
              unit={currentNode.config.unit}
              weightState={status?.weightState ?? { currentWeight:null, initialWeight:null, unit:"g", ocrConfidence:0 }}
              runId={runId}
              onEventSent={()=>{ setTimeout(()=>{ fetchStatus(); fetchEvents(); }, 500); }}
              lastFinalWeight={lastFinalWeight}
              detectedObjects={status?.yoloState?.detectedObjects ?? []}
              processActivity={status?.yoloState?.processActivity ?? "UNKNOWN"}
              targetYoloClass={targetYoloClass}
            />
          )}


          <EventLogPanel events={events} />
        </div>

        {/* Right column */}
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <CVStatusPanel
            yoloState={status?.yoloState??null}
            expectedContainer={currentNode?.type==="VERIFICATION" ? currentYoloClass : null}
          />
        </div>
      </div>

      <style>{`@keyframes pulse-h{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  );
}
