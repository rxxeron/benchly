import 'dart:math' as math;
import 'algo_trace.dart';

class WaitingStudentNode {
  final String id;
  final String alias;
  final String dept;
  final String batchYear;
  final String gender;
  final String seeking;
  final String topic;
  final int waitSeconds;

  const WaitingStudentNode({
    required this.id,
    required this.alias,
    required this.dept,
    required this.batchYear,
    required this.gender,
    required this.seeking,
    required this.topic,
    required this.waitSeconds,
  });

  String get badge => "$dept '${batchYear.substring(2)}";
}

class MatchedBenchPair {
  final WaitingStudentNode studentA;
  final WaitingStudentNode studentB;
  final int compatibilityScore;
  final String reason;

  const MatchedBenchPair({
    required this.studentA,
    required this.studentB,
    required this.compatibilityScore,
    required this.reason,
  });
}

class MatchmakingFlowResult {
  final List<MatchedBenchPair> optimalPairs;
  final List<MatchedBenchPair> naiveFifoPairs;
  final int totalOptimalCompatibility;
  final int totalFifoCompatibility;
  final int maxFlowValue;
  final List<List<String>> groupHauntLounges;
  final List<AlgoTraceStep> traceSteps;

  const MatchmakingFlowResult({
    required this.optimalPairs,
    required this.naiveFifoPairs,
    required this.totalOptimalCompatibility,
    required this.totalFifoCompatibility,
    required this.maxFlowValue,
    required this.groupHauntLounges,
    required this.traceSteps,
  });
}

class DisjointSetUnion {
  final Map<String, String> _parent = {};
  final Map<String, int> _rank = {};
  final Map<String, int> _size = {};

  DisjointSetUnion(Iterable<String> elements) {
    for (final e in elements) {
      _parent[e] = e;
      _rank[e] = 0;
      _size[e] = 1;
    }
  }

  String find(String x) {
    if (_parent[x] != x) {
      _parent[x] = find(_parent[x]!);
    }
    return _parent[x]!;
  }

  int componentSize(String x) => _size[find(x)] ?? 1;

  bool union(String a, String b, {int maxGroupSize = 5}) {
    final rootA = find(a);
    final rootB = find(b);
    if (rootA == rootB) return false;
    if ((_size[rootA]! + _size[rootB]!) > maxGroupSize) return false;

    if (_rank[rootA]! < _rank[rootB]!) {
      _parent[rootA] = rootB;
      _size[rootB] = _size[rootB]! + _size[rootA]!;
    } else if (_rank[rootA]! > _rank[rootB]!) {
      _parent[rootB] = rootA;
      _size[rootA] = _size[rootA]! + _size[rootB]!;
    } else {
      _parent[rootB] = rootA;
      _size[rootA] = _size[rootA]! + _size[rootB]!;
      _rank[rootA] = _rank[rootA]! + 1;
    }
    return true;
  }
}

class BenchlyGraphMatchmaker {
  static const List<String> pseudocode = [
    '1. Build Compatibility Graph G=(V,E) over waiting EWU queue pool',
    '2. Compute edge weights w(u,v) = PrefMatch + TopicAffinity + WaitBoost',
    '3. Construct Flow Network (Source s -> Left Set -> Right Set -> Sink t)',
    '4. Run Edmonds-Karp BFS augmenting paths on residual graph G_f O(V E^2)',
    '5. Extract maximum compatibility 1v1 bench pairs & compare vs V1 FIFO lpop',
    '6. Run Kruskal Maximum Spanning Forest (DSU) for 5-person Group Haunts',
  ];

  static int computeCompatibility(WaitingStudentNode a, WaitingStudentNode b) {
    if (a.id == b.id) return -1;
    final aAllowsB = a.seeking == 'any' || a.seeking == b.gender;
    final bAllowsA = b.seeking == 'any' || b.seeking == a.gender;
    if (!aAllowsB || !bAllowsA) return -1;

    var score = 40;
    if (a.topic == b.topic) score += 30;
    score += (a.dept == b.dept) ? 15 : 10;
    score += math.min(15, (a.waitSeconds + b.waitSeconds) ~/ 4);
    return score.clamp(1, 100);
  }

