import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';
import 'algo_trace.dart';

class HuffmanNode implements Comparable<HuffmanNode> {
  final String? symbol;
  final int frequency;
  final HuffmanNode? left;
  final HuffmanNode? right;
  final int id;

  const HuffmanNode({
    this.symbol,
    required this.frequency,
    this.left,
    this.right,
    required this.id,
  });

  bool get isLeaf => left == null && right == null;

  @override
  int compareTo(HuffmanNode other) {
    final cmp = frequency.compareTo(other.frequency);
    if (cmp != 0) return cmp;
    return (symbol ?? '').compareTo(other.symbol ?? '');
  }
}

/// Custom Binary Min-Heap built from scratch for CSE246 Lab 4
class BinaryMinHeap<T extends Comparable<T>> {
  final List<T> _data = [];

  int get length => _data.length;
  bool get isEmpty => _data.isEmpty;
  List<T> get snapshot => List<T>.unmodifiable(_data);

  void insert(T item) {
    _data.add(item);
    _siftUp(_data.length - 1);
  }

  T extractMin() {
    if (_data.isEmpty) {
      throw StateError('Cannot extractMin from an empty Min-Heap');
    }
    final min = _data.first;
    final last = _data.removeLast();
    if (_data.isNotEmpty) {
      _data[0] = last;
      _siftDown(0);
    }
    return min;
  }

  void _siftUp(int idx) {
    var current = idx;
    while (current > 0) {
      final parent = (current - 1) >> 1;
      if (_data[current].compareTo(_data[parent]) < 0) {
        final tmp = _data[current];
        _data[current] = _data[parent];
        _data[parent] = tmp;
        current = parent;
      } else {
        break;
      }
    }
  }

  void _siftDown(int idx) {
    var current = idx;
    final n = _data.length;
    while (true) {
      final left = (current << 1) + 1;
      final right = left + 1;
      var smallest = current;
      if (left < n && _data[left].compareTo(_data[smallest]) < 0) {
        smallest = left;
      }
      if (right < n && _data[right].compareTo(_data[smallest]) < 0) {
        smallest = right;
      }
      if (smallest != current) {
        final tmp = _data[current];
        _data[current] = _data[smallest];
        _data[smallest] = tmp;
        current = smallest;
      } else {
        break;
      }
    }
  }
}

class HuffmanResult {
  final String originalText;
  final String encodedBits;
  final String decodedText;
  final Map<String, int> frequencies;
  final Map<String, String> canonicalCodes;
  final Map<String, int> codeLengths;
  final int originalBits;
  final int compressedBits;
  final int headerBits;
  final double shannonEntropy;
  final double averageCodeLength;
  final double compressionSavingsPercent;
  final bool shannonTheoremVerified;
  final List<AlgoTraceStep> traceSteps;

  const HuffmanResult({
    required this.originalText,
    required this.encodedBits,
    required this.decodedText,
    required this.frequencies,
    required this.canonicalCodes,
    required this.codeLengths,
    required this.originalBits,
    required this.compressedBits,
    required this.headerBits,
    required this.shannonEntropy,
    required this.averageCodeLength,
    required this.compressionSavingsPercent,
    required this.shannonTheoremVerified,
    required this.traceSteps,
  });
}

class HuffmanWirePacket {
  final String algorithm;
  final String packedBase64;
  final Map<String, int> codeLengths;
  final int originalLength;
  final int bitLength;
  final int originalBytes;
  final int compressedBytes;
  final int codebookBytes;
  final double shannonEntropy;
  final double averageCodeLength;
  final bool shannonVerified;
  final int distinctSymbols;
  final String symbolOrder;

  const HuffmanWirePacket({
    this.algorithm = 'canonical-huffman',
    required this.packedBase64,
    required this.codeLengths,
    required this.originalLength,
    required this.bitLength,
    required this.originalBytes,
    required this.compressedBytes,
    required this.codebookBytes,
    required this.shannonEntropy,
    required this.averageCodeLength,
    required this.shannonVerified,
    required this.distinctSymbols,
    this.symbolOrder = 'codepoint',
  });

