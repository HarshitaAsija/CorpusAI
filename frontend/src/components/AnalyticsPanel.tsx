import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface AgentMetrics {
  avgResponseMs: number;
  successCount: number;
}

interface AnalyticsData {
  totalInitiatives: number;
  successRate: number;
  averageRounds: number;
  agentMetrics: Record<string, AgentMetrics>;
}

const API_URL = import.meta.env.VITE_API_URL || 'https://corpusai-16ir.onrender.com';

const AnalyticsPanel: React.FC = () => {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const res = await fetch(`${API_URL}/api/analytics`);
        if (!res.ok) throw new Error('Failed to fetch analytics');
        const json = await res.json();
        setData(json);
        setError(null);
      } catch (e: any) {
        console.error(e);
        setError(e.message);
      }
    };
    fetchAnalytics();
  }, []);

  if (error) {
    return <div style={{ color: 'var(--accent-red)' }}>Analytics error: {error}</div>;
  }

  if (!data) {
    return <div>Loading analytics...</div>;
  }

  const chartData = Object.entries(data.agentMetrics).map(([agent, metrics]) => ({
    agent,
    avgResponseMs: metrics.avgResponseMs,
    successCount: metrics.successCount,
  }));

  return (
    <div className="glass-card" style={{ marginBottom: '2rem' }}>
      <h2 className="card-title">
        <span>📊 Agent‑wise Analytics</span>
      </h2>
      <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
        Total Initiatives: {data.totalInitiatives} | Success Rate:{' '}
        {(data.successRate * 100).toFixed(0)}% | Avg Rounds: {data.averageRounds}
      </p>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
          <XAxis dataKey="agent" stroke="var(--text-primary)" />
          <YAxis stroke="var(--text-primary)" />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)'
            }}
          />
          <Bar dataKey="avgResponseMs" name="Avg Response (ms)" fill="var(--accent-indigo)" />
          <Bar dataKey="successCount" name="Successes" fill="var(--accent-green)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default AnalyticsPanel;
