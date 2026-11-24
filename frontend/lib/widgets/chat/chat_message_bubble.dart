import 'package:flutter/material.dart';
import '../../algorithms/huffman_engine.dart';
import 'huffman_inspector_sheet.dart';

class ChatMessageBubble extends StatelessWidget {
  final Map<String, dynamic> message;
  final String myAlias;
  final bool isGroupLounge;

  const ChatMessageBubble({
    super.key,
    required this.message,
    required this.myAlias,
    required this.isGroupLounge,
  });

  @override
  Widget build(BuildContext context) {
    if (message['isSystem'] == true) {
      final isGuessHit = message['isGuessHit'] == true;
      final content = (message['content'] ?? '').toString();
      final isGuessMsg = content.startsWith('🎲');
      final accent = isGuessHit
          ? const Color(0xFF0FB881)
          : (isGuessMsg ? const Color(0xFF6366F1) : const Color(0xFFEF4444));
      final textCol = isGuessHit
          ? const Color(0xFF047857)
          : (isGuessMsg ? const Color(0xFF4338CA) : const Color(0xFFB91C1C));
      return Center(
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 10),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            color: accent.withValues(alpha: 0.14),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: accent.withValues(alpha: 0.3)),
          ),
          child: Text(
            content,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: textCol,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      );
    }

    final isMe = message['isMine'] == true ||
        (message['isMine'] == null && message['authorAlias'] == myAlias);
    final authorAlias = message['authorAlias']?.toString() ?? 'EWU Student';
    final contentStr = (message['content'] ?? '').toString();
    final isPiiCensored = message['piiShielded'] == true ||
        contentStr.contains('[CENSORED') ||
        contentStr.contains('ALGO-SHIELD');
    final decodedHuffman = message['_decodedHuffman'] as DecodedHuffmanPayload?;

    final rawTs = message['timestamp'];
    String timeLabel = '';
    if (rawTs is int) {
      final dt = DateTime.fromMillisecondsSinceEpoch(rawTs).toLocal();
      timeLabel = '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    }

    return RepaintBoundary(
      child: Align(
        alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
        child: GestureDetector(
          onLongPress: decodedHuffman == null
              ? null
              : () => showHuffmanInspectorSheet(
                    context,
                    payload: decodedHuffman,
                    authorAlias: authorAlias,
                  ),
          child: Container(
            margin: const EdgeInsets.only(bottom: 8),
            constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              gradient: isMe
                  ? const LinearGradient(
                      colors: [Color(0xFF6366F1), Color(0xFF4F46E5)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    )
                  : null,
              color: isMe ? null : const Color(0xFFFFFFFF),
              borderRadius: BorderRadius.only(
                topLeft: const Radius.circular(16),
                topRight: const Radius.circular(16),
                bottomLeft: isMe ? const Radius.circular(16) : const Radius.circular(4),
                bottomRight: isMe ? const Radius.circular(4) : const Radius.circular(16),
              ),
              border: Border.all(
                color: isMe
                    ? Colors.transparent
                    : (isPiiCensored
                        ? const Color(0xFFF59E0B).withValues(alpha: 0.4)
                        : const Color(0xFF1E1B18).withValues(alpha: 0.15)),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (isGroupLounge && !isMe)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 3),
                    child: Text(
                      authorAlias,
                      style: const TextStyle(
                        color: Color(0xFF059669),
                        fontSize: 10.5,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                Text(
                  contentStr,
                  style: TextStyle(
                    color: isMe ? Colors.white : const Color(0xFF1E1B18),
                    fontSize: 14,
                    height: 1.35,
                  ),
                ),
                if (isPiiCensored)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.shield_outlined, size: 11, color: Color(0xFFF59E0B)),
                        const SizedBox(width: 4),
                        Text(
                          'PII shielded by Benchly',
                          style: TextStyle(
                            fontSize: 10,
                            color: isMe
                                ? const Color(0xFFFDE68A)
                                : const Color(0xFFD97706),
                          ),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 5),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (timeLabel.isNotEmpty)
                      Text(
                        timeLabel,
                        style: TextStyle(
                          fontSize: 9.5,
                          color: isMe ? Colors.white.withValues(alpha: 0.78) : const Color(0xFF575049),
                        ),
                      ),
                    if (decodedHuffman != null) ...[
                      if (timeLabel.isNotEmpty) const SizedBox(width: 8),
                      InkWell(
                        onTap: () => showHuffmanInspectorSheet(
                          context,
                          payload: decodedHuffman,
                          authorAlias: authorAlias,
                        ),
                        borderRadius: BorderRadius.circular(999),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(
                            color: isMe
                                ? Colors.white.withValues(alpha: 0.18)
                                : const Color(0xFFDCFCE7),
                            borderRadius: BorderRadius.circular(999),
                            border: Border.all(
                              color: isMe
                                  ? Colors.white.withValues(alpha: 0.35)
                                  : const Color(0xFF0FB881).withValues(alpha: 0.45),
                            ),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.account_tree_rounded,
                                size: 10,
                                color: isMe ? Colors.white : const Color(0xFF047857),
                              ),
                              const SizedBox(width: 3),
                              Text(
                                'Huffman · ${decodedHuffman.packet.bitLength}b · Tree',
                                style: TextStyle(
                                  fontSize: 9.5,
                                  fontWeight: FontWeight.w700,
                                  color: isMe ? Colors.white : const Color(0xFF047857),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