  Map<String, dynamic> toJson() => {
        'algorithm': algorithm,
        'packedBase64': packedBase64,
        'codeLengths': codeLengths,
        'originalLength': originalLength,
        'bitLength': bitLength,
        'originalBytes': originalBytes,
        'compressedBytes': compressedBytes,
        'codebookBytes': codebookBytes,
        'shannonEntropy': shannonEntropy,
        'averageCodeLength': averageCodeLength,
        'shannonVerified': shannonVerified,
        'distinctSymbols': distinctSymbols,
        'symbolOrder': symbolOrder,
      };

  static HuffmanWirePacket? tryParse(dynamic raw) {
    if (raw is! Map) return null;
    final packed = raw['packedBase64']?.toString();
    final rawLengths = raw['codeLengths'];
    final origLen = (raw['originalLength'] as num?)?.toInt();
    if (packed == null || rawLengths is! Map || origLen == null || origLen < 0) {
      return null;
    }
    final lengths = <String, int>{};
    for (final entry in rawLengths.entries) {
      final k = entry.key.toString();
      final v = (entry.value as num?)?.toInt();
      if (k.isEmpty || v == null || v < 1 || v > 32) return null;
      lengths[k] = v;
    }
    final compBytes = (raw['compressedBytes'] as num?)?.toInt() ?? ((packed.length * 3) ~/ 4);
    return HuffmanWirePacket(
      algorithm: raw['algorithm']?.toString() ?? 'canonical-huffman',
      packedBase64: packed,
      codeLengths: lengths,
      originalLength: origLen,
      bitLength: (raw['bitLength'] as num?)?.toInt() ?? (compBytes * 8),
      originalBytes: (raw['originalBytes'] as num?)?.toInt() ?? origLen,
      compressedBytes: compBytes,
      codebookBytes: (raw['codebookBytes'] as num?)?.toInt() ?? utf8.encode(jsonEncode(lengths)).length,
      shannonEntropy: (raw['shannonEntropy'] as num?)?.toDouble() ?? 0.0,
      averageCodeLength: (raw['averageCodeLength'] as num?)?.toDouble() ?? 0.0,
      shannonVerified: raw['shannonVerified'] != false,
      distinctSymbols: (raw['distinctSymbols'] as num?)?.toInt() ?? lengths.length,
      symbolOrder: raw['symbolOrder']?.toString() ?? 'codepoint',
    );
  }
}

class VisualHuffmanNode {
  final String id;
  String? symbol;
  final String? bit;
  final String code;
  final int depth;
  int frequency;
  VisualHuffmanNode? left;
  VisualHuffmanNode? right;

  VisualHuffmanNode({
    required this.id,
    this.symbol,
    this.bit,
    required this.code,
    required this.depth,
    required this.frequency,
    this.left,
    this.right,
  });

  bool get isLeaf => symbol != null;
}

class DecodedHuffmanPayload {
  final String decodedText;
  final String bitStream;
  final HuffmanWirePacket packet;
  final Map<String, String> canonicalCodes;
  final Map<String, int> frequencies;
  final VisualHuffmanNode visualTree;

  const DecodedHuffmanPayload({
    required this.decodedText,
    required this.bitStream,
    required this.packet,
    required this.canonicalCodes,
    required this.frequencies,
    required this.visualTree,
  });
}

class _DecodeTrieNode {
  String? symbol;
  _DecodeTrieNode? left;
  _DecodeTrieNode? right;
}

class CanonicalHuffmanEngine {
  static const List<String> pseudocode = [
    '1. Count character frequencies f[c] by Unicode code point O(N)',
    '2. Push all K distinct symbols into BinaryMinHeap O(K log K)',
    '3. While heap.size > 1: extract 2 min nodes u, v',
    '4.   Create parent node w(freq = u.freq + v.freq) and insert into heap',
    '5. Traverse Huffman tree to extract symbol bit-lengths L[c]',
    '6. Sort symbols by (L[c] ASC, code-unit c ASC) for Canonical form',
    '7. Assign Canonical prefix codes & pack MSB-first bitstream O(N)',
    '8. Verify Shannon theorem H(X) <= L_avg < H(X) + 1 and decode via Trie',
  ];

