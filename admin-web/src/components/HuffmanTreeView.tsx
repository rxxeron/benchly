import React, { useMemo } from 'react';
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
  const layout = useMemo(() => {
    if (!tree) return { nodes: [] as PositionedNode[], width: 600, height: 260 };

    const nodes: PositionedNode[] = [];
    let leafCursor = 0;
    const xSpacing = 54;
    const ySpacing = 68;
    let maxDepth = 0;

    function assign(
      n: VisualHuffmanTreeNode,
      depth: number
    ): { x: number; y: number; entry: PositionedNode } {
      if (depth > maxDepth) maxDepth = depth;
      const y = 36 + depth * ySpacing;

      if (!n.left && !n.right) {
        const x = 40 + leafCursor * xSpacing;
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
              : 40;

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
      width: Math.max(640, leafCursor * xSpacing + 80),
      height: Math.max(260, (maxDepth + 1) * ySpacing + 60)
    };
  }, [tree]);

  if (!tree) {
    return <div style={{ color: '#9ca3af', fontSize: 13 }}>No Huffman tree available for this room.</div>;
  }

  return (
    <div
      style={{
        overflowX: 'auto',
        overflowY: 'auto',
        maxHeight: 440,
        background: '#fffdf8',
        border: '2px solid #1e1b18',
        borderRadius: 14,
        padding: 8
      }}
    >
      <svg width={layout.width} height={layout.height}>
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
          return (
            <g key={p.node.id}>
              <circle
                cx={p.x}
                cy={p.y}
                r={isLeaf ? 16 : 12}
                fill={isLeaf ? '#dcfce7' : '#fef3c7'}
                stroke="#1e1b18"
                strokeWidth={isLeaf ? 2 : 1.5}
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
  );
};