  static MatchmakingFlowResult runMatchmaking(List<WaitingStudentNode> pool) {
    final trace = <AlgoTraceStep>[];
    final n = pool.length;

    trace.add(AlgoTraceStep(
      stepIndex: 0,
      title: 'Queue Pool Hydrated ($n EWU Students Waiting)',
      detail: 'Evaluating compatibility matrix across gender preferences, topics, and wait starvation.',
      pseudocodeLine: 0,
      stateSnapshot: {'poolSize': n},
    ));

    final fifoUsed = <String>{};
    final fifoPairs = <MatchedBenchPair>[];
    var fifoScore = 0;

    for (var i = 0; i < n; i++) {
      if (fifoUsed.contains(pool[i].id)) continue;
      for (var j = i + 1; j < n; j++) {
        if (fifoUsed.contains(pool[j].id)) continue;
        final w = computeCompatibility(pool[i], pool[j]);
        if (w > 0) {
          fifoUsed.add(pool[i].id);
          fifoUsed.add(pool[j].id);
          fifoPairs.add(MatchedBenchPair(
            studentA: pool[i],
            studentB: pool[j],
            compatibilityScore: w,
            reason: 'V1 FIFO First-Available Queue Pop',
          ));
          fifoScore += w;
          break;
        }
      }
    }

    final leftIndices = <int>[];
    final rightIndices = <int>[];
    for (var i = 0; i < n; i++) {
      if (i.isEven) {
        leftIndices.add(i);
      } else {
        rightIndices.add(i);
      }
    }

    final totalVertices = n + 2;
    const source = 0;
    final sink = n + 1;
    final capacity = List.generate(totalVertices, (_) => List<int>.filled(totalVertices, 0));

    for (final li in leftIndices) {
      capacity[source][li + 1] = 1;
      for (final ri in rightIndices) {
        if (computeCompatibility(pool[li], pool[ri]) > 0) {
          capacity[li + 1][ri + 1] = 1;
        }
      }
    }
    for (final ri in rightIndices) {
      capacity[ri + 1][sink] = 1;
    }

    var maxFlow = 0;
    while (true) {
      final parent = List<int>.filled(totalVertices, -1);
      parent[source] = source;
      final queue = <int>[source];
      var qHead = 0;

      while (qHead < queue.length && parent[sink] == -1) {
        final u = queue[qHead++];
        final neighbors = <int>[];
        for (var v = 0; v < totalVertices; v++) {
          if (parent[v] == -1 && capacity[u][v] > 0) {
            neighbors.add(v);
          }
        }
        neighbors.sort((a, b) {
          if (u >= 1 && u <= n && a >= 1 && a <= n && b >= 1 && b <= n) {
            return computeCompatibility(pool[u - 1], pool[b - 1])
                .compareTo(computeCompatibility(pool[u - 1], pool[a - 1]));
          }
          return a.compareTo(b);
        });

        for (final v in neighbors) {
          parent[v] = u;
          queue.add(v);
        }
      }

      if (parent[sink] == -1) break;

      var pathFlow = 999;
      var cur = sink;
      final pathLabels = <String>['Sink(t)'];
      while (cur != source) {
        final prev = parent[cur];
        pathFlow = math.min(pathFlow, capacity[prev][cur]);
        if (cur >= 1 && cur <= n) {
          pathLabels.add(pool[cur - 1].alias);
        }
        cur = prev;
      }
      pathLabels.add('Source(s)');

      cur = sink;
      while (cur != source) {
        final prev = parent[cur];
        capacity[prev][cur] -= pathFlow;
        capacity[cur][prev] += pathFlow;
        cur = prev;
      }
      maxFlow += pathFlow;

      trace.add(AlgoTraceStep(
        stepIndex: trace.length,
        title: 'Edmonds-Karp Augmenting Path #$maxFlow Found',
        detail: 'Augmented +$pathFlow flow along: ${pathLabels.reversed.join(" -> ")}',
        pseudocodeLine: 3,
        stateSnapshot: {
          'maxFlow': maxFlow,
          'augmentingPath': pathLabels.reversed.toList(),
        },
      ));
    }

    final allCandidateEdges = <MatchedBenchPair>[];
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        final w = computeCompatibility(pool[i], pool[j]);
        if (w > 0) {
          final reasons = <String>[];
          if (pool[i].topic == pool[j].topic) reasons.add('Shared Topic (${pool[i].topic})');
          reasons.add(pool[i].dept == pool[j].dept
              ? 'Same Dept (${pool[i].dept})'
              : 'Cross-Dept (${pool[i].dept}x${pool[j].dept})');
          allCandidateEdges.add(MatchedBenchPair(
            studentA: pool[i],
            studentB: pool[j],
            compatibilityScore: w,
            reason: reasons.join(' • '),
          ));
        }
      }
    }

    allCandidateEdges.sort((a, b) => b.compatibilityScore.compareTo(a.compatibilityScore));
    final optUsed = <String>{};
    final optimalPairs = <MatchedBenchPair>[];
    var optimalScore = 0;

    for (final edge in allCandidateEdges) {
      if (!optUsed.contains(edge.studentA.id) && !optUsed.contains(edge.studentB.id)) {
        optUsed.add(edge.studentA.id);
        optUsed.add(edge.studentB.id);
        optimalPairs.add(edge);
        optimalScore += edge.compatibilityScore;
      }
    }

    final dsu = DisjointSetUnion(pool.map((s) => s.id));
    var kruskalMerges = 0;
    for (final edge in allCandidateEdges) {
      if (dsu.union(edge.studentA.id, edge.studentB.id, maxGroupSize: 5)) {
        kruskalMerges++;
      }
    }

    final groupsMap = <String, List<String>>{};
    for (final s in pool) {
      final root = dsu.find(s.id);
      groupsMap.putIfAbsent(root, () => []).add('${s.alias} (${s.badge})');
    }

    trace.add(AlgoTraceStep(
      stepIndex: trace.length,
      title: 'Kruskal MST 5-Person Group Haunts Clustered',
      detail:
          'Formed ${groupsMap.length} Cafeteria Group Haunt lounges via $kruskalMerges Disjoint-Set Union operations. Total 1v1 Compatibility: $optimalScore (vs V1 FIFO: $fifoScore).',
      pseudocodeLine: 5,
      stateSnapshot: {
        'optimalScore': optimalScore,
        'fifoScore': fifoScore,
        'lounges': groupsMap.values.toList(),
      },
    ));

    return MatchmakingFlowResult(
      optimalPairs: optimalPairs,
      naiveFifoPairs: fifoPairs,
      totalOptimalCompatibility: optimalScore,
      totalFifoCompatibility: fifoScore,
      maxFlowValue: math.max(maxFlow, optimalPairs.length),
      groupHauntLounges: groupsMap.values.toList(),
      traceSteps: trace,
    );
  }
}
