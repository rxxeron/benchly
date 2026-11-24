import 'dart:math' as math;
import 'algo_trace.dart';

class StonePerkItem {
  final String id;
  final String name;
  final String category;
  final int stoneCost;
  final int engagementBoost;
  final String iconEmoji;

  const StonePerkItem({
    required this.id,
    required this.name,
    required this.category,
    required this.stoneCost,
    required this.engagementBoost,
    required this.iconEmoji,
  });

  double get density => stoneCost > 0 ? engagementBoost / stoneCost : 0.0;
}

class KnapsackComparisonResult {
  final int capacityStones;
  final int dpOptimalValue;
  final int dpUsedWeight;
  final List<StonePerkItem> dpSelectedItems;
  final List<List<int>> dpTable;
  final int greedy01Value;
  final int greedy01Weight;
  final List<StonePerkItem> greedy01SelectedItems;
  final double fractionalGreedyValue;
  final List<Map<String, dynamic>> fractionalSelections;
  final int memoizedRecursiveCalls;
  final List<AlgoTraceStep> traceSteps;

  const KnapsackComparisonResult({
    required this.capacityStones,
    required this.dpOptimalValue,
    required this.dpUsedWeight,
    required this.dpSelectedItems,
    required this.dpTable,
    required this.greedy01Value,
    required this.greedy01Weight,
    required this.greedy01SelectedItems,
    required this.fractionalGreedyValue,
    required this.fractionalSelections,
    required this.memoizedRecursiveCalls,
    required this.traceSteps,
  });
}

class KnapsackStonesEngine {
  static const List<String> pseudocode = [
    '1. Initialize DP table dp[0..n][0..W] = 0',
    '2. For each Perk/Room item i = 1..n (cost w_i, boost v_i):',
    '3.   For stone budget w = 0..W:',
    '4.     If w_i <= w: dp[i][w] = max(dp[i-1][w], v_i + dp[i-1][w - w_i])',
    '5.     Else: dp[i][w] = dp[i-1][w]',
    '6. Traceback from dp[n][W] to recover exact 0/1 optimal perk loadout',
    '7. Compare against Greedy Value-Density (v_i / w_i) & Fractional Knapsack',
  ];

