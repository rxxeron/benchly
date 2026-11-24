import 'dart:math' as math;
import 'algo_trace.dart';

class PiiShieldAuditResult {
  final String originalMessage;
  final String sanitizedMessage;
  final String normalizedPhoneCandidate;
  final bool blockedByV1Regex;
  final bool blockedByKmp;
  final bool blockedByRabinKarp;
  final bool blockedByLcsDp;
  final List<String> detectedThreats;
  final List<int> kmpLpsTable;
  final int kmpComparisons;
  final int naiveComparisons;
  final double lcsSimilarityRatio;
  final List<AlgoTraceStep> traceSteps;

  const PiiShieldAuditResult({
    required this.originalMessage,
    required this.sanitizedMessage,
    required this.normalizedPhoneCandidate,
    required this.blockedByV1Regex,
    required this.blockedByKmp,
    required this.blockedByRabinKarp,
    required this.blockedByLcsDp,
    required this.detectedThreats,
    required this.kmpLpsTable,
    required this.kmpComparisons,
    required this.naiveComparisons,
    required this.lcsSimilarityRatio,
    required this.traceSteps,
  });
}

class BenchlyPiiShieldEngine {
  static const List<String> pseudocode = [
    '1. De-obfuscate phonetic/spaced Bangla & English digit tokens ("zero one seven" -> "017")',
    '2. Build KMP Prefix-Function pi[0..M-1] (LPS table) in O(M) time',
    '3. Scan message with KMP automaton in O(N+M) with zero character backtracking',
    '4. Compute Rabin-Karp polynomial rolling hash H = (H*B + c) mod Q for spam shingles',
    '5. Run Longest Common Subsequence (LCS) DP O(N*M) against forbidden social patterns',
    '6. Emit sanitized Zero-PII payload and log shield telemetry',
  ];

  static final RegExp _v1EmailRegex =
      RegExp(r'[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+', caseSensitive: false);
  static final RegExp _v1PhoneRegex = RegExp(r'(?:\+88)?01[3-9]\d{8}');
  static final RegExp _tokenSplitRegex = RegExp(r'[\s,.\-_:/\\|]+');
  static final RegExp _nonAlphaNumRegex = RegExp(r'[^a-z0-9@]');

  static const Map<String, String> _wordToDigit = {
    'zero': '0',
    'oh': '0',
    'o': '0',
    'one': '1',
    'two': '2',
    'three': '3',
    'four': '4',
    'five': '5',
    'six': '6',
    'seven': '7',
    'eight': '8',
    'nine': '9',
    'shunno': '0',
    'ek': '1',
    'dui': '2',
    'tin': '3',
    'char': '4',
    'pach': '5',
    'choy': '6',
    'shat': '7',
    'aat': '8',
    'noy': '9',
  };

  static List<int> buildKmpLps(String pattern) {
    final m = pattern.length;
    final lps = List<int>.filled(m, 0);
    var len = 0;
    var i = 1;
    while (i < m) {
      if (pattern[i] == pattern[len]) {
        len++;
        lps[i] = len;
        i++;
      } else {
        if (len != 0) {
          len = lps[len - 1];
        } else {
          lps[i] = 0;
          i++;
        }
      }
    }
    return lps;
  }

  static Map<String, dynamic> kmpSearchWithStats(String text, String pattern) {
    if (pattern.isEmpty || text.isEmpty) {
      return {'matches': <int>[], 'comparisons': 0, 'lps': <int>[]};
    }
    final lps = buildKmpLps(pattern);
    final matches = <int>[];
    var i = 0;
    var j = 0;
    var comparisons = 0;

    while (i < text.length) {
      comparisons++;
      if (pattern[j] == text[i]) {
        i++;
        j++;
      }
      if (j == pattern.length) {
        matches.add(i - j);
        j = lps[j - 1];
      } else if (i < text.length && pattern[j] != text[i]) {
        if (j != 0) {
          j = lps[j - 1];
        } else {
          i++;
        }
      }
    }
    return {'matches': matches, 'comparisons': comparisons, 'lps': lps};
  }

