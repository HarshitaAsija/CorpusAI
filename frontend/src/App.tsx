import React, { useState, useEffect, useRef } from 'react';
import { Play, Award, FileText, CheckCircle2, AlertCircle, RefreshCw, MessageSquare, Terminal, ChevronDown, ChevronUp, ExternalLink, AlertTriangle } from 'lucide-react';
import AnimatedBackground from './AnimatedBackground';
import LineageGraph from './components/LineageGraph';
import AnalyticsPanel from './components/AnalyticsPanel';
import ThemeToggle from './components/ThemeToggle';

interface Initiative {
  id: string;
  name: string;
  status: 'Planning' | 'Awaiting Approval' | 'Approved' | 'Rejected' | 'Executing' | 'Done';
  owner: string;
  created: string;
  summary: string;
}

interface Decision {
  id: string;
  title: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  requestedBy: string;
  amount: number;
  reasoningSummary: string;
  initiativeId: string;
  decidedBy?: string;
  decidedAt?: string;
}

interface AgentLog {
  id: string;
  timestamp: string;
  agent: string;
  eventType: string;
  summary: string;
  reasoning: string;
  initiativeId: string;
}

interface ActionItem {
  id?: string;
  title: string;
  tool: 'GitHub' | 'Slack' | 'Calendar' | 'Email';
  link: string;
  performedBy: string;
  initiativeId: string;
  timestamp: string;
}