  static List<String> _splitCodePoints(String input) {
    final cleaned = input.replaceAll('\u0000', '');
    return cleaned.runes.map(String.fromCharCode).toList(growable: false);
  }

  static Map<String, String> buildCanonicalCodes(Map<String, int> codeLengths) {
    if (codeLengths.isEmpty) return const {};
    final sortedSymbols = codeLengths.keys.toList()
      ..sort((a, b) {
        final c = codeLengths[a]!.compareTo(codeLengths[b]!);
        return c != 0 ? c : a.compareTo(b);
      });

    final canonicalCodes = <String, String>{};
    var codeValue = 0;
    var prevLen = codeLengths[sortedSymbols.first]!;

    for (var i = 0; i < sortedSymbols.length; i++) {
      final sym = sortedSymbols[i];
      final curLen = codeLengths[sym]!;
      if (i > 0) {
        codeValue = (codeValue + 1) << (curLen - prevLen);
      }
      canonicalCodes[sym] = codeValue.toRadixString(2).padLeft(curLen, '0');
      prevLen = curLen;
    }
    return canonicalCodes;
  }

  static HuffmanWirePacket encodeLivePacket(String rawText) {
    final cleaned = rawText.replaceAll('\u0000', '');
    final chars = _splitCodePoints(cleaned);
    if (chars.isEmpty) {
      return const HuffmanWirePacket(
        packedBase64: '',
        codeLengths: {},
        originalLength: 0,
        bitLength: 0,
        originalBytes: 0,
        compressedBytes: 0,
        codebookBytes: 2,
        shannonEntropy: 0,
        averageCodeLength: 0,
        shannonVerified: true,
        distinctSymbols: 0,
      );
    }

    final freq = <String, int>{};
    for (final ch in chars) {
      freq[ch] = (freq[ch] ?? 0) + 1;
    }

    final heap = BinaryMinHeap<HuffmanNode>();
    var nextId = 1;
    freq.forEach((sym, count) {
      heap.insert(HuffmanNode(symbol: sym, frequency: count, id: nextId++));
    });

    if (heap.length == 1) {
      final only = heap.extractMin();
      heap.insert(HuffmanNode(
        frequency: only.frequency,
        left: only,
        id: nextId++,
      ));
    }

    while (heap.length > 1) {
      final left = heap.extractMin();
      final right = heap.extractMin();
      heap.insert(HuffmanNode(
        frequency: left.frequency + right.frequency,
        left: left,
        right: right,
        id: nextId++,
      ));
    }

    final root = heap.extractMin();
    final lengths = <String, int>{};
    void extractLengths(HuffmanNode? node, int depth) {
      if (node == null) return;
      if (node.isLeaf && node.symbol != null) {
        lengths[node.symbol!] = math.max(1, depth);
        return;
      }
      extractLengths(node.left, depth + 1);
      extractLengths(node.right, depth + 1);
    }

    extractLengths(root, 0);
    final canonicalCodes = buildCanonicalCodes(lengths);

    final bitBuf = StringBuffer();
    for (final ch in chars) {
      bitBuf.write(canonicalCodes[ch]!);
    }
    final bitString = bitBuf.toString();
    final byteLen = (bitString.length + 7) >> 3;
    final bytes = Uint8List(byteLen);
    for (var i = 0; i < bitString.length; i++) {
      if (bitString.codeUnitAt(i) == 0x31) {
        bytes[i >> 3] |= 1 << (7 - (i & 7));
      }
    }

    final n = chars.length;
    var entropy = 0.0;
    var avgLen = 0.0;
    freq.forEach((sym, count) {
      final p = count / n;
      entropy += -p * (math.log(p) / math.ln2);
      avgLen += p * lengths[sym]!;
    });

    final originalBytes = utf8.encode(cleaned).length;
    final codebookBytes = utf8.encode(jsonEncode(lengths)).length;

    return HuffmanWirePacket(
      packedBase64: base64Encode(bytes),
      codeLengths: lengths,
      originalLength: chars.length,
      bitLength: bitString.length,
      originalBytes: originalBytes,
      compressedBytes: bytes.length,
      codebookBytes: codebookBytes,
      shannonEntropy: double.parse(entropy.toStringAsFixed(4)),
      averageCodeLength: double.parse(avgLen.toStringAsFixed(4)),
      shannonVerified:
          avgLen + 1e-9 >= entropy && (freq.length <= 1 ? avgLen <= entropy + 1.0 + 1e-9 : avgLen < entropy + 1.0),
      distinctSymbols: freq.length,
    );
  }

