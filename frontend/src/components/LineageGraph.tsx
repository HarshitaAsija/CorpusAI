import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

type Node = { id: string; label: string };
type Edge = { from: string; to: string; label?: string };

type GraphData = { nodes: Node[]; edges: Edge[] };

interface LineageGraphProps {
  data: GraphData | null;
  activeStatus?: string;
}

const DEFAULT_GRAPH_DATA: GraphData = {
  nodes: [
    { id: 'orchestrator', label: 'Orchestrator FSM' },
    { id: 'marketing', label: 'Marketing Agent' },
    { id: 'finance', label: 'Finance Agent' },
    { id: 'engineering', label: 'Engineering Agent' },
    { id: 'github', label: 'GitHub API' },
    { id: 'slack', label: 'Slack API' }
  ],
  edges: [
    { from: 'orchestrator', to: 'marketing', label: '1. Draft Proposal' },
    { from: 'marketing', to: 'finance', label: '2. Budget Review' },
    { from: 'finance', to: 'orchestrator', label: '3. Policy Check' },
    { from: 'orchestrator', to: 'engineering', label: '4. Execute Tasks' },
    { from: 'engineering', to: 'github', label: '5. Create Issue' },
    { from: 'engineering', to: 'slack', label: '6. Post Notice' }
  ]
};

