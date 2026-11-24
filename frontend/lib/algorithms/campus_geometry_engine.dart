import 'dart:math' as math;
import 'algo_trace.dart';

class CampusPingPoint {
  final double x;
  final double y;
  final String zoneName;
  final String deptBadge;

  const CampusPingPoint({
    required this.x,
    required this.y,
    required this.zoneName,
    required this.deptBadge,
  });
}

class ConvexHullResult {
  final List<CampusPingPoint> allPoints;
  final List<CampusPingPoint> hullVertices;
  final double hullArea;
  final double hullPerimeter;
  final List<AlgoTraceStep> traceSteps;

  const ConvexHullResult({
    required this.allPoints,
    required this.hullVertices,
    required this.hullArea,
    required this.hullPerimeter,
    required this.traceSteps,
  });
}

class CampusGeometryEngine {
  static const List<String> pseudocode = [
    '1. Find anchor ping P_0 with minimum y-coordinate (lowest-leftmost)',
    '2. Sort remaining N-1 pings by polar angle around P_0 in O(N log N)',
    '3. Push P_0, P_1 onto Convex Hull monotonic stack S',
    '4. For each point P_i: while crossProduct(secondTop(S), top(S), P_i) <= 0:',
    '5.   Pop non-left-turn vertex from stack S (Graham Scan pruning)',
    '6. Push P_i onto stack S and compute Zero-PII Campus Adda Polygon Area',
  ];

  static double crossProduct(CampusPingPoint o, CampusPingPoint a, CampusPingPoint b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  static ConvexHullResult computeGrahamScan(List<CampusPingPoint> pts) {
    final trace = <AlgoTraceStep>[];
    if (pts.length < 3) {
      return ConvexHullResult(
        allPoints: pts,
        hullVertices: pts,
        hullArea: 0,
        hullPerimeter: 0,
        traceSteps: trace,
      );
    }

    final points = List<CampusPingPoint>.from(pts);
    var minIdx = 0;
    for (var i = 1; i < points.length; i++) {
      if (points[i].y < points[minIdx].y ||
          (points[i].y == points[minIdx].y && points[i].x < points[minIdx].x)) {
        minIdx = i;
      }
    }
    final tmp = points[0];
    points[0] = points[minIdx];
    points[minIdx] = tmp;
    final p0 = points[0];

    trace.add(AlgoTraceStep(
      stepIndex: 0,
      title: 'Anchor Vertex P₀ Selected',
      detail: 'Lowest-Y campus ping: ${p0.zoneName} at (${p0.x.toStringAsFixed(1)}, ${p0.y.toStringAsFixed(1)}).',
      pseudocodeLine: 0,
      stateSnapshot: {'anchor': p0.zoneName},
    ));

    final rest = points.sublist(1);
    rest.sort((a, b) {
      final cp = crossProduct(p0, a, b);
      if (cp.abs() > 1e-6) return cp > 0 ? -1 : 1;
      final da = (a.x - p0.x) * (a.x - p0.x) + (a.y - p0.y) * (a.y - p0.y);
      final db = (b.x - p0.x) * (b.x - p0.x) + (b.y - p0.y) * (b.y - p0.y);
      return da.compareTo(db);
    });

    final stack = <CampusPingPoint>[p0];
    for (final pt in rest) {
      while (stack.length >= 2 &&
          crossProduct(stack[stack.length - 2], stack.last, pt) <= 0) {
        final popped = stack.removeLast();
        trace.add(AlgoTraceStep(
          stepIndex: trace.length,
          title: 'Clockwise Turn Pruned (Popped ${popped.zoneName})',
          detail: 'Cross product <= 0 when advancing toward ${pt.zoneName}; popped ${popped.zoneName}.',
          pseudocodeLine: 4,
          stateSnapshot: {'stackSize': stack.length},
        ));
      }
      stack.add(pt);
      trace.add(AlgoTraceStep(
        stepIndex: trace.length,
        title: 'Left Turn Confirmed (Pushed ${pt.zoneName})',
        detail: 'Hull stack now holds ${stack.length} boundary vertices.',
        pseudocodeLine: 5,
        stateSnapshot: {'stackSize': stack.length},
      ));
    }

    var area = 0.0;
    var perimeter = 0.0;
    for (var i = 0; i < stack.length; i++) {
      final cur = stack[i];
      final nxt = stack[(i + 1) % stack.length];
      area += (cur.x * nxt.y) - (nxt.x * cur.y);
      final dx = nxt.x - cur.x;
      final dy = nxt.y - cur.y;
      perimeter += math.sqrt(dx * dx + dy * dy);
    }
    area = area.abs() / 2.0;

    return ConvexHullResult(
      allPoints: pts,
      hullVertices: stack,
      hullArea: area,
      hullPerimeter: perimeter,
      traceSteps: trace,
    );
  }
}