  static DecodedHuffmanPayload decodeLivePacket(HuffmanWirePacket packet) {
    if (packet.packedBase64.isEmpty || packet.originalLength <= 0 || packet.codeLengths.isEmpty) {
      return DecodedHuffmanPayload(
        decodedText: '',
        bitStream: '',
        packet: packet,
        canonicalCodes: const {},
        frequencies: const {},
        visualTree: VisualHuffmanNode(id: 'root', code: '', depth: 0, frequency: 0),
      );
    }

    final canonicalCodes = buildCanonicalCodes(packet.codeLengths);
    final trieRoot = _DecodeTrieNode();
    for (final entry in canonicalCodes.entries) {
      var cur = trieRoot;
      final bits = entry.value;
      for (var i = 0; i < bits.length; i++) {
        if (bits.codeUnitAt(i) == 0x30) {
          cur = cur.left ??= _DecodeTrieNode();
        } else {
          cur = cur.right ??= _DecodeTrieNode();
        }
      }
      cur.symbol = entry.key;
    }

    final bytes = base64Decode(packet.packedBase64);
    final decodedSymbols = <String>[];
    final frequencies = <String, int>{};
    final consumedBits = StringBuffer();

    var node = trieRoot;
    for (var byteIdx = 0; byteIdx < bytes.length && decodedSymbols.length < packet.originalLength; byteIdx++) {
      final byteVal = bytes[byteIdx];
      for (var bit = 7; bit >= 0 && decodedSymbols.length < packet.originalLength; bit--) {
        final isOne = (byteVal & (1 << bit)) != 0;
        consumedBits.write(isOne ? '1' : '0');
        final next = isOne ? node.right : node.left;
        if (next == null) {
          throw const FormatException('Corrupted Canonical Huffman bitstream');
        }
        node = next;
        if (node.symbol != null) {
          final sym = node.symbol!;
          decodedSymbols.add(sym);
          frequencies[sym] = (frequencies[sym] ?? 0) + 1;
          node = trieRoot;
        }
      }
    }

    if (decodedSymbols.length != packet.originalLength) {
      throw const FormatException('Truncated Canonical Huffman bitstream');
    }

    final decodedText = decodedSymbols.join();
    final visualTree = buildVisualTree(
      canonicalCodes: canonicalCodes,
      frequencies: frequencies,
    );

    var entropy = packet.shannonEntropy;
    var avgLen = packet.averageCodeLength;
    if (entropy == 0 && frequencies.length > 1) {
      final n = decodedSymbols.length;
      var e = 0.0;
      var l = 0.0;
      frequencies.forEach((sym, count) {
        final p = count / n;
        e += -p * (math.log(p) / math.ln2);
        l += p * (packet.codeLengths[sym] ?? 1);
      });
      entropy = double.parse(e.toStringAsFixed(4));
      avgLen = double.parse(l.toStringAsFixed(4));
    }

    final bitStream = consumedBits.toString();
    final enrichedPacket = HuffmanWirePacket(
      algorithm: packet.algorithm,
      packedBase64: packet.packedBase64,
      codeLengths: packet.codeLengths,
      originalLength: packet.originalLength,
      bitLength: bitStream.length,
      originalBytes: utf8.encode(decodedText).length,
      compressedBytes: bytes.length,
      codebookBytes: packet.codebookBytes,
      shannonEntropy: entropy,
      averageCodeLength: avgLen,
      shannonVerified: avgLen + 1e-9 >= entropy &&
          (canonicalCodes.length <= 1 ? avgLen <= entropy + 1.0 + 1e-9 : avgLen < entropy + 1.0),
      distinctSymbols: canonicalCodes.length,
      symbolOrder: packet.symbolOrder,
    );

    return DecodedHuffmanPayload(
      decodedText: decodedText,
      bitStream: bitStream,
      packet: enrichedPacket,
      canonicalCodes: canonicalCodes,
      frequencies: frequencies,
      visualTree: visualTree,
    );
  }

