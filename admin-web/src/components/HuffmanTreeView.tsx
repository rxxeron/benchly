import React, { useMemo, useState } from 'react';
import { VisualHuffmanTreeNode } from '../api';

interface PositionedNode {
  node: VisualHuffmanTreeNode;
  x: number;
  y: number;
  parentX?: number;
  parentY?: number;
}

function formatSymbol(sym: string | null): string {
  if (sym === null) return '';
  if (sym === ' ') return 'SPC';
  if (sym === '\n') return '\\n';
  if (sym === '\t') return '\\t';
  return sym;
}

export const HuffmanTreeView: React.FC<{ tree: VisualHuffmanTreeNode | null }> = ({ tree }) => {
  // 'fit' scales the full SVG viewBox to 100% of the card width so the entire tree + root is visible at once.
  // Numeric zoom (e.g. 1, 1.4, 1.8) enables scrollable close-up inspection of large 60-leaf trees.
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit');

  const layout = useMemo(() => {
    if (!tree) return { nodes: [] as PositionedNode[], width: 640, height: 300, leafCount: 0, maxDepth: 0 };

    const nodes: PositionedNode[] = [];
    let leafCursor = 0;
    const xSpacing = 56;
    const ySpacing = 74;
    const topPad = 48;
    const sidePad = 56;
    let maxDepth = 0;

    function assign(
      n: VisualHuffmanTreeNode,
      depth: number
    ): { x: number; y: number; entry: PositionedNode } {
      if (depth > maxDepth) maxDepth = depth;
      const y = topPad + depth * ySpacing;

      if (!n.left && !n.right) {
        const x = sidePad + leafCursor * xSpacing;
        leafCursor++;
        const entry: PositionedNode = { node: n, x, y };
        nodes.push(entry);
        return { x, y, entry };
      }

      const leftPos = n.left ? assign(n.left, depth + 1) : null;
      const rightPos = n.right ? assign(n.right, depth + 1) : null;

      const x =
        leftPos && rightPos
          ? (leftPos.x + rightPos.x) / 2
          : leftPos
            ? leftPos.x
            : rightPos
              ? rightPos.x
              : sidePad;

      const entry: PositionedNode = { node: n, x, y };
      if (leftPos) {
        leftPos.entry.parentX = x;
        leftPos.entry.parentY = y;
      }
      if (rightPos) {
        rightPos.entry.parentX = x;
        rightPos.entry.parentY = y;
      }
      nodes.push(entry);
      return { x, y, entry };
    }

    assign(tree, 0);
    return {
      nodes,
      leafCount: leafCursor,
      maxDepth,
      width: Math.max(640, Math.max(0, leafCursor - 1) * xSpacing + sidePad * 2),
      height: Math.max(280, maxDepth * ySpacing + topPad + 64)
    };
  }, [tree]);

  if (!tree) {
    return <div style={{ color: '#9ca3af', fontSize: 13 }}>No Huffman tree available for this room.</div>;
  }

  const isFit = zoomMode === 'fit';
  const zoomFactor = typeof zoomMode === 'number' ? zoomMode : 1;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 10
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#575049' }}>
          <span className="badge amber">● Internal Node (Freq Sum)</span>
          <span className="badge emerald">● Leaf Symbol + Prefix Bits</span>
          <span className="mono">
            {layout.leafCount} leaves • depth {layout.maxDepth}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            className={`btn ${isFit ? 'primary' : ''}`}
            style={{ padding: '5px 10px', fontSize: 12 }}
            onClick={() => setZoomMode('fit')}
          >
            Fit Entire Tree
          </button>
          <button
            type="button"
            className={`btn ${zoomMode === 0.75 ? 'primary' : ''}`}
            style={{ padding: '5px 10px', fontSize: 12 }}
            onClick={() => setZoomMode(0.75)}
          >
            75%
          </button>
          <button
            type="button"
            className={`btn ${zoomMode === 1 ? 'primary' : ''}`}
            style={{ padding: '5px 10px', fontSize: 12 }}
            onClick={() => setZoomMode(1)}
          >
            100%
          </button>
          <button
            type="button"
            className={`btn ${zoomMode === 1.4 ? 'primary' : ''}`}
            style={{ padding: '5px 10px', fontSize: 12 }}
            onClick={() => setZoomMode(1.4)}
          >
            140%
          </button>
        </div>
      </div>

      <div
        style={{
          overflowX: isFit ? 'hidden' : 'auto',
          overflowY: isFit ? 'hidden' : 'auto',
          maxHeight: isFit ? 'none' : 540,
          background: '#fffdf8',
          border: '2px solid #1e1b18',
          borderRadius: 14,
          padding: 12
        }}
      >
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={isFit ? '100%' : Math.round(layout.width * zoomFactor)}
          height={isFit ? Math.min(520, Math.max(300, Math.round(layout.height * 0.82))) : Math.round(layout.height * zoomFactor)}
          preserveAspectRatio="xMidYMid meet"
          style={{ display: 'block', margin: '0 auto' }}
        >
          {/* Edges */}
          {layout.nodes.map((p) => {
            if (p.parentX === undefined || p.parentY === undefined) return null;
            const midX = (p.parentX + p.x) / 2;
            const midY = (p.parentY + p.y) / 2;
            return (
              <g key={`edge_${p.node.id}`}>
                <line
                  x1={p.parentX}
                  y1={p.parentY}
                  x2={p.x}
                  y2={p.y}
                  stroke={p.node.bit === '0' ? '#3b82f6' : '#0fb881'}
                  strokeWidth={2}
                />
                <text
                  x={midX}
                  y={midY - 4}
                  fill={p.node.bit === '0' ? '#1d4ed8' : '#047857'}
                  fontSize={10.5}
                  fontWeight={800}
                  textAnchor="middle"
                >
                  {p.node.bit}
                </text>
              </g>
            );
          })}

          {/* Nodes */}
          {layout.nodes.map((p) => {
            const isLeaf = p.node.symbol !== null;
            const isRoot = p.parentX === undefined;
            return (
              <g key={p.node.id}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isLeaf ? 16 : isRoot ? 15 : 12}
                  fill={isLeaf ? '#dcfce7' : isRoot ? '#fde68a' : '#fef3c7'}
                  stroke="#1e1b18"
                  strokeWidth={isLeaf || isRoot ? 2.2 : 1.5}
                />
                <text
                  x={p.x}
                  y={p.y + 4}
                  fill="#1e1b18"
                  fontSize={isLeaf ? 11 : 9.5}
                  fontWeight={800}
                  textAnchor="middle"
                  className="mono"
                >
                  {isLeaf ? formatSymbol(p.node.symbol) : p.node.frequency}
                </text>
                {isLeaf && (
                  <text
                    x={p.x}
                    y={p.y + 30}
                    fill="#047857"
                    fontSize={9.5}
                    fontWeight={700}
                    textAnchor="middle"
                    className="mono"
                  >
                    {p.node.code}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