  static KnapsackComparisonResult solvePerkLoadout({
    required List<StonePerkItem> items,
    required int walletCapacity,
  }) {
    final n = items.length;
    final W = walletCapacity.clamp(1, 60);
    final dp = List.generate(n + 1, (_) => List<int>.filled(W + 1, 0));
    final trace = <AlgoTraceStep>[];

    trace.add(AlgoTraceStep(
      stepIndex: 0,
      title: 'Initialized (n+1) x (W+1) Tabulation Matrix',
      detail: 'Evaluating $n Benchly perks/caches against budget W = $W 💎.',
      pseudocodeLine: 0,
      stateSnapshot: {'rows': n + 1, 'cols': W + 1},
    ));

    for (var i = 1; i <= n; i++) {
      final item = items[i - 1];
      for (var w = 0; w <= W; w++) {
        if (item.stoneCost <= w) {
          final exclude = dp[i - 1][w];
          final include = item.engagementBoost + dp[i - 1][w - item.stoneCost];
          dp[i][w] = math.max(exclude, include);
        } else {
          dp[i][w] = dp[i - 1][w];
        }
      }
      trace.add(AlgoTraceStep(
        stepIndex: trace.length,
        title: 'Row $i Evaluated: ${item.iconEmoji} ${item.name} (${item.stoneCost}💎, +${item.engagementBoost})',
        detail:
            'Best utility at full capacity W=$W is now dp[$i][$W] = ${dp[i][W]} (density: ${item.density.toStringAsFixed(2)}).',
        pseudocodeLine: 3,
        stateSnapshot: {
          'rowIndex': i,
          'itemName': item.name,
          'rowValues': List<int>.from(dp[i]),
        },
      ));
    }

    final selectedDp = <StonePerkItem>[];
    var remW = W;
    for (var i = n; i >= 1; i--) {
      if (dp[i][remW] != dp[i - 1][remW]) {
        final item = items[i - 1];
        selectedDp.add(item);
        remW -= item.stoneCost;
      }
    }
    final dpUsedWeight = W - remW;

    var memoCalls = 0;
    final memo = List.generate(n + 1, (_) => List<int?>.filled(W + 1, null));
    int solveMemo(int idx, int cap) {
      memoCalls++;
      if (idx == 0 || cap <= 0) return 0;
      if (memo[idx][cap] != null) return memo[idx][cap]!;
      final it = items[idx - 1];
      final res = it.stoneCost > cap
          ? solveMemo(idx - 1, cap)
          : math.max(
              solveMemo(idx - 1, cap),
              it.engagementBoost + solveMemo(idx - 1, cap - it.stoneCost),
            );
      memo[idx][cap] = res;
      return res;
    }

    solveMemo(n, W);

    final sortedByDensity = List<StonePerkItem>.from(items)
      ..sort((a, b) => b.density.compareTo(a.density));

    var greedy01Weight = 0;
    var greedy01Value = 0;
    final greedy01Items = <StonePerkItem>[];

    var fracRem = W.toDouble();
    var fracValue = 0.0;
    final fracSelections = <Map<String, dynamic>>[];

    for (final it in sortedByDensity) {
      if (greedy01Weight + it.stoneCost <= W) {
        greedy01Weight += it.stoneCost;
        greedy01Value += it.engagementBoost;
        greedy01Items.add(it);
      }
      if (fracRem > 0) {
        if (it.stoneCost <= fracRem) {
          fracRem -= it.stoneCost;
          fracValue += it.engagementBoost;
          fracSelections.add({'item': it.name, 'fraction': 1.0, 'gain': it.engagementBoost.toDouble()});
        } else {
          final frac = fracRem / it.stoneCost;
          final gain = it.engagementBoost * frac;
          fracValue += gain;
          fracSelections.add({'item': it.name, 'fraction': frac, 'gain': gain});
          fracRem = 0;
        }
      }
    }

    trace.add(AlgoTraceStep(
      stepIndex: trace.length,
      title: 'Traceback Complete & Greedy Comparison Verified',
      detail:
          '0/1 DP Optimal = ${dp[n][W]} (+${dp[n][W] - greedy01Value} over Greedy 0/1 = $greedy01Value). Fractional upper bound = ${fracValue.toStringAsFixed(1)}.',
      pseudocodeLine: 6,
      stateSnapshot: {
        'dpOptimal': dp[n][W],
        'greedy01': greedy01Value,
        'fractional': fracValue,
      },
    ));

    return KnapsackComparisonResult(
      capacityStones: W,
      dpOptimalValue: dp[n][W],
      dpUsedWeight: dpUsedWeight,
      dpSelectedItems: selectedDp.reversed.toList(),
      dpTable: dp,
      greedy01Value: greedy01Value,
      greedy01Weight: greedy01Weight,
      greedy01SelectedItems: greedy01Items,
      fractionalGreedyValue: fracValue,
      fractionalSelections: fracSelections,
      memoizedRecursiveCalls: memoCalls,
      traceSteps: trace,
    );
  }
}

class CoinChangeResult {
  final int targetStones;
  final List<int> denominations;
  final int dpMinCoins;
  final List<int> dpChosenCoins;
  final int greedyCoinCount;
  final List<int> greedyChosenCoins;
  final int totalDistinctWays;
  final List<int> dpMinArray;
  final bool greedyFailedCounterexample;
  final List<AlgoTraceStep> traceSteps;

  const CoinChangeResult({
    required this.targetStones,
    required this.denominations,
    required this.dpMinCoins,
    required this.dpChosenCoins,
    required this.greedyCoinCount,
    required this.greedyChosenCoins,
    required this.totalDistinctWays,
    required this.dpMinArray,
    required this.greedyFailedCounterexample,
    required this.traceSteps,
  });
}