export default function App() {
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [activeInitiativeId, setActiveInitiativeId] = useState<string | null>(null);
  const [parentPageId, setParentPageId] = useState<string>('');
  const [graphData, setGraphData] = useState<any>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  
  const [goal, setGoal] = useState('Launch a marketing campaign for our new feature, budget capped by company policy.');
  const [owner, setOwner] = useState('John Doe');
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Environment-driven API URLs (defaults to localhost for dev)
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';

  // Auto-scroll terminal to bottom when new logs arrive
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Fetch Parent Page ID configuration
  const fetchConfig = async () => {
    try {
      const res = await fetch(`${API_URL}/api/config`);
      if (res.ok) {
        const data = await res.json();
        setParentPageId(data.parentPageId || '');
      }
    } catch (err) {
      console.error('Failed to fetch parent page ID:', err);
    }
  };

  // Fetch agent logs for a specific initiative
  const fetchLogs = async (initiativeId: string) => {
    try {
      const res = await fetch(`${API_URL}/api/initiatives/${initiativeId}/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  };

  // Fetch real deliverables / actions executed for a specific initiative
  const fetchActions = async (initiativeId?: string) => {
    try {
      const url = initiativeId
        ? `${API_URL}/api/initiatives/${initiativeId}/actions`
        : `${API_URL}/api/actions`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setActions(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch actions:', err);
    }
  };

  // Fetch all initiatives and decisions
  const fetchData = async () => {
    try {
      const initRes = await fetch(`${API_URL}/api/initiatives`);
      const decRes = await fetch(`${API_URL}/api/decisions`);
      
      if (!initRes.ok || !decRes.ok) {
        throw new Error('Server returned an error');
      }

      const initData = await initRes.json();
      const decData = await decRes.json();

      setInitiatives(initData);
      setDecisions(decData);
      
      // Auto-set the active initiative to the most recent one if not set
      if (initData.length > 0 && !activeInitiativeId) {
        setActiveInitiativeId(initData[0].id);
        fetchGraphData(initData[0].id);
        fetchLogs(initData[0].id);
        fetchActions(initData[0].id);
      }
      
      setError(null);
    } catch (err: any) {
      console.error('Failed to poll server:', err);
      setError('Could not connect to the orchestrator server. Make sure it is running.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch graph data for a given initiative
  const fetchGraphData = async (initiativeId: string) => {
    try {
      const res = await fetch(`${API_URL}/api/initiatives/${initiativeId}/graph`);
      if (!res.ok) throw new Error('Failed to fetch graph');
      const data = await res.json();
      setGraphData(data.graph);
    } catch (err) {
      console.error('Graph fetch error:', err);
    }
  };

  // WebSocket for live FSM updates
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => console.log('[WS] Connected to backend');
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'fsm-update' && data.initiativeId === activeInitiativeId) {
          fetchData();
          fetchGraphData(data.initiativeId);
          fetchActions(data.initiativeId);
          if (data.eventType === 'log' && data.log) {
            setLogs(prev => {
              if (prev.some(l => l.id === data.log.id)) return prev;
              return [...prev, data.log].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            });
          } else {
            fetchLogs(data.initiativeId);
          }
        }
      } catch (e) {
        console.warn('Invalid WS message', e);
      }
    };
    ws.onerror = (err) => console.error('[WS] Error', err);
    ws.onclose = () => console.log('[WS] Disconnected');
    return () => ws.close();
  }, [activeInitiativeId]);

  useEffect(() => {
    fetchConfig();
    fetchData();
  }, []);

  useEffect(() => {
    if (activeInitiativeId) {
      fetchLogs(activeInitiativeId);
      fetchGraphData(activeInitiativeId);
      fetchActions(activeInitiativeId);
    }
  }, [activeInitiativeId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/initiatives/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, owner })
      });

      if (!response.ok) {
        throw new Error('Failed to trigger initiative');
      }

      const result = await response.json();
      setActiveInitiativeId(result.initiativeId);
      setGoal('');
      
      if (result.initiativeId) {
        fetchGraphData(result.initiativeId);
        fetchActions(result.initiativeId);
      }
      await fetchData();
    } catch (err: any) {
      setError(err.message || 'Server connection failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <>
        <AnimatedBackground />
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          fontFamily: "'Outfit', sans-serif"
        }}>
          <RefreshCw className="spin" size={48} style={{ animation: 'spin 2s linear infinite', color: 'var(--accent-indigo)' }} />
          <span style={{ marginTop: '16px', fontSize: '1.2rem', fontWeight: 500 }}>Initializing CorpusAI...</span>
        </div>
      </>
    );
  }

  const activeInitiative = initiatives.find(i => i.id === activeInitiativeId);
  const activeDecisions = decisions.filter(d => d.initiativeId === activeInitiativeId);
  const totalDecisionsCount = decisions.length;
  const autoApprovedCount = decisions.filter(d => d.title.includes('(Auto-Approved)')).length;
  const autonomyRate = totalDecisionsCount > 0 ? Math.round((autoApprovedCount / totalDecisionsCount) * 100) : 0;

  const getTimelineStep = (status: string | undefined): number => {
    if (!status) return 0;
    switch (status) {
      case 'Planning': return 1;
      case 'Awaiting Approval': return 2;
      case 'Approved':
      case 'Executing': return 3;
      case 'Done': return 4;
      default: return 0;
    }
  };

  const currentStep = getTimelineStep(activeInitiative?.status);

  return (
    <>
      <AnimatedBackground />
      <div className="dashboard-container">
        {/* Header */}
        <div className="header">
          <div className="header-title">
            <h1>CorpusAI</h1>
            <p>Multi-Agent Corporation Orchestrator Dashboard</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button 
              className="notion-link-btn"
              onClick={() => {
                window.open(`https://notion.so/${parentPageId}`, '_blank');
              }}
              disabled={!parentPageId}
            >
              <FileText size={18} />
              Open Notion Workspace
            </button>
            <ThemeToggle />
          </div>
        </div>

        {error && (
          <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--accent-red)', padding: '1rem', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#fca5a5' }}>
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}

        {/* Main Content Grid */}
        <div className="main-grid">
          {/* Left Column: Forms, Autonomy & Analytics */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* Kickoff Form */}
            <div className="glass-card">
              <h2 className="card-title">
                <Play size={20} color="#3b82f6" />
                Launch New Initiative
              </h2>
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label>Company Goal / Objective</label>
                  <textarea 
                    className="form-textarea" 
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="Enter goal for the company agents..."
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Initiator Name (Owner)</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    required
                  />
                </div>
                <button className="submit-btn" type="submit" disabled={submitting}>
                  <RefreshCw size={18} className={submitting ? 'spin' : ''} style={{ display: submitting ? 'inline' : 'none' }} />
                  {submitting ? 'Triggering Agents...' : 'Kick Off Goal'}
                </button>
              </form>
            </div>

            {/* System Autonomy Rate */}
            <div className="glass-card">
              <h2 className="card-title">
                <Award size={20} color="var(--accent-green)" />
                System Autonomy Rate
              </h2>
              <div className="autonomy-stats">
                <div className="autonomy-score-container">
                  <div className="autonomy-circle">
                    <span className="autonomy-percent">{autonomyRate}%</span>
                    <span className="autonomy-label">Autonomous</span>
                  </div>
                </div>
                <div className="autonomy-history-list">
                  <div className="autonomy-history-item">
                    <span>Total Decisions</span>
                    <span style={{ fontWeight: 600 }}>{totalDecisionsCount}</span>
                  </div>
                  <div className="autonomy-history-item">
                    <span>Auto-Approved</span>
                    <span className="success">{autoApprovedCount}</span>
                  </div>
                  <div className="autonomy-history-item">
                    <span>Requires Human Sign-off</span>
                    <span className="pending">{totalDecisionsCount - autoApprovedCount}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Analytics Panel */}
            <AnalyticsPanel />
          </div>

          {/* Right Column: State View & Log */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* Active Status & FSM Visualization */}
            {activeInitiative ? (
              <div className="glass-card">
                <h2 className="card-title">
                  <CheckCircle2 size={20} color="#6366f1" />
                  Active Initiative State Machine
                </h2>
                <div style={{ marginBottom: '1.5rem' }}>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 600 }}>{activeInitiative.name}</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    Owner: {activeInitiative.owner} | Started: {new Date(activeInitiative.created).toLocaleString()}
                  </p>
                </div>

                {/* Lineage Graph */}
                {graphData && (
                  <div style={{ marginBottom: '2rem' }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>D3 Agent Lineage Graph:</h4>
                    <LineageGraph data={graphData} activeStatus={activeInitiative.status} />
                  </div>
                )}

                {/* Steps Visualizer */}
                <div className="fsm-timeline">
                  <div className={`fsm-node ${currentStep >= 1 ? (currentStep === 1 ? 'active' : 'completed') : ''}`}>
                    <div className="fsm-dot">1</div>
                    <span className="fsm-label">Marketing</span>
                  </div>
                  <div className={`fsm-node ${currentStep >= 2 ? (currentStep === 2 ? 'active' : 'completed') : ''}`}>
                    <div className="fsm-dot">2</div>
                    <span className="fsm-label">Finance</span>
                  </div>
                  <div className={`fsm-node ${currentStep >= 3 ? (currentStep === 3 ? 'active' : 'completed') : ''}`}>
                    <div className="fsm-dot">3</div>
                    <span className="fsm-label">Sign-off</span>
                  </div>
                  <div className={`fsm-node ${currentStep >= 4 ? (currentStep === 4 ? 'active' : 'completed') : ''}`}>
                    <div className="fsm-dot">4</div>
                    <span className="fsm-label">Fired</span>
                  </div>
                </div>

                <div style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(0, 0, 0, 0.2)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <span style={{ fontWeight: 600, display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--accent-indigo)' }}>
                    State Rollup Summary:
                  </span>
                  <p style={{ fontSize: '0.95rem', color: 'var(--text-primary)', lineHeight: '1.4' }}>
                    {activeInitiative.summary || 'Initial scheduling state...'}
                  </p>
                </div>

                {/* Decision Cards */}
                {activeDecisions.length > 0 && (
                  <div style={{ marginTop: '1.5rem' }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>Decision Gates:</h4>
                    {activeDecisions.map((dec) => (
                      <div key={dec.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem', marginBottom: '0.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{dec.title}</span>
                          <span style={{ 
                            fontSize: '0.75rem', 
                            fontWeight: 600, 
                            padding: '0.2rem 0.5rem', 
                            borderRadius: '4px',
                            background: dec.status === 'Approved' ? 'rgba(16, 185, 129, 0.15)' : dec.status === 'Pending' ? 'rgba(249, 115, 22, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: dec.status === 'Approved' ? '#34d399' : dec.status === 'Pending' ? '#f97316' : '#f87171'
                          }}>
                            {dec.status}
                          </span>
                        </div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Justification: {dec.reasoningSummary}</p>
                        {dec.decidedBy && (
                          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                            Decided By: {dec.decidedBy} at {new Date(dec.decidedAt!).toLocaleString()}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {/* Deliverables / Proof of Execution */}
                {actions.length > 0 && (
                  <div style={{ marginTop: '1.5rem' }}>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--accent-green)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <CheckCircle2 size={18} color="var(--accent-green)" />
                      Deliverables &amp; Proof of Execution:
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      {actions.map((act) => (
                        <div key={act.id || act.link} style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '0.85rem 1rem',
                          background: 'rgba(16, 185, 129, 0.08)',
                          border: '1px solid rgba(16, 185, 129, 0.25)',
                          borderRadius: '8px'
                        }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                              <span style={{
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                padding: '0.15rem 0.45rem',
                                borderRadius: '4px',
                                background: act.tool === 'GitHub' ? '#24292e' : '#4a154b',
                                color: '#ffffff'
                              }}>
                                {act.tool}
                              </span>
                              <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                                {act.title}
                              </span>
                            </div>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              Executed by {act.performedBy} • {act.timestamp ? new Date(act.timestamp).toLocaleTimeString() : 'Just now'}
                            </span>
                          </div>
                          {act.link && (
                            <a
                              href={act.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                padding: '0.4rem 0.75rem',
                                borderRadius: '6px',
                                background: 'var(--accent-indigo)',
                                color: '#ffffff',
                                textDecoration: 'none',
                                fontSize: '0.8rem',
                                fontWeight: 600
                              }}
                            >
                              View Output <ExternalLink size={14} />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="glass-card" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px', flexDirection: 'column', color: 'var(--text-secondary)' }}>
                <AlertCircle size={40} style={{ marginBottom: '1rem' }} />
                <p>No active initiative. Submit a goal to see the FSM live.</p>
              </div>
            )}

            {/* Agent Negotiation Thread */}
            {activeInitiative && logs.length > 0 && (
              <div className="glass-card">
                <h2 className="card-title">
                  <MessageSquare size={20} color="#ec4899" />
                  Agent Negotiation Chat
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '400px', overflowY: 'auto', padding: '0.5rem' }}>
                  {logs.map((log) => {
                    const isError = log.eventType === 'Error';
                    const isOrchestrator = log.agent === 'Orchestrator';
                    const isMarketing = log.agent === 'Marketing';
                    const isFinance = log.agent === 'Finance';
                    const isEngineering = log.agent === 'Engineering';

                    let avatarBg = 'rgba(255, 255, 255, 0.1)';
                    let avatarColor = '#fff';
                    let bubbleBg = 'rgba(255, 255, 255, 0.03)';
                    let borderColor = 'rgba(255, 255, 255, 0.08)';

                    if (isError) {
                      avatarBg = 'rgba(239, 68, 68, 0.25)';
                      avatarColor = '#f87171';
                      bubbleBg = 'rgba(239, 68, 68, 0.08)';
                      borderColor = 'rgba(239, 68, 68, 0.35)';
                    } else if (isOrchestrator) {
                      avatarBg = 'rgba(129, 140, 248, 0.2)';
                      avatarColor = '#a5b4fc';
                      bubbleBg = 'rgba(129, 140, 248, 0.05)';
                      borderColor = 'rgba(129, 140, 248, 0.15)';
                    } else if (isMarketing) {
                      avatarBg = 'rgba(236, 72, 153, 0.2)';
                      avatarColor = '#f472b6';
                      bubbleBg = 'rgba(236, 72, 153, 0.05)';
                      borderColor = 'rgba(236, 72, 153, 0.15)';
                    } else if (isFinance) {
                      avatarBg = 'rgba(16, 185, 129, 0.2)';
                      avatarColor = '#34d399';
                      bubbleBg = 'rgba(16, 185, 129, 0.05)';
                      borderColor = 'rgba(16, 185, 129, 0.15)';
                    } else if (isEngineering) {
                      avatarBg = 'rgba(59, 130, 246, 0.2)';
                      avatarColor = '#60a5fa';
                      bubbleBg = 'rgba(59, 130, 246, 0.05)';
                      borderColor = 'rgba(59, 130, 246, 0.15)';
                    }

                    const isExpanded = expandedLogId === log.id;

                    return (
                      <div key={log.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                        <div style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '50%',
                          background: avatarBg,
                          color: avatarColor,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 600,
                          fontSize: '0.85rem',
                          flexShrink: 0
                        }}>
                          {isError ? '!' : log.agent[0]}
                        </div>
                        <div style={{
                          flex: 1,
                          background: bubbleBg,
                          border: `1px solid ${borderColor}`,
                          borderRadius: '12px',
                          padding: '0.75rem 1rem',
                          position: 'relative'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: avatarColor, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              {isError && <AlertTriangle size={14} color="#f87171" />}
                              {log.agent}
                              {isError && <span style={{ fontSize: '0.75rem', color: '#f87171', fontWeight: 'bold' }}>[ERROR]</span>}
                            </span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          <p style={{ fontSize: '0.9rem', color: isError ? '#fca5a5' : 'var(--text-primary)', lineHeight: '1.4' }}>
                            {log.summary}
                          </p>
                          {log.reasoning && (
                            <div style={{ marginTop: '0.5rem', borderTop: '1px dashed rgba(255,255,255,0.08)', paddingTop: '0.5rem' }}>
                              <button 
                                onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--accent-indigo)',
                                  fontSize: '0.75rem',
                                  fontWeight: 500,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.25rem',
                                  padding: 0
                                }}
                              >
                                {isExpanded ? (
                                  <>Hide Agent Thoughts <ChevronUp size={14} /></>
                                ) : (
                                  <>Read Agent Thoughts <ChevronDown size={14} /></>
                                )}
                              </button>
                              {isExpanded && (
                                <pre style={{
                                  marginTop: '0.5rem',
                                  whiteSpace: 'pre-wrap',
                                  fontFamily: "'Courier New', Courier, monospace",
                                  fontSize: '0.75rem',
                                  color: '#93c5fd',
                                  background: 'rgba(0,0,0,0.2)',
                                  padding: '0.5rem',
                                  borderRadius: '4px',
                                  border: '1px solid rgba(255,255,255,0.05)'
                                }}>
                                  {log.reasoning}
                                </pre>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Live Activity Terminal */}
            {activeInitiative && (
              <div className="glass-card">
                <h2 className="card-title">
                  <Terminal size={20} color="var(--accent-indigo)" />
                  Live Activity Terminal
                </h2>
                <div style={{
                  background: 'rgba(10, 10, 15, 0.95)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  boxShadow: 'inset 0 0 15px rgba(99, 102, 241, 0.1)',
                  borderRadius: '8px',
                  padding: '1rem',
                  fontFamily: "'Courier New', Courier, monospace",
                  fontSize: '0.8rem',
                  color: '#34d399',
                  maxHeight: '220px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  textShadow: '0 0 2px rgba(52, 211, 153, 0.5)'
                }}>
                  <div>[SYSTEM] {new Date().toLocaleTimeString()} - Terminal session initialized...</div>
                  {logs.map((log, idx) => (
                    <div key={log.id || idx}>
                      <span style={{ color: '#818cf8' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>{' '}
                      <span style={{ color: '#ec4899', fontWeight: 'bold' }}>[{log.agent}]</span>{' '}
                      <span style={{ color: '#fb7185' }}>{log.eventType.toUpperCase()}</span>:{' '}
                      <span style={{ color: '#f3f4f6' }}>{log.summary}</span>
                    </div>
                  ))}
                  {activeInitiative.status === 'Done' && (
                    <div style={{ color: '#34d399', fontWeight: 'bold' }}>
                      [SYSTEM] {new Date().toLocaleTimeString()} - Initiative execution finished. Ledger synced.
                    </div>
                  )}
                  <div ref={terminalEndRef} />
                </div>
              </div>
            )}

            {/* Historical Initiatives */}
            <div className="glass-card">
              <h2 className="card-title">
                <FileText size={20} color="#a855f7" />
                Notion Initiatives Ledger
              </h2>
              <div className="log-list">
                {initiatives.map((init) => (
                  <div 
                    key={init.id} 
                    onClick={() => {
                      setActiveInitiativeId(init.id);
                      fetchGraphData(init.id);
                      fetchLogs(init.id);
                      fetchActions(init.id);
                    }}
                    style={{ 
                      cursor: 'pointer', 
                      padding: '1rem', 
                      background: activeInitiativeId === init.id ? 'rgba(99, 102, 241, 0.1)' : 'rgba(0, 0, 0, 0.15)', 
                      border: '1px solid',
                      borderColor: activeInitiativeId === init.id ? 'var(--accent-indigo)' : 'var(--border-color)',
                      borderRadius: '8px', 
                      display: 'flex', 
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div>
                      <h4 style={{ fontWeight: 600, fontSize: '0.95rem' }}>{init.name}</h4>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Owner: {init.owner} | {new Date(init.created).toLocaleDateString()}
                      </span>
                    </div>
                    <span style={{ 
                      fontSize: '0.75rem', 
                      fontWeight: 600,
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      background: init.status === 'Done' ? 'rgba(16, 185, 129, 0.15)' : init.status === 'Rejected' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(99, 102, 241, 0.15)',
                      color: init.status === 'Done' ? '#34d399' : init.status === 'Rejected' ? '#f87171' : '#818cf8'
                    }}>
                      {init.status}
                    </span>
                  </div>
                ))}
                {initiatives.length === 0 && <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No initiatives found in the Notion ledger.</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
