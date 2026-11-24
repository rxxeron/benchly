import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../algorithms/huffman_engine.dart';

void showHuffmanInspectorSheet(
  BuildContext context, {
  required DecodedHuffmanPayload payload,
  required String authorAlias,
}) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFFFFF9F0),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (_) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.78,
      minChildSize: 0.5,
      maxChildSize: 0.94,
      builder: (ctx, scrollController) => _HuffmanInspectorContent(
        payload: payload,
        authorAlias: authorAlias,
        scrollController: scrollController,
      ),
    ),
  );
}

class _HuffmanInspectorContent extends StatelessWidget {
  final DecodedHuffmanPayload payload;
  final String authorAlias;
  final ScrollController scrollController;

  const _HuffmanInspectorContent({
    required this.payload,
    required this.authorAlias,
    required this.scrollController,
  });

  String _formatBitBytes(String bits) {
    if (bits.isEmpty) return '(empty)';
    final chunks = <String>[];
    for (var i = 0; i < bits.length; i += 8) {
      chunks.add(bits.substring(i, math.min(i + 8, bits.length)));
    }
    return chunks.join(' ');
  }

  @override
  Widget build(BuildContext context) {
    final pkt = payload.packet;
    final sortedEntries = payload.canonicalCodes.entries.toList()
      ..sort((a, b) {
        final lenCmp = a.value.length.compareTo(b.value.length);
        return lenCmp != 0 ? lenCmp : a.key.compareTo(b.key);
      });

    return SafeArea(
      child: ListView(
        controller: scrollController,
        padding: const EdgeInsets.fromLTRB(18, 12, 18, 24),
        children: [
          Center(
            child: Container(
              width: 42,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFF1E1B18).withValues(alpha: 0.25),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: const Color(0xFFDCFCE7),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFF1E1B18), width: 1.6),
                  boxShadow: const [BoxShadow(color: Color(0xFF1E1B18), offset: Offset(2, 2))],
                ),
                child: const Icon(Icons.account_tree_rounded, color: Color(0xFF047857), size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Canonical Huffman Wire Decoder',
                      style: TextStyle(
                        color: Color(0xFF1E1B18),
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      'From $authorAlias • Rebuilt from codeLengths tree header',
                      style: const TextStyle(color: Color(0xFF575049), fontSize: 11.5),
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.close_rounded, color: Color(0xFF1E1B18)),
                onPressed: () => Navigator.pop(context),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              _StatPill(
                label: 'Wire Bits',
                value: '${pkt.bitLength}b (${pkt.compressedBytes}B)',
                bg: const Color(0xFFFEF3C7),
              ),
              const SizedBox(width: 8),
              _StatPill(
                label: 'Tree Leaves',
                value: '${pkt.distinctSymbols} syms',
                bg: const Color(0xFFDCFCE7),
              ),
              const SizedBox(width: 8),
              _StatPill(
                label: 'H(X) ≤ L̄',
                value: '${pkt.shannonEntropy.toStringAsFixed(2)} ≤ ${pkt.averageCodeLength.toStringAsFixed(2)}',
                bg: const Color(0xFFE0E7FF),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: const Color(0xFF1E1B18), width: 1.5),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'RECEIVED HUFFMAN BITSTREAM',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.9,
                          color: Color(0xFF575049),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    InkWell(
                      onTap: () {
                        Clipboard.setData(ClipboardData(text: payload.bitStream));
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Copied Huffman bitstream!'),
                            backgroundColor: Color(0xFF0FB881),
                            duration: Duration(seconds: 1),
                          ),
                        );
                      },
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.copy_rounded, size: 13, color: Color(0xFF0FB881)),
                          SizedBox(width: 4),
                          Text(
                            'Copy Bits',
                            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Color(0xFF0FB881)),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 84),
                  child: SingleChildScrollView(
                    child: SelectableText(
                      _formatBitBytes(payload.bitStream),
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11.5,
                        height: 1.4,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF1D4ED8),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Base64 Wire Frame: ${pkt.packedBase64}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 10.5, color: Color(0xFF575049)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFFFFDF8),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: const Color(0xFF1E1B18), width: 1.6),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Expanded(
                      child: Text(
                        'RECONSTRUCTED PREFIX TREE (PINCH / DRAG)',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.9,
                          color: Color(0xFF575049),
                        ),
                      ),
                    ),
                    SizedBox(width: 8),
                    Text(
                      '0 = Left • 1 = Right',
                      style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: Color(0xFF047857)),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                SizedBox(
                  height: 240,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: _HuffmanTreeCanvas(root: payload.visualTree),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: const Color(0xFF1E1B18), width: 1.5),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'CANONICAL CODEBOOK (SYMBOL → PREFIX CODE)',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.9,
                    color: Color(0xFF575049),
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: sortedEntries.map((e) {
                    final symLabel = CanonicalHuffmanEngine.formatDisplaySymbol(e.key);
                    final freq = payload.frequencies[e.key] ?? 1;
                    return Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFF9F0),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: const Color(0xFF1E1B18).withValues(alpha: 0.25)),
                      ),
                      child: Text(
                        '$symLabel ×$freq → ${e.value}',
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: Color(0xFF1E1B18),
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFDCFCE7).withValues(alpha: 0.55),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: const Color(0xFF047857).withValues(alpha: 0.45)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.verified_rounded, size: 14, color: Color(0xFF047857)),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        pkt.shannonVerified
                            ? 'DECODED PLAINTEXT • SHANNON BOUND VERIFIED'
                            : 'DECODED PLAINTEXT',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.8,
                          color: Color(0xFF047857),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  payload.decodedText,
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: Color(0xFF1E1B18),
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StatPill extends StatelessWidget {
  final String label;
  final String value;
  final Color bg;

  const _StatPill({
    required this.label,
    required this.value,
    required this.bg,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFF1E1B18), width: 1.3),
        ),
        child: Column(
          children: [
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w900, color: Color(0xFF1E1B18)),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: const TextStyle(fontSize: 9.5, fontWeight: FontWeight.w700, color: Color(0xFF575049)),
            ),
          ],
        ),
      ),
    );
  }
}

