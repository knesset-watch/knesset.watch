'use client';

import dynamic from 'next/dynamic';
import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import * as d3Force from 'd3-force';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

// Monotone chain convex hull — returns points in CCW order
function convexHull(pts: [number, number][]): [number, number][] {
  if (pts.length < 2) return pts;
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (O: [number,number], A: [number,number], B: [number,number]) =>
    (A[0]-O[0])*(B[1]-O[1]) - (A[1]-O[1])*(B[0]-O[0]);
  const lower: [number,number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number,number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return [...lower, ...upper];
}

// Draw a smooth closed blob through hull points using quadratic bezier curves
function drawBlob(ctx: CanvasRenderingContext2D, hull: [number,number][]) {
  if (hull.length === 0) return;
  if (hull.length === 1) { ctx.arc(hull[0][0], hull[0][1], 1, 0, 2*Math.PI); return; }
  const mid = (a: [number,number], b: [number,number]): [number,number] =>
    [(a[0]+b[0])/2, (a[1]+b[1])/2];
  const n = hull.length;
  ctx.moveTo(...mid(hull[n-1], hull[0]));
  for (let i = 0; i < n; i++) {
    ctx.quadraticCurveTo(hull[i][0], hull[i][1], ...mid(hull[i], hull[(i+1)%n]));
  }
  ctx.closePath();
}

interface Node {
  id: number;
  name: string;
  faction: string;
  isCoalition: number;
  billCount: number;
  passedCount: number;
  x?: number;
  y?: number;
}

interface Link {
  source: any;
  target: any;
  value: number;
  isCrossAisle: boolean;
}

interface NetworkGraphProps {
  data: { nodes: Node[]; links: Link[] };
}

// Cap node radius so prolific MKs don't dominate
// Physics radius always uses billCount for stable layout
const nodeRadius = (node: any, count?: number) => {
  const c = count ?? (node.billCount || 1);
  return Math.sqrt(Math.min(c, 100)) * 5 + 2;
};

export default function AllianceGraph({ data }: NetworkGraphProps) {
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(900);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [hoverNode, setHoverNode] = useState<Node | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [clusterByParty, setClusterByParty] = useState(false);
  const [sizeBy, setSizeBy] = useState<'proposed' | 'passed'>('proposed');
  const [hoverParty, setHoverParty] = useState<string | null>(null);
  const clusterByPartyRef = useRef(false);
  const dataRef = useRef(data);

  interface PartyLayout {
    hull: [number, number][];
    cx: number; cy: number;
    hue: number;
    labelX: number; labelY: number;
  }
  const partyLayoutRef = useRef<Map<string, PartyLayout>>(new Map());
  // Label bounding boxes in graph-space for mouse hit testing
  const partyLabelBoxes = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(new Map());

  // Track actual container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    setContainerWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Max counts for normalizing dot sizes per mode
  const maxBillCount = useMemo(() => Math.max(...data.nodes.map(n => n.billCount || 0), 1), [data]);
  const maxPassedCount = useMemo(() => Math.max(...data.nodes.map(n => n.passedCount || 0), 1), [data]);

  const displayRadius = useCallback((node: any) => {
    const raw = sizeBy === 'passed' ? (node.passedCount || 0) : (node.billCount || 0);
    const max = sizeBy === 'passed' ? maxPassedCount : maxBillCount;
    const normalized = Math.round((raw / max) * 100);
    const r = nodeRadius(node, normalized || 1);
    // Passed mode uses full relative range but scaled down so overall field reads as smaller
    return sizeBy === 'passed' ? r * 0.55 : r;
  }, [sizeBy, maxBillCount, maxPassedCount]);

  // Adjacency list for fast neighbor lookup
  const neighborsMap = useMemo(() => {
    const map = new Map<number, Set<number>>();
    data.links.forEach(l => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      if (!map.has(s)) map.set(s, new Set());
      if (!map.has(t)) map.set(t, new Set());
      map.get(s)!.add(t);
      map.get(t)!.add(s);
    });
    return map;
  }, [data]);

  // Nodes that have at least one link — isolated nodes clutter the layout
  const connectedNodeIds = useMemo(() => {
    const ids = new Set<number>();
    data.links.forEach(l => {
      ids.add(typeof l.source === 'object' ? l.source.id : l.source);
      ids.add(typeof l.target === 'object' ? l.target.id : l.target);
    });
    return ids;
  }, [data]);

  // Filter data: if a node is selected, show only it and its neighbors
  const displayData = useMemo(() => {
    if (!selectedNode) {
      return {
        nodes: data.nodes,
        links: data.links,
      };
    }
    const neighborhood = neighborsMap.get(selectedNode.id) || new Set();
    const relevantIds = new Set([...Array.from(neighborhood), selectedNode.id]);
    return {
      nodes: data.nodes.filter(n => relevantIds.has(n.id)),
      links: data.links.filter(l => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        return s === selectedNode.id || t === selectedNode.id;
      }),
    };
  }, [data, selectedNode, neighborsMap, connectedNodeIds]);

  // Stats about the selected node
  const selectedStats = useMemo(() => {
    if (!selectedNode) return null;
    const neighbors = neighborsMap.get(selectedNode.id) || new Set();
    const neighborNodes = data.nodes.filter(n => neighbors.has(n.id));
    const crossAisleLinks = data.links.filter(l => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      return (s === selectedNode.id || t === selectedNode.id) && l.isCrossAisle;
    });
    const strongestLink = data.links
      .filter(l => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        return s === selectedNode.id || t === selectedNode.id;
      })
      .sort((a, b) => b.value - a.value)[0];
    const strongestPartnerId = strongestLink
      ? (typeof strongestLink.source === 'object' ? strongestLink.source.id : strongestLink.source) === selectedNode.id
        ? (typeof strongestLink.target === 'object' ? strongestLink.target.id : strongestLink.target)
        : (typeof strongestLink.source === 'object' ? strongestLink.source.id : strongestLink.source)
      : null;
    const strongestPartner = data.nodes.find(n => n.id === strongestPartnerId);
    return {
      collaborators: neighbors.size,
      crossAisle: crossAisleLinks.length,
      strongestPartner,
      strongestCount: strongestLink?.value ?? 0,
    };
  }, [selectedNode, neighborsMap, data]);

  // Stats shown on hover (when no node is selected)
  const hoverStats = useMemo(() => {
    if (!hoverNode || selectedNode) return null;
    const nodeMap = new Map(data.nodes.map(n => [n.id, n]));
    const myLinks = data.links
      .filter(l => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        return s === hoverNode.id || t === hoverNode.id;
      })
      .map(l => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        const partnerId = s === hoverNode.id ? t : s;
        return { partner: nodeMap.get(partnerId), value: l.value };
      })
      .sort((a, b) => b.value - a.value);
    const coalitionCount = myLinks.filter(l => l.partner?.isCoalition).length;
    const oppositionCount = myLinks.filter(l => !l.partner?.isCoalition).length;
    return { coalitionCount, oppositionCount, top5: myLinks.slice(0, 5) };
  }, [hoverNode, selectedNode, data]);

  const handleNodeClick = useCallback((node: any) => {
    if (selectedNode?.id === node.id) {
      setSelectedNode(null);
      setTimeout(() => fgRef.current?.zoomToFit(600), 50);
    } else {
      setSelectedNode(node);
      fgRef.current?.centerAt(node.x, node.y, 600);
      fgRef.current?.zoom(2.5, 600);
    }
  }, [selectedNode]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const found = data.nodes.find(n => n.name.includes(searchQuery));
    if (found) {
      setSelectedNode(found);
      fgRef.current?.centerAt(found.x, found.y, 600);
      fgRef.current?.zoom(2.5, 600);
      setSearchQuery('');
    }
  };

  const clearSelection = () => {
    setSelectedNode(null);
    setTimeout(() => fgRef.current?.zoomToFit(600), 50);
  };

  const forcesApplied = useRef(false);

  // Keep refs in sync
  useEffect(() => { dataRef.current = data; }, [data]);

  // Apply custom forces — called once per simulation restart via onEngineTick
  const applyForces = useCallback(() => {
    if (forcesApplied.current) return;
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force('charge');
    const link = fg.d3Force('link');
    if (!charge || !link) return;
    forcesApplied.current = true;
    charge.strength(-2200);
    fg.d3Force('collide', (d3Force as any).forceCollide().radius((node: any) => nodeRadius(node) + 16));
    link.distance(180);

    if (clusterByPartyRef.current) {
      const parties = [...new Set(dataRef.current.nodes.map((n: Node) => n.faction))];
      const radius = 320;
      const posMap = new Map<string, { x: number; y: number }>();
      parties.forEach((party, i) => {
        const angle = (i / parties.length) * 2 * Math.PI - Math.PI / 2;
        posMap.set(party, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
      });
      fg.d3Force('x', (d3Force as any).forceX((node: any) => posMap.get(node.faction)?.x ?? 0).strength(0.5));
      fg.d3Force('y', (d3Force as any).forceY((node: any) => posMap.get(node.faction)?.y ?? 0).strength(0.5));
    } else {
      fg.d3Force('x', (d3Force as any).forceX(0).strength(0.18));
      fg.d3Force('y', (d3Force as any).forceY(0).strength(0.18));
    }
  }, []);

  // Reset forces when displayed graph changes
  useEffect(() => {
    forcesApplied.current = false;
  }, [displayData]);

  // Reheat simulation when clustering mode changes
  useEffect(() => {
    clusterByPartyRef.current = clusterByParty;
    forcesApplied.current = false;
    fgRef.current?.d3ReheatSimulation();
  }, [clusterByParty]);

  const paintNode = (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const isFocus = selectedNode?.id === node.id;
    const isNeighbor = selectedNode && neighborsMap.get(selectedNode.id)?.has(node.id);
    const isHovered = hoverNode?.id === node.id || (hoverNode && neighborsMap.get(hoverNode.id)?.has(node.id));
    const isDimmed = (selectedNode && !isFocus && !isNeighbor) || (hoverNode && !isHovered && !selectedNode);
    const isPartyDimmed = !selectedNode && !hoverNode && hoverParty && node.faction !== hoverParty;
    const alpha = (isDimmed || isPartyDimmed) ? 0.4 : 1;

    const r = displayRadius(node) * (isFocus ? 1.4 : 1);
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
    if (isFocus) {
      ctx.fillStyle = `rgba(249, 115, 22, ${alpha})`;
    } else {
      ctx.fillStyle = node.isCoalition ? `rgba(5, 150, 105, ${alpha})` : `rgba(99, 102, 241, ${alpha})`;
    }
    ctx.fill();

    if (isFocus || isNeighbor || isHovered) {
      ctx.strokeStyle = isFocus ? '#f97316' : '#fff';
      ctx.lineWidth = (isFocus ? 3 : 1.5) / globalScale;
      ctx.stroke();
    }

    const shouldShowLabel = true;
    if (shouldShowLabel) {
      const label = node.name;
      const fontSize = (isFocus ? 14 : 10) / globalScale;
      ctx.font = `${isFocus ? '900' : 'bold'} ${fontSize}px sans-serif`;
      const textWidth = ctx.measureText(label).width;
      const pad = fontSize * 0.4;
      ctx.fillStyle = `rgba(255,255,255,${alpha * 0.92})`;
      ctx.fillRect(node.x - textWidth / 2 - pad / 2, node.y + r + 2, textWidth + pad, fontSize + pad * 0.5);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = isFocus ? '#000' : `rgba(0,0,0,${alpha * 0.85})`;
      ctx.fillText(label, node.x, node.y + r + 4);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Controls bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-white rounded-2xl border border-black/5 shadow-sm flex-wrap gap-4">
        <div className="flex items-center gap-8 flex-wrap">
          {/* Legend */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">מקרא</span>
            <div className="flex gap-4">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#16a34a] shrink-0"></span>
                <span className="text-[11px] font-bold text-gray-600">קואליציה</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB] shrink-0"></span>
                <span className="text-[11px] font-bold text-gray-600">אופוזיציה</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: 'linear-gradient(to right, #16a34a, #2563EB)' }}></span>
                <span className="text-[11px] font-bold text-gray-600">קשרים חוצי-מחנות</span>
              </div>
            </div>
          </div>

          <div className="h-8 w-px bg-black/5 hidden sm:block"></div>

          {/* Search */}
          <form onSubmit={onSearch} className="flex flex-col gap-1">
            <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">חפש ח"כ</span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={`שם חבר/ת כנסת...`}
              className="bg-gray-50 border border-black/8 rounded-xl px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-black/10 focus:bg-white transition-all"
            />
          </form>
        </div>

        <div className="flex items-center gap-6 flex-wrap">
          <button
            onClick={() => setClusterByParty(v => !v)}
            className={`px-4 py-1.5 rounded-xl text-xs font-black transition-all active:scale-95 ${clusterByParty ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {clusterByParty ? 'מיון חופשי' : 'קיבוץ לפי מפלגה'}
          </button>
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            <button
              onClick={() => setSizeBy('proposed')}
              className={`px-3 py-1 rounded-lg text-xs font-black transition-all ${sizeBy === 'proposed' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              הצעות
            </button>
            <button
              onClick={() => setSizeBy('passed')}
              className={`px-3 py-1 rounded-lg text-xs font-black transition-all ${sizeBy === 'passed' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              עברו
            </button>
          </div>
          {selectedNode && (
            <button
              onClick={clearSelection}
              className="bg-black text-white px-4 py-1.5 rounded-xl text-xs font-black hover:bg-orange-600 transition-all active:scale-95"
            >
              נקה בחירה ✕
            </button>
          )}
        </div>
      </div>

      {/* Graph container */}
      <div
        ref={containerRef}
        className="w-full h-[850px] bg-white border border-black/5 rounded-3xl overflow-hidden relative shadow-xl"
        onMouseMove={(e) => {
          if (!clusterByParty || partyLabelBoxes.current.size === 0) { setHoverParty(null); return; }
          const rect = containerRef.current!.getBoundingClientRect();
          const gp = fgRef.current?.screen2GraphCoords(e.clientX - rect.left, e.clientY - rect.top);
          if (!gp) return;
          let found: string | null = null;
          for (const [party, box] of partyLabelBoxes.current) {
            if (Math.abs(gp.x - box.x) < box.w / 2 && Math.abs(gp.y - box.y) < box.h / 2) {
              found = party; break;
            }
          }
          setHoverParty(found);
        }}
        onMouseLeave={() => setHoverParty(null)}
      >
        <ForceGraph2D
          ref={fgRef}
          width={containerWidth}
          height={850}
          graphData={displayData}
          onRenderFramePre={(ctx: CanvasRenderingContext2D) => {
            if (!clusterByParty) { partyLayoutRef.current.clear(); return; }

            // Group positioned nodes by party
            const partyMap = new Map<string, { nodes: any[]; isCoalition: boolean }>();
            displayData.nodes.forEach((node: any) => {
              if (node.x == null) return;
              if (!partyMap.has(node.faction)) {
                partyMap.set(node.faction, { nodes: [], isCoalition: !!node.isCoalition });
              }
              partyMap.get(node.faction)!.nodes.push(node);
            });

            // Assign hues: coalition=greens (110–155), opposition=blues (205–250)
            const coalitionEntries = [...partyMap.entries()].filter(([, v]) => v.isCoalition);
            const oppositionEntries = [...partyMap.entries()].filter(([, v]) => !v.isCoalition);
            const partyHue = new Map<string, number>();
            coalitionEntries.forEach(([name], i) => {
              partyHue.set(name, 110 + (coalitionEntries.length > 1 ? (i / (coalitionEntries.length - 1)) * 45 : 0));
            });
            oppositionEntries.forEach(([name], i) => {
              partyHue.set(name, 205 + (oppositionEntries.length > 1 ? (i / (oppositionEntries.length - 1)) * 45 : 0));
            });

            partyLayoutRef.current.clear();

            partyMap.forEach(({ nodes }, partyName) => {
              if (nodes.length === 0) return;
              const cx = nodes.reduce((s: number, n: any) => s + n.x, 0) / nodes.length;
              const cy = nodes.reduce((s: number, n: any) => s + n.y, 0) / nodes.length;
              const hue = partyHue.get(partyName) ?? 200;
              const pad = 44;

              const expandedPts: [number,number][] = nodes.flatMap((n: any) => {
                const r = nodeRadius(n) + pad;
                const dx = n.x - cx, dy = n.y - cy;
                const dist = Math.hypot(dx, dy) || 0.001;
                return [
                  [n.x + (dx/dist)*r, n.y + (dy/dist)*r],
                  [n.x + (dy/dist)*r*0.6, n.y - (dx/dist)*r*0.6],
                  [n.x - (dy/dist)*r*0.6, n.y + (dx/dist)*r*0.6],
                ] as [number,number][];
              });

              const hull = convexHull(expandedPts);
              if (hull.length < 2) return;

              // Direction from graph center toward this party centroid
              const mag = Math.hypot(cx, cy) || 0.001;
              const dirX = cx / mag, dirY = cy / mag;
              // Outermost hull point in that direction → place label just beyond it
              const outerPt = hull.reduce((best, pt) =>
                pt[0]*dirX + pt[1]*dirY > best[0]*dirX + best[1]*dirY ? pt : best, hull[0]);
              const labelX = outerPt[0] + dirX * 75;
              const labelY = outerPt[1] + dirY * 75;

              partyLayoutRef.current.set(partyName, { hull, cx, cy, hue, labelX, labelY });

              const isHovered = hoverParty === partyName;
              ctx.beginPath();
              drawBlob(ctx, hull);
              ctx.fillStyle = `hsla(${hue}, 65%, 55%, ${isHovered ? 0.16 : 0.09})`;
              ctx.fill();
              ctx.strokeStyle = `hsla(${hue}, 65%, 42%, ${isHovered ? 0.65 : 0.4})`;
              ctx.lineWidth = isHovered ? 2 : 1.5;
              ctx.setLineDash([5, 5]);
              ctx.stroke();
              ctx.setLineDash([]);
            });
          }}
          onRenderFramePost={(ctx: CanvasRenderingContext2D, globalScale: number) => {
            if (!clusterByParty) return;
            partyLabelBoxes.current.clear();

            partyLayoutRef.current.forEach(({ labelX, labelY, hue }, partyName) => {
              const isHovered = hoverParty === partyName;
              const fontSize = 12 / globalScale;
              ctx.font = `bold ${fontSize}px sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              const tw = ctx.measureText(partyName).width;
              const ph = fontSize * 0.55, pw = fontSize * 0.7;

              // Pill background
              const bx = labelX - tw/2 - pw, by = labelY - fontSize/2 - ph;
              const bw = tw + pw*2, bh = fontSize + ph*2;
              const br = bh / 2;
              ctx.beginPath();
              ctx.moveTo(bx + br, by);
              ctx.lineTo(bx + bw - br, by);
              ctx.arcTo(bx+bw, by, bx+bw, by+bh, br);
              ctx.lineTo(bx+bw, by+bh-br);
              ctx.arcTo(bx+bw, by+bh, bx+bw-br, by+bh, br);
              ctx.lineTo(bx+br, by+bh);
              ctx.arcTo(bx, by+bh, bx, by+bh-br, br);
              ctx.lineTo(bx, by+br);
              ctx.arcTo(bx, by, bx+br, by, br);
              ctx.closePath();
              ctx.fillStyle = isHovered
                ? `hsla(${hue}, 65%, 45%, 0.92)`
                : `hsla(${hue}, 55%, 96%, 0.92)`;
              ctx.fill();
              ctx.strokeStyle = `hsla(${hue}, 65%, 42%, ${isHovered ? 0.9 : 0.5})`;
              ctx.lineWidth = (isHovered ? 1.5 : 1) / globalScale;
              ctx.stroke();

              ctx.fillStyle = isHovered ? '#fff' : `hsla(${hue}, 50%, 25%, 0.9)`;
              ctx.fillText(partyName, labelX, labelY);

              // Store hit box in graph coords for mouse testing
              partyLabelBoxes.current.set(partyName, { x: labelX, y: labelY, w: bw, h: bh });
            });
          }}
          nodeCanvasObject={paintNode}
          onNodeHover={(node: any) => setHoverNode(node)}
          onNodeClick={handleNodeClick}
          nodePointerAreaPaint={(node: any, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x, node.y, displayRadius(node) + 4, 0, 2 * Math.PI, false);
            ctx.fill();
          }}
          linkCanvasObjectMode={() => 'replace'}
          linkCanvasObject={(link: any, ctx: CanvasRenderingContext2D) => {
            const start = link.source;
            const end = link.target;
            if (start?.x == null || end?.x == null) return;

            const s = start.id;
            const t = end.id;
            const isRelated = selectedNode && (s === selectedNode.id || t === selectedNode.id);
            const isHoverRelated = !selectedNode && hoverNode && (s === hoverNode.id || t === hoverNode.id);
            const isPartyDimLink = !selectedNode && !hoverNode && hoverParty &&
              start.faction !== hoverParty && end.faction !== hoverParty;
            const baseAlpha = selectedNode
              ? (isRelated ? 0.85 : 0.02)
              : hoverNode
                ? (isHoverRelated ? 0.85 : 0.12)
                : isPartyDimLink ? 0.05
                : 0.28;
            const width = Math.max(0.4, Math.sqrt(link.value) * 1.0 * (selectedNode ? (isRelated ? 2.5 : 1) : 1));

            // Quadratic bezier control point (curvature = 0.2)
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const cp = { x: (start.x + end.x) / 2 - dy * 0.2, y: (start.y + end.y) / 2 + dx * 0.2 };

            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.quadraticCurveTo(cp.x, cp.y, end.x, end.y);
            ctx.lineWidth = width;

            if (link.isCrossAisle) {
              const grad = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
              const c0 = start.isCoalition ? `rgba(22,163,74,${baseAlpha})` : `rgba(37,99,235,${baseAlpha})`;
              const c1 = end.isCoalition   ? `rgba(22,163,74,${baseAlpha})` : `rgba(37,99,235,${baseAlpha})`;
              grad.addColorStop(0, c0);
              grad.addColorStop(1, c1);
              ctx.strokeStyle = grad;
            } else {
              ctx.strokeStyle = start.isCoalition
                ? `rgba(22,163,74,${baseAlpha})`
                : `rgba(37,99,235,${baseAlpha})`;
            }
            ctx.stroke();
          }}
          d3VelocityDecay={0.3}
          cooldownTicks={600}
          onEngineTick={applyForces}
          onEngineStop={() => fgRef.current?.zoomToFit(600, 80)}
        />

        {/* Selected node info panel */}
        {selectedNode && selectedStats ? (
          <div className="absolute top-5 right-5 bg-white/95 backdrop-blur-xl p-5 rounded-2xl border border-black/8 shadow-xl max-w-[220px] space-y-3" dir="rtl">
            <div>
              <p className="font-black text-sm text-black leading-tight">{selectedNode.name}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">{selectedNode.faction}</p>
              <span className={`inline-block mt-1.5 text-[10px] font-black px-2 py-0.5 rounded-full ${selectedNode.isCoalition ? 'bg-[#16a34a] text-white' : 'bg-[#2563EB] text-white'}`}>
                {selectedNode.isCoalition ? 'קואליציה' : 'אופוזיציה'}
              </span>
            </div>
            <div className="border-t border-black/5 pt-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-gray-500">הצעות חוק</span>
                <span className="text-[11px] font-black text-black">{selectedNode.billCount}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-gray-500">שותפי חקיקה</span>
                <span className="text-[11px] font-black text-black">{selectedStats.collaborators}</span>
              </div>
              {selectedStats.crossAisle > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-gray-500">קשרים חוצי-מחנות</span>
                  <span className="text-[11px] font-black text-amber-600">{selectedStats.crossAisle}</span>
                </div>
              )}
              {selectedStats.strongestPartner && (
                <div className="border-t border-black/5 pt-2">
                  <p className="text-[10px] text-gray-400 uppercase font-black tracking-wide mb-1">שיתוף הפעולה החזק ביותר</p>
                  <p className="text-[11px] font-bold text-black">{selectedStats.strongestPartner.name}</p>
                  <p className="text-[10px] text-gray-400">{selectedStats.strongestCount} הצ"ח משותפות</p>
                </div>
              )}
            </div>
          </div>
        ) : hoverNode && hoverStats ? (
          /* Hover tooltip */
          <div className="absolute top-5 right-5 bg-white/97 backdrop-blur-xl p-4 rounded-2xl border border-black/8 shadow-xl max-w-[230px] space-y-3 pointer-events-none" dir="rtl">
            <div>
              <p className="font-black text-sm text-black leading-tight">{hoverNode.name}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">{hoverNode.faction}</p>
              <span className={`inline-block mt-1.5 text-[10px] font-black px-2 py-0.5 rounded-full ${hoverNode.isCoalition ? 'bg-[#16a34a] text-white' : 'bg-[#2563EB] text-white'}`}>
                {hoverNode.isCoalition ? 'קואליציה' : 'אופוזיציה'}
              </span>
            </div>
            <div className="border-t border-black/5 pt-3 space-y-1.5">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-wide mb-2">הצעות חוק</p>
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-gray-600">הוגשו</span>
                <span className="text-[11px] font-black text-black">{hoverNode.billCount}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-gray-600">עברו</span>
                <span className="text-[11px] font-black text-teal-600">{(hoverNode as any).passedCount ?? 0}</span>
              </div>
            </div>
            <div className="border-t border-black/5 pt-3 space-y-1.5">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-wide mb-2">שיתופי חקיקה</p>
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1.5 text-[11px] text-gray-600">
                  <span className="w-2 h-2 rounded-full bg-[#16a34a] shrink-0"></span>עם קואליציה
                </span>
                <span className="text-[11px] font-black text-black">{hoverStats.coalitionCount}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1.5 text-[11px] text-gray-600">
                  <span className="w-2 h-2 rounded-full bg-[#2563EB] shrink-0"></span>עם אופוזיציה
                </span>
                <span className="text-[11px] font-black text-black">{hoverStats.oppositionCount}</span>
              </div>
            </div>
            {hoverStats.top5.length > 0 && (
              <div className="border-t border-black/5 pt-3">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-wide mb-2">שותפי חקיקה מובילים</p>
                <div className="space-y-1">
                  {hoverStats.top5.map((c, i) => c.partner && (
                    <div key={c.partner.id} className="flex justify-between items-center">
                      <span className="flex items-center gap-1.5 text-[11px] text-gray-700 truncate">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.partner.isCoalition ? 'bg-[#16a34a]' : 'bg-[#2563EB]'}`}></span>
                        {c.partner.name}
                      </span>
                      <span className="text-[10px] text-gray-400 shrink-0 mr-1">{c.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Guide panel when nothing is selected */
          <div
            className="absolute bottom-8 right-6 bg-white/90 backdrop-blur-xl p-5 rounded-2xl border border-black/5 text-[11px] font-medium text-gray-500 space-y-2.5 shadow-lg max-w-[200px] transition-opacity"
            style={{ opacity: hoverNode ? 0.2 : 1 }}
            dir="rtl"
          >
            <p className="font-black text-black text-xs flex items-center gap-2 border-b border-black/5 pb-2.5">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0"></span>
              מדריך לחוקר
            </p>
            <p className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0"></span>לחץ על ח"כ לבידוד הרשת שלו</p>
            <p className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-black/15 shrink-0"></span>גלגל עכבר לזום וניווט</p>
            <p className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'linear-gradient(to right, #16a34a, #2563EB)' }}></span>קו מדורג = קשר חוצי-מחנות</p>
          </div>
        )}
      </div>
    </div>
  );
}
