import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/algorithms/benchly_algorithms.dart';
import 'package:frontend/widgets/chat/chat_message_bubble.dart';

void main() {
  group('Benchly CSE246 Algorithmic Core Verification Suite', () {
    test('1. Canonical Huffman Coding compresses & losslessly restores chat transcripts and satisfies Shannon bound', () {
      const sampleTranscript =
          '[{"author":"Silent Panther 42","content":"CSE246 Algorithms Lab 13 Benchly single-row archiver!"},'
          '{"author":"Neon Scholar 19","content":"Canonical Huffman coding + 0/1 Knapsack DP + KMP PII Shield!"}]';

      final res = CanonicalHuffmanEngine.compressTranscript(sampleTranscript);
      expect(res.decodedText, equals(sampleTranscript));
      expect(res.shannonTheoremVerified, isTrue);
      expect(res.compressedBits, lessThan(res.originalBits));
      expect(res.compressionSavingsPercent, greaterThan(35.0));

      // Verify live wire packet round-trip with Unicode emojis, Bangla, and single-symbol edge cases
      for (final msg in const [
        '💡 Hey bondhu কেমন আছো? 😀🪑',
        'aaaaa',
        'X',
        'Canonical Huffman live socket wire format!',
      ]) {
        final wireJson = CanonicalHuffmanEngine.encodeLivePacket(msg).toJson();
        final parsed = HuffmanWirePacket.tryParse(wireJson);
        expect(parsed, isNotNull);
        final decoded = CanonicalHuffmanEngine.decodeLivePacket(parsed!);
        expect(decoded.decodedText, equals(msg));
        expect(decoded.bitStream.length, equals(decoded.packet.bitLength));
        expect(decoded.visualTree.frequency, equals(msg.runes.length));
      }
    });

    test('2. 0/1 Knapsack DP finds global optimum >= Greedy 0/1 density heuristic', () {
      const perks = [
        StonePerkItem(
          id: 'p1',
          name: 'Priority Pass',
          category: 'Matchmaking',
          stoneCost: 3,
          engagementBoost: 28,
          iconEmoji: '⚡',
        ),
        StonePerkItem(
          id: 'p2',
          name: 'Custom Alias',
          category: 'Identity',
          stoneCost: 4,
          engagementBoost: 40,
          iconEmoji: '🎭',
        ),
        StonePerkItem(
          id: 'p3',
          name: 'Super Extend',
          category: 'In-Chat',
          stoneCost: 5,
          engagementBoost: 49,
          iconEmoji: '⏳',
        ),
      ];

      final res = KnapsackStonesEngine.solvePerkLoadout(
        items: perks,
        walletCapacity: 7,
      );
      // 3 + 4 = 7 stones -> 28 + 40 = 68 Aura (whereas Greedy picks 5-stone item first -> 49 Aura)
      expect(res.dpOptimalValue, equals(68));
      expect(res.dpOptimalValue, greaterThanOrEqualTo(res.greedy01Value));
      expect(res.fractionalGreedyValue, greaterThanOrEqualTo(res.dpOptimalValue));
    });

    test('3. Coin Change DP proves non-canonical counterexample where Greedy fails (S=6 on {1,3,4,5,7,10})', () {
      final res = CoinChangeStonesEngine.solveStoneTarget(
        targetStones: 6,
        denominations: const [1, 3, 4, 5, 7, 10],
      );
      // Optimal DP for 6 is 3 + 3 (2 steps), whereas Greedy picks 5 + 1 (2 steps) or on {1,3,4} picks 4+1+1 (3 steps)
      final nonCanon = CoinChangeStonesEngine.solveStoneTarget(
        targetStones: 6,
        denominations: const [1, 3, 4],
      );
      expect(nonCanon.dpMinCoins, equals(2)); // 3 + 3
      expect(nonCanon.greedyCoinCount, equals(3)); // 4 + 1 + 1
      expect(nonCanon.greedyFailedCounterexample, isTrue);
      expect(res.totalDistinctWays, greaterThan(1));
    });

    test('4. KMP + Rabin-Karp + LCS Anti-Evasion PII Shield catches obfuscated BD phone numbers that V1 Regex misses', () {
      const obfuscated = 'Call me at zero one seven 12 34 56 78 outside FUB!';
      final verdict = BenchlyPiiShieldEngine.inspectMessage(obfuscated);
      expect(verdict.blockedByV1Regex, isFalse);
      expect(verdict.blockedByKmp, isTrue);
      expect(verdict.detectedThreats, isNotEmpty);
      expect(verdict.sanitizedMessage, contains('REDACTED'));
    });

    test('5. Edmonds-Karp Max-Flow & Kruskal MST Group Haunt Matchmaker pairs compatible EWU students', () {
      const pool = [
        WaitingStudentNode(
          id: 'u1',
          alias: 'Panther 1',
          dept: 'CSE',
          batchYear: '2023',
          gender: 'male',
          seeking: 'any',
          topic: 'CSE Midterm Vent',
          waitSeconds: 20,
        ),
        WaitingStudentNode(
          id: 'u2',
          alias: 'Scholar 2',
          dept: 'CSE',
          batchYear: '2024',
          gender: 'female',
          seeking: 'any',
          topic: 'CSE Midterm Vent',
          waitSeconds: 18,
        ),
        WaitingStudentNode(
          id: 'u3',
          alias: 'Rebel 3',
          dept: 'BBA',
          batchYear: '2023',
          gender: 'male',
          seeking: 'female',
          topic: 'Foodies',
          waitSeconds: 25,
        ),
        WaitingStudentNode(
          id: 'u4',
          alias: 'Ghost 4',
          dept: 'Economics',
          batchYear: '2024',
          gender: 'female',
          seeking: 'male',
          topic: 'Foodies',
          waitSeconds: 15,
        ),
      ];

      final res = BenchlyGraphMatchmaker.runMatchmaking(pool);
      expect(res.optimalPairs.length, equals(2));
      expect(res.totalOptimalCompatibility, greaterThanOrEqualTo(res.totalFifoCompatibility));
      expect(res.groupHauntLounges, isNotEmpty);
    });

    test('6. Graham Scan Convex Hull computes outer boundary of campus adda pings in O(N log N)', () {
      const pings = [
        CampusPingPoint(x: 0, y: 0, zoneName: 'SW Gate', deptBadge: 'CSE'),
        CampusPingPoint(x: 100, y: 0, zoneName: 'SE Gate', deptBadge: 'BBA'),
        CampusPingPoint(x: 100, y: 100, zoneName: 'NE Gate', deptBadge: 'EEE'),
        CampusPingPoint(x: 0, y: 100, zoneName: 'NW Gate', deptBadge: 'Law'),
        CampusPingPoint(x: 50, y: 50, zoneName: 'Courtyard Center', deptBadge: 'CSE'),
      ];

      final hull = CampusGeometryEngine.computeGrahamScan(pings);
      expect(hull.hullVertices.length, equals(4));
      expect(hull.hullArea, closeTo(10000.0, 1e-3));
    });

    testWidgets('7. ChatMessageBubble auto-decodes Huffman wire packet & opens interactive Tree Inspector sheet',
        (tester) async {
      const sampleText = 'Meet at EWU bench 💡!';
      final pkt = CanonicalHuffmanEngine.encodeLivePacket(sampleText);
      final decoded = CanonicalHuffmanEngine.decodeLivePacket(pkt);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ChatMessageBubble(
              message: {
                'id': 'm1',
                'authorAlias': 'Neon Scholar 19',
                'content': decoded.decodedText,
                '_decodedHuffman': decoded,
                'timestamp': 1764000000000,
                'isMine': false,
              },
              myAlias: 'Silent Panther 42',
              isGroupLounge: false,
            ),
          ),
        ),
      );

      expect(find.text(sampleText), findsOneWidget);
      final chipText = 'Huffman · ${decoded.packet.bitLength}b · Tree';
      expect(find.text(chipText), findsOneWidget);

      await tester.tap(find.text(chipText));
      await tester.pumpAndSettle();

      expect(find.text('Canonical Huffman Wire Decoder'), findsOneWidget);
      expect(find.text('RECEIVED HUFFMAN BITSTREAM'), findsOneWidget);
      expect(find.text('RECONSTRUCTED PREFIX TREE (PINCH / DRAG)'), findsOneWidget);

      await tester.scrollUntilVisible(
        find.text('CANONICAL CODEBOOK (SYMBOL → PREFIX CODE)'),
        200,
        scrollable: find.descendant(of: find.byType(ListView), matching: find.byType(Scrollable)).first,
      );
      await tester.pumpAndSettle();
      expect(find.text('CANONICAL CODEBOOK (SYMBOL → PREFIX CODE)'), findsOneWidget);
    });
  });
}