class CoinChangeStonesEngine {
  static const List<String> pseudocode = [
    '1. Sort Campus Stone milestone denominations C = [c_1, c_2, ..., c_k]',
    '2. Initialize dpMin[0] = 0, dpMin[1..S] = INF; parentCoin[1..S] = -1',
    '3. For amount x = 1..S:',
    '4.   For each coin c in C where c <= x:',
    '5.     If dpMin[x - c] + 1 < dpMin[x]: dpMin[x] = dpMin[x - c] + 1',
    '6. Compute 2D Coin-Change Ways: ways[x] += ways[x - c]',
    '7. Run Greedy largest-first choice and check if Greedy > DP (Counterexample!)',
  ];

  static CoinChangeResult solveStoneTarget({
    required int targetStones,
    List<int> denominations = const [1, 3, 4, 5, 7, 10],
  }) {
    final S = targetStones.clamp(1, 80);
    final coins = List<int>.from(denominations)..sort();
    final trace = <AlgoTraceStep>[];

    const inf = 999999;
    final dpMin = List<int>.filled(S + 1, inf);
    final parentCoin = List<int>.filled(S + 1, -1);
    dpMin[0] = 0;

    for (var x = 1; x <= S; x++) {
      for (final c in coins) {
        if (c <= x && dpMin[x - c] + 1 < dpMin[x]) {
          dpMin[x] = dpMin[x - c] + 1;
          parentCoin[x] = c;
        }
      }
      if (x <= 12 || x == S) {
        trace.add(AlgoTraceStep(
          stepIndex: trace.length,
          title: 'DP State dpMin[$x] Solved',
          detail:
              'Minimum milestones for $x 💎 is ${dpMin[x]} (last transition used +${parentCoin[x]} 💎).',
          pseudocodeLine: 4,
          stateSnapshot: {
            'amount': x,
            'minCoins': dpMin[x],
            'usedCoin': parentCoin[x],
          },
        ));
      }
    }

    final dpChosen = <int>[];
    var cur = S;
    while (cur > 0 && parentCoin[cur] != -1) {
      dpChosen.add(parentCoin[cur]);
      cur -= parentCoin[cur];
    }

    final ways = List<int>.filled(S + 1, 0);
    ways[0] = 1;
    for (final c in coins) {
      for (var x = c; x <= S; x++) {
        ways[x] += ways[x - c];
      }
    }

    final descCoins = coins.reversed.toList();
    final greedyChosen = <int>[];
    var rem = S;
    for (final c in descCoins) {
      while (rem >= c) {
        greedyChosen.add(c);
        rem -= c;
      }
    }

    final greedyFailed = rem != 0 || greedyChosen.length > dpChosen.length;

    trace.add(AlgoTraceStep(
      stepIndex: trace.length,
      title: greedyFailed
          ? '⚠️ Non-Canonical Counterexample Proven: DP Beats Greedy!'
          : 'DP & Greedy Comparison Completed',
      detail:
          'Target $S 💎 -> DP Optimal = ${dpChosen.length} (${dpChosen.join("+")}) vs Greedy = ${greedyChosen.length} (${greedyChosen.join("+")}). Total distinct combinations = ${ways[S]}.',
      pseudocodeLine: 6,
      stateSnapshot: {
        'dpChosen': dpChosen,
        'greedyChosen': greedyChosen,
        'ways': ways[S],
        'greedyFailed': greedyFailed,
      },
    ));

    return CoinChangeResult(
      targetStones: S,
      denominations: coins,
      dpMinCoins: dpChosen.length,
      dpChosenCoins: dpChosen,
      greedyCoinCount: greedyChosen.length,
      greedyChosenCoins: greedyChosen,
      totalDistinctWays: ways[S],
      dpMinArray: dpMin,
      greedyFailedCounterexample: greedyFailed,
      traceSteps: trace,
    );
  }
}