const LineageGraph: React.FC<LineageGraphProps> = ({ data, activeStatus }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    // Use provided graph data if available, otherwise use complete topology fallback
    const activeData = (data && data.nodes && data.nodes.length > 0) ? data : DEFAULT_GRAPH_DATA;
    
    const container = svgRef.current.parentElement;
    const width = container && container.clientWidth > 0 ? container.clientWidth : 700;
    const height = 420;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    // --- Defs: gradients, glow, pulse ---
    const defs = svg.append('defs');
    
    // Glow filter
    const glowFilter = defs.append('filter')
      .attr('id', 'glow')
      .attr('x', '-50%').attr('y', '-50%')
      .attr('width', '200%').attr('height', '200%');
    glowFilter.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'coloredBlur');
    const feMerge = glowFilter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Soft glow for hovered links
    const linkGlow = defs.append('filter')
      .attr('id', 'link-glow')
      .attr('x', '-50%').attr('y', '-50%')
      .attr('width', '200%').attr('height', '200%');
    linkGlow.append('feGaussianBlur').attr('stdDeviation', '2').attr('result', 'blur');
    const lm = linkGlow.append('feMerge');
    lm.append('feMergeNode').attr('in', 'blur');
    lm.append('feMergeNode').attr('in', 'SourceGraphic');

    // Agent gradient colors
    const agentColors: Record<string, string[]> = {
      orchestrator: ['#a78bfa', '#6d28d9'],
      marketing: ['#f472b6', '#db2777'],
      finance: ['#34d399', '#059669'],
      engineering: ['#60a5fa', '#2563eb'],
      github: ['#fbbf24', '#d97706'],
      slack: ['#fb7185', '#e11d48'],
      default: ['#9ca3af', '#4b5563']
    };

    Object.entries(agentColors).forEach(([key, colors]) => {
      const grad = defs.append('radialGradient')
        .attr('id', `grad-${key}`)
        .attr('cx', '30%').attr('cy', '30%').attr('r', '70%');
      grad.append('stop').attr('offset', '0%').attr('stop-color', colors[0]);
      grad.append('stop').attr('offset', '100%').attr('stop-color', colors[1]);
    });

    // --- Data Preparation (Deep clone nodes & edges so D3 force simulation doesn't mutate props) ---
    const nodes = activeData.nodes.map(n => ({ id: n.id, label: n.label }));
    const d3Links = activeData.edges.map(e => ({
      source: typeof e.from === 'object' ? (e.from as any).id : e.from,
      target: typeof e.to === 'object' ? (e.to as any).id : e.to,
      label: e.label
    }));

    const simulation = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(d3Links).id((d: any) => d.id).distance(180))
      .force('charge', d3.forceManyBody().strength(-350))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(50))
      .force('x', d3.forceX(width / 2).strength(0.06))
      .force('y', d3.forceY(height / 2).strength(0.06));

    // --- Tooltip div (appended to body once) ---
    let tooltip: d3.Selection<any, any, any, any> = d3.select('body').select('.lineage-tooltip');
    if (tooltip.empty()) {
      tooltip = d3.select('body').append('div')
        .attr('class', 'lineage-tooltip')
        .style('position', 'fixed')
        .style('pointer-events', 'none')
        .style('background', 'rgba(15, 15, 25, 0.95)')
        .style('color', '#e2e8f0')
        .style('padding', '8px 14px')
        .style('border-radius', '8px')
        .style('font-size', '0.75rem')
        .style('max-width', '280px')
        .style('line-height', '1.4')
        .style('border', '1px solid rgba(139, 92, 246, 0.4)')
        .style('box-shadow', '0 4px 20px rgba(0,0,0,0.5)')
        .style('z-index', '9999')
        .style('opacity', '0')
        .style('transition', 'opacity 0.15s ease');
    }

    // --- Link hit areas (invisible wide paths for easy hover) ---
    const linkHitArea = svg.append('g')
      .selectAll('path.hit')
      .data(d3Links)
      .enter()
      .append('path')
      .attr('class', 'hit')
      .attr('fill', 'none')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 18)
      .style('cursor', 'pointer');

    // --- Visible link lines ---
    const link = svg.append('g')
      .selectAll('path.link-line')
      .data(d3Links)
      .enter()
      .append('path')
      .attr('class', 'link-line')
      .attr('fill', 'none')
      .attr('stroke', 'rgba(255, 255, 255, 0.12)')
      .attr('stroke-width', 2)
      .style('pointer-events', 'none');

    // --- Glowing particles ---
    const particles = svg.append('g')
      .selectAll('circle.particle')
      .data(d3Links)
      .enter()
      .append('circle')
      .attr('class', 'particle')
      .attr('r', 3)
      .attr('fill', '#a5f3fc')
      .style('filter', 'url(#glow)')
      .each(function(d: any) { d.t = Math.random(); });

    // --- Hover events on link hit areas ---
    linkHitArea
      .on('mouseenter', function(_event: any, d: any) {
        link.filter((ld: any) => ld === d)
          .attr('stroke', 'rgba(167, 139, 250, 0.6)')
          .attr('stroke-width', 3)
          .style('filter', 'url(#link-glow)');

        if (d.label) {
          tooltip
            .html(`<strong style="color:#a78bfa;">↔ ${getNodeLabel(d.source)} → ${getNodeLabel(d.target)}</strong><br/>${d.label}`)
            .style('opacity', '1');
        }
      })
      .on('mousemove', function(event: any) {
        tooltip
          .style('left', (event.clientX + 14) + 'px')
          .style('top', (event.clientY - 10) + 'px');
      })
      .on('mouseleave', function(_event: any, d: any) {
        link.filter((ld: any) => ld === d)
          .attr('stroke', 'rgba(255, 255, 255, 0.12)')
          .attr('stroke-width', 2)
          .style('filter', 'none');
        tooltip.style('opacity', '0');
      });

    function getNodeLabel(node: any): string {
      return typeof node === 'string' ? node : (node.label || node.id || '');
    }

    // --- Drag handler ---
    const drag = d3.drag<SVGGElement, any>()
      .on('start', (event: any, d: any) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (event: any, d: any) => {
        d.fx = event.x; d.fy = event.y;
      })
      .on('end', (event: any, d: any) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      });

    // --- Nodes ---
    const node = svg.append('g')
      .selectAll('g.node')
      .data(nodes as any)
      .enter()
      .append('g')
      .attr('class', 'node')
      .call(drag);

    // Outer pulse ring for active agents
    node.append('circle')
      .attr('class', 'pulse-ring')
      .attr('r', 32)
      .attr('fill', 'none')
      .attr('stroke', (d: any) => {
        const colorKey = agentColors[d.id] ? d.id : 'default';
        return agentColors[colorKey][0];
      })
      .attr('stroke-width', 1.5)
      .attr('opacity', (d: any) => getIsActiveAgent(d.id, activeStatus) ? 0.5 : 0);

    // Main node circle
    node.append('circle')
      .attr('r', (d: any) => getIsActiveAgent(d.id, activeStatus) ? 26 : 20)
      .attr('fill', (d: any) => {
        const colorKey = agentColors[d.id] ? d.id : 'default';
        return `url(#grad-${colorKey})`;
      })
      .style('filter', (d: any) => getIsActiveAgent(d.id, activeStatus) ? 'url(#glow)' : 'none')
      .attr('stroke', (d: any) => getIsActiveAgent(d.id, activeStatus) ? '#ffffff' : 'rgba(255, 255, 255, 0.3)')
      .attr('stroke-width', (d: any) => getIsActiveAgent(d.id, activeStatus) ? 2.5 : 1.5);

    // Node label
    node.append('text')
      .text((d: any) => d.label || d.id)
      .attr('dy', 36)
      .attr('text-anchor', 'middle')
      .attr('fill', '#e2e8f0')
      .attr('font-size', '0.75rem')
      .attr('font-weight', '500')
      .style('pointer-events', 'none')
      .style('text-shadow', '0 2px 4px rgba(0,0,0,0.8)');

    // Continuous pulse ring animation for active nodes
    function animatePulse() {
      svg.selectAll('circle.pulse-ring')
        .filter((d: any) => getIsActiveAgent(d.id, activeStatus))
        .attr('r', 28)
        .attr('opacity', 0.8)
        .transition()
        .duration(1200)
        .ease(d3.easeCubicOut)
        .attr('r', 44)
        .attr('opacity', 0)
        .transition()
        .duration(0)
        .attr('r', 28)
        .attr('opacity', 0.5)
        .on('end', animatePulse);
    }
    animatePulse();

    // --- Simulation tick ---
    simulation.on('tick', () => {
      const pathStr = (d: any) => {
        if (!d.source || !d.target) return '';
        return `M${d.source.x},${d.source.y} L${d.target.x},${d.target.y}`;
      };
      link.attr('d', pathStr);
      linkHitArea.attr('d', pathStr);

      particles
        .attr('cx', (d: any) => (d.source && d.target) ? (d.source.x + d.t * (d.target.x - d.source.x)) : 0)
        .attr('cy', (d: any) => (d.source && d.target) ? (d.source.y + d.t * (d.target.y - d.source.y)) : 0)
        .each(function(d: any) { d.t = (d.t + 0.006) % 1.0; });

      node.attr('transform', (d: any) => `translate(${d.x || 0},${d.y || 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [data, activeStatus]);

  function getIsActiveAgent(nodeId: string, status?: string): boolean {
    if (!status) return false;
    const cleanId = nodeId.toLowerCase();
    switch (status) {
      case 'Planning':
        return cleanId === 'marketing' || cleanId === 'finance' || cleanId === 'orchestrator';
      case 'Awaiting Approval':
        return cleanId === 'orchestrator';
      case 'Approved':
      case 'Executing':
        return cleanId === 'engineering' || cleanId === 'orchestrator';
      case 'Done':
        return cleanId === 'orchestrator';
      default:
        return false;
    }
  }

  return (
    <svg 
      ref={svgRef} 
      width="100%" 
      height="420" 
      style={{ 
        background: 'radial-gradient(ellipse at center, rgba(15, 10, 40, 0.6) 0%, rgba(0, 0, 0, 0.35) 100%)', 
        borderRadius: '12px', 
        border: '1px solid var(--border-color)',
        overflow: 'visible'
      }} 
    />
  );
};

export default LineageGraph;