class _PositionedTreeNode {
  final VisualHuffmanNode node;
  final double x;
  final double y;
  double? parentX;
  double? parentY;

  _PositionedTreeNode({required this.node, required this.x, required this.y});
}

class _HuffmanTreeCanvas extends StatelessWidget {
  final VisualHuffmanNode root;

  const _HuffmanTreeCanvas({required this.root});

  @override
  Widget build(BuildContext context) {
    final positioned = <_PositionedTreeNode>[];
    var leafCursor = 0;
    var maxDepth = 0;
    const xSpacing = 54.0;
    const ySpacing = 66.0;
    const padX = 36.0;
    const padY = 30.0;

    _PositionedTreeNode assign(VisualHuffmanNode n, int depth) {
      if (depth > maxDepth) maxDepth = depth;
      final y = padY + depth * ySpacing;
      if (n.left == null && n.right == null) {
        final x = padX + leafCursor * xSpacing;
        leafCursor++;
        final entry = _PositionedTreeNode(node: n, x: x, y: y);
        positioned.add(entry);
        return entry;
      }
      final leftEntry = n.left != null ? assign(n.left!, depth + 1) : null;
      final rightEntry = n.right != null ? assign(n.right!, depth + 1) : null;
      final x = (leftEntry != null && rightEntry != null)
          ? (leftEntry.x + rightEntry.x) / 2
          : (leftEntry?.x ?? rightEntry?.x ?? padX);
      final entry = _PositionedTreeNode(node: n, x: x, y: y);
      if (leftEntry != null) {
        leftEntry.parentX = x;
        leftEntry.parentY = y;
      }
      if (rightEntry != null) {
        rightEntry.parentX = x;
        rightEntry.parentY = y;
      }
      positioned.add(entry);
      return entry;
    }

    assign(root, 0);
    final canvasWidth = math.max(320.0, math.max(0, leafCursor - 1) * xSpacing + padX * 2);
    final canvasHeight = math.max(220.0, maxDepth * ySpacing + padY + 52);

    return InteractiveViewer(
      constrained: false,
      boundaryMargin: const EdgeInsets.all(40),
      minScale: 0.45,
      maxScale: 2.2,
      child: CustomPaint(
        size: Size(canvasWidth, canvasHeight),
        painter: _HuffmanTreePainter(positioned),
      ),
    );
  }
}

class _HuffmanTreePainter extends CustomPainter {
  final List<_PositionedTreeNode> nodes;

  const _HuffmanTreePainter(this.nodes);

  @override
  void paint(Canvas canvas, Size size) {
    final zeroEdgePaint = Paint()
      ..color = const Color(0xFF3B82F6)
      ..strokeWidth = 2.0;
    final oneEdgePaint = Paint()
      ..color = const Color(0xFF0FB881)
      ..strokeWidth = 2.0;
    final borderPaint = Paint()
      ..color = const Color(0xFF1E1B18)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.8;

    for (final p in nodes) {
      if (p.parentX == null || p.parentY == null) continue;
      final isZero = p.node.bit == '0';
      canvas.drawLine(
        Offset(p.parentX!, p.parentY!),
        Offset(p.x, p.y),
        isZero ? zeroEdgePaint : oneEdgePaint,
      );
      final mid = Offset((p.parentX! + p.x) / 2, (p.parentY! + p.y) / 2 - 7);
      _drawText(
        canvas,
        p.node.bit ?? '',
        mid,
        fontSize: 10,
        color: isZero ? const Color(0xFF1D4ED8) : const Color(0xFF047857),
        weight: FontWeight.w800,
      );
    }

    for (final p in nodes) {
      final isLeaf = p.node.isLeaf;
      final isRoot = p.parentX == null;
      final radius = isLeaf ? 15.0 : (isRoot ? 14.0 : 11.5);
      final fillPaint = Paint()
        ..color = isLeaf
            ? const Color(0xFFDCFCE7)
            : (isRoot ? const Color(0xFFFDE68A) : const Color(0xFFFEF3C7));

      final center = Offset(p.x, p.y);
      canvas.drawCircle(center, radius, fillPaint);
      canvas.drawCircle(center, radius, borderPaint);

      final label = isLeaf
          ? CanonicalHuffmanEngine.formatDisplaySymbol(p.node.symbol)
          : '${p.node.frequency}';
      _drawText(
        canvas,
        label,
        center,
        fontSize: isLeaf ? 11 : 9.5,
        color: const Color(0xFF1E1B18),
        weight: FontWeight.w800,
      );

      if (isLeaf && p.node.code.isNotEmpty) {
        _drawText(
          canvas,
          p.node.code,
          Offset(p.x, p.y + radius + 10),
          fontSize: 9,
          color: const Color(0xFF047857),
          weight: FontWeight.w700,
        );
      }
    }
  }

  void _drawText(
    Canvas canvas,
    String text,
    Offset center, {
    required double fontSize,
    required Color color,
    required FontWeight weight,
  }) {
    final tp = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(fontSize: fontSize, color: color, fontWeight: weight),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, Offset(center.dx - tp.width / 2, center.dy - tp.height / 2));
  }

  @override
  bool shouldRepaint(covariant _HuffmanTreePainter oldDelegate) => oldDelegate.nodes != nodes;
}