  static VisualHuffmanNode buildVisualTree({
    required Map<String, String> canonicalCodes,
    required Map<String, int> frequencies,
  }) {
    final root = VisualHuffmanNode(
      id: 'root',
      code: '',
      depth: 0,
      frequency: 0,
    );

    for (final entry in canonicalCodes.entries) {
      final sym = entry.key;
      final bits = entry.value;
      final freq = frequencies[sym] ?? 1;
      var cur = root;
      cur.frequency += freq;

      for (var i = 0; i < bits.length; i++) {
        final isZero = bits.codeUnitAt(i) == 0x30;
        final prefix = bits.substring(0, i + 1);
        if (isZero) {
          cur = cur.left ??= VisualHuffmanNode(
            id: 'n_$prefix',
            bit: '0',
            code: prefix,
            depth: i + 1,
            frequency: 0,
          );
        } else {
          cur = cur.right ??= VisualHuffmanNode(
            id: 'n_$prefix',
            bit: '1',
            code: prefix,
            depth: i + 1,
            frequency: 0,
          );
        }
        cur.frequency += freq;
      }
      cur.symbol = sym;
    }

    return root;
  }

  static HuffmanResult compressTranscript(String text) {
    final safeText = (text.isEmpty ? 'Benchly EWU Adda' : text).replaceAll('\u0000', '');
    final chars = _splitCodePoints(safeText);
    final trace = <AlgoTraceStep>[];
    final freq = <String, int>{};

    for (final ch in chars) {
      freq[ch] = (freq[ch] ?? 0) + 1;
    }

    trace.add(AlgoTraceStep(
      stepIndex: trace.length,
      title: 'Frequency Histogram Computed',
      detail: 'Scanned ${chars.length} Unicode symbols across ${freq.length} distinct characters.',
      pseudocodeLine: 0,
      stateSnapshot: {'frequencies': Map<String, int>.from(freq)},
    ));

    final heap = BinaryMinHeap<HuffmanNode>();
    var nextId = 1;
    freq.forEach((sym, count) {
      heap.insert(HuffmanNode(symbol: sym, frequency: count, id: nextId++));
    });

    trace.add(AlgoTraceStep(
      stepIndex: trace.length,
      title: 'Binary Min-Heap Initialized',
      detail: 'Inserted ${heap.length} leaf nodes into custom BinaryMinHeap.',
      pseudocodeLine: 1,
      stateSnapshot: {
        'heapTop': heap.snapshot
            .take(6)
            .map((n) => '${n.symbol ?? "Internal"}:${n.frequency}')
            .toList(),
      },
    ));

    if (heap.length == 1) {
      final only = heap.extractMin();
      heap.insert(HuffmanNode(
        frequency: only.frequency,
        left: only,
        id: nextId++,
      ));
    }

    var mergeCount = 0;
    while (heap.length > 1) {
      final left = heap.extractMin();
      final right = heap.extractMin();
      final merged = HuffmanNode(
        frequency: left.frequency + right.frequency,
        left: left,
        right: right,
        id: nextId++,
      );
      heap.insert(merged);
      mergeCount++;

      if (mergeCount <= 10 || heap.length <= 3) {
        trace.add(AlgoTraceStep(
          stepIndex: trace.length,
          title: 'Greedy Merge #$mergeCount',
          detail:
              'Extracted (${_fmtSym(left.symbol)}:${left.frequency}) + (${_fmtSym(right.symbol)}:${right.frequency}) -> Parent(${merged.frequency}). Remaining heap: ${heap.length}',
          pseudocodeLine: 2,
          stateSnapshot: {
            'left': '${_fmtSym(left.symbol)}:${left.frequency}',
            'right': '${_fmtSym(right.symbol)}:${right.frequency}',
            'mergedFreq': merged.frequency,
            'heapRemaining': heap.length,
          },
        ));
      }
    }

    final root = heap.extractMin();
    final lengths = <String, int>{};

    void extractLengths(HuffmanNode? node, int depth) {
      if (node == null) return;
      if (node.isLeaf && node.symbol != null) {
        lengths[node.symbol!] = math.max(1, depth);
        return;
      }
      extractLengths(node.left, depth + 1);
      extractLengths(node.right, depth + 1);
    }

    extractLengths(root, 0);
    final canonicalCodes = buildCanonicalCodes(lengths);

    trace.add(AlgoTraceStep(
      stepIndex: trace.length,
      title: 'Canonical Prefix Codebook Synthesized',
      detail:
          'Standardized ${canonicalCodes.length} prefix-free codes so only bit-lengths are sent on the wire / stored in Supabase.',
      pseudocodeLine: 5,
      stateSnapshot: {
        'sampleCodes': Map.fromEntries(canonicalCodes.entries.take(8)),
      },
    ));

    final buffer = StringBuffer();
    for (final ch in chars) {
      buffer.write(canonicalCodes[ch]!);
    }
    final encodedBits = buffer.toString();

    final trieRoot = _DecodeTrieNode();
    for (final e in canonicalCodes.entries) {
      var cur = trieRoot;
      for (var i = 0; i < e.value.length; i++) {
        if (e.value.codeUnitAt(i) == 0x30) {
          cur = cur.left ??= _DecodeTrieNode();
        } else {
          cur = cur.right ??= _DecodeTrieNode();
        }
      }
      cur.symbol = e.key;
    }

    final decodedBuffer = StringBuffer();
    var node = trieRoot;
    for (var i = 0; i < encodedBits.length; i++) {
      node = (encodedBits.codeUnitAt(i) == 0x30 ? node.left : node.right)!;
      if (node.symbol != null) {
        decodedBuffer.write(node.symbol!);
        node = trieRoot;
      }
    }
    final decodedText = decodedBuffer.toString();

    final totalN = chars.length;
    var entropy = 0.0;
    var avgLen = 0.0;
    freq.forEach((sym, count) {
      final p = count / totalN;
      entropy += -p * (math.log(p) / math.ln2);
      avgLen += p * lengths[sym]!;
    });

    final originalBits = utf8.encode(safeText).length * 8;
    final compressedBits = encodedBits.length;
    final headerBits = freq.length * 12;
    final savings = originalBits > 0
        ? ((originalBits - compressedBits) / originalBits * 100.0).clamp(0.0, 99.0)
        : 0.0;
    final verified =
        avgLen + 1e-9 >= entropy && (freq.length <= 1 ? avgLen <= entropy + 1.0 + 1e-9 : avgLen < entropy + 1.0);

    trace.add(AlgoTraceStep(
      stepIndex: trace.length,
      title: 'Shannon Bound & Lossless Roundtrip Verified',
      detail:
          'H(X) = ${entropy.toStringAsFixed(3)} bits/sym <= L_avg = ${avgLen.toStringAsFixed(3)} < H(X)+1. Saved ${savings.toStringAsFixed(1)}% bits.',
      pseudocodeLine: 7,
      stateSnapshot: {
        'entropy': entropy,
        'avgLen': avgLen,
        'savingsPct': savings,
        'roundtripExact': decodedText == safeText,
      },
    ));

    return HuffmanResult(
      originalText: safeText,
      encodedBits: encodedBits,
      decodedText: decodedText,
      frequencies: freq,
      canonicalCodes: canonicalCodes,
      codeLengths: lengths,
      originalBits: originalBits,
      compressedBits: compressedBits,
      headerBits: headerBits,
      shannonEntropy: entropy,
      averageCodeLength: avgLen,
      compressionSavingsPercent: savings,
      shannonTheoremVerified: verified,
      traceSteps: trace,
    );
  }

  static String formatDisplaySymbol(String? s) => _fmtSym(s);

  static String _fmtSym(String? s) {
    if (s == null) return 'Node';
    if (s == ' ') return '␣';
    if (s == '\n') return '↵';
    if (s == '\t') return '⇥';
    return s;
  }
}