  static double computeLcsRatio(String a, String b) {
    if (a.isEmpty || b.isEmpty) return 0.0;
    final n = a.length;
    final m = b.length;
    var prev = List<int>.filled(m + 1, 0);
    var curr = List<int>.filled(m + 1, 0);
    for (var i = 1; i <= n; i++) {
      for (var j = 1; j <= m; j++) {
        curr[j] = (a.codeUnitAt(i - 1) == b.codeUnitAt(j - 1))
            ? prev[j - 1] + 1
            : math.max(prev[j], curr[j - 1]);
      }
      final tmp = prev;
      prev = curr;
      curr = tmp;
    }
    return prev[m] / m;
  }

  static PiiShieldAuditResult inspectMessage(
    String rawMessage, {
    String customPattern = '017',
  }) {
    final trace = <AlgoTraceStep>[];
    final lower = rawMessage.toLowerCase();

    final blockedV1 = _v1EmailRegex.hasMatch(rawMessage) || _v1PhoneRegex.hasMatch(rawMessage);

    final tokens = lower.split(_tokenSplitRegex);
    final digitStream = StringBuffer();
    for (final tok in tokens) {
      if (_wordToDigit.containsKey(tok)) {
        digitStream.write(_wordToDigit[tok]);
      } else {
        for (var i = 0; i < tok.length; i++) {
          final cu = tok.codeUnitAt(i);
          if (cu >= 48 && cu <= 57) {
            digitStream.writeCharCode(cu);
          }
        }
      }
    }
    final normalizedDigits = digitStream.toString();

    trace.add(AlgoTraceStep(
      stepIndex: 0,
      title: 'Phonetic & Leetspeak Normalization',
      detail: 'Extracted normalized digit stream "$normalizedDigits" from raw chat message.',
      pseudocodeLine: 0,
      stateSnapshot: {'normalizedDigits': normalizedDigits, 'blockedByV1Regex': blockedV1},
    ));

    final strippedAlpha = lower.replaceAll(_nonAlphaNumRegex, '');
    final kmpTarget = normalizedDigits.length >= 3 ? normalizedDigits : strippedAlpha;
    final kmpRes = kmpSearchWithStats(kmpTarget, customPattern.toLowerCase());
    final lps = List<int>.from(kmpRes['lps'] as List);
    final kmpComps = kmpRes['comparisons'] as int;
    final int naiveComps = kmpTarget.length * math.max<int>(1, customPattern.length);

    const bdPrefixes = ['013', '014', '015', '016', '017', '018', '019'];
    var kmpPhoneHit = false;
    for (final pfx in bdPrefixes) {
      final r = kmpSearchWithStats(normalizedDigits, pfx);
      for (final idx in r['matches'] as List<int>) {
        if (normalizedDigits.length - idx >= 11) {
          kmpPhoneHit = true;
          break;
        }
      }
    }

    const socialSignatures = [
      'facebookcom',
      'fbcom',
      'instagramcom',
      'instagr',
      'telegramme',
      'tme',
      'whatsapp',
      'stdewubdedu',
    ];
    var kmpSocialHit = false;
    for (final sig in socialSignatures) {
      final r = kmpSearchWithStats(strippedAlpha, sig);
      if ((r['matches'] as List).isNotEmpty) {
        kmpSocialHit = true;
        break;
      }
    }
    final blockedByKmp = kmpPhoneHit || kmpSocialHit || (kmpRes['matches'] as List).isNotEmpty;

    trace.add(AlgoTraceStep(
      stepIndex: trace.length,
      title: 'KMP Automaton Scan Completed (O(N+M))',
      detail:
          'LPS Table for "$customPattern": $lps. KMP used $kmpComps comparisons vs Naive $naiveComps. Hit: $blockedByKmp.',
      pseudocodeLine: 2,
      stateSnapshot: {
        'lps': lps,
        'kmpComparisons': kmpComps,
        'naiveComparisons': naiveComps,
        'blockedByKmp': blockedByKmp,
      },
    ));

    const base = 257;
    const mod = 1000000007;
    const windowK = 5;
    final seenShingles = <int, int>{};
    var repeatedShingles = 0;

    if (strippedAlpha.length >= windowK) {
      var hash = 0;
      var highPow = 1;
      for (var i = 0; i < windowK - 1; i++) {
        highPow = (highPow * base) % mod;
      }
      for (var i = 0; i < windowK; i++) {
        hash = (hash * base + strippedAlpha.codeUnitAt(i)) % mod;
      }
      seenShingles[hash] = 1;

      for (var i = windowK; i < strippedAlpha.length; i++) {
        final leftChar = strippedAlpha.codeUnitAt(i - windowK);
        final rightChar = strippedAlpha.codeUnitAt(i);
        hash = (hash - (leftChar * highPow) % mod + mod) % mod;
        hash = (hash * base + rightChar) % mod;
        final c = (seenShingles[hash] ?? 0) + 1;
        seenShingles[hash] = c;
        if (c >= 3) repeatedShingles++;
      }
    }
    final blockedByRabinKarp = repeatedShingles >= 2;

    trace.add(AlgoTraceStep(
      stepIndex: trace.length,
      title: 'Rabin-Karp Rolling Hash Shingle Audit',
      detail:
          'Evaluated ${math.max(0, strippedAlpha.length - windowK + 1)} rolling windows in O(N); repeated flood shingles: $repeatedShingles.',
      pseudocodeLine: 3,
      stateSnapshot: {'repeatedShingles': repeatedShingles, 'blockedByRabinKarp': blockedByRabinKarp},
    ));

    var maxLcsRatio = 0.0;
    for (final sig in const ['instagram', 'facebook', 'whatsapp', 'telegram', 'ewubdedu']) {
      final ratio = computeLcsRatio(strippedAlpha, sig);
      if (ratio > maxLcsRatio) maxLcsRatio = ratio;
    }
    final blockedByLcs = maxLcsRatio >= 0.85;

    final threats = <String>[];
    if (kmpPhoneHit) threats.add('Obfuscated BD Phone Number ($normalizedDigits)');
    if (kmpSocialHit || blockedByLcs) {
      threats.add('Disguised Social Handle (LCS Similarity ${(maxLcsRatio * 100).toStringAsFixed(0)}%)');
    }
    if (blockedByRabinKarp) threats.add('Rabin-Karp Flood/Spam Pattern');

    final sanitized = threats.isNotEmpty
        ? '🛡️ [BENCHLY ALGO-SHIELD REDACTED: ${threats.join(" + ")}]'
        : rawMessage;

    trace.add(AlgoTraceStep(
      stepIndex: trace.length,
      title: 'LCS DP Matrix & Final Verdict',
      detail:
          'Max LCS Subsequence Match = ${(maxLcsRatio * 100).toStringAsFixed(1)}%. V1 Regex Caught: $blockedV1 | CSE246 Shield Caught: ${threats.isNotEmpty}.',
      pseudocodeLine: 5,
      stateSnapshot: {
        'lcsRatio': maxLcsRatio,
        'threats': threats,
        'sanitized': sanitized,
      },
    ));

    return PiiShieldAuditResult(
      originalMessage: rawMessage,
      sanitizedMessage: sanitized,
      normalizedPhoneCandidate: normalizedDigits,
      blockedByV1Regex: blockedV1,
      blockedByKmp: blockedByKmp,
      blockedByRabinKarp: blockedByRabinKarp,
      blockedByLcsDp: blockedByLcs,
      detectedThreats: threats,
      kmpLpsTable: lps,
      kmpComparisons: kmpComps,
      naiveComparisons: naiveComps,
      lcsSimilarityRatio: maxLcsRatio,
      traceSteps: trace,
    );
  }
}
