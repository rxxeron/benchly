import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

class ChatRoomAppBar extends StatelessWidget implements PreferredSizeWidget {
  final String partnerAlias;
  final String partnerBadge;
  final String? partnerAvatarEmoji;
  final bool isGroupLounge;
  final bool partnerReconnecting;
  final bool partnerTyping;
  final bool handshakeCompleted;
  final bool handshakeSent;
  final bool extensionVoted;
  final ValueListenable<int> timeLeftListenable;
  final VoidCallback onBack;
  final VoidCallback onOpenPartnerCard;
  final VoidCallback onOpenGuessModal;
  final VoidCallback onRequestHandshake;
  final VoidCallback onRequestExtension;
  final VoidCallback onReportStudent;

  const ChatRoomAppBar({
    super.key,
    required this.partnerAlias,
    required this.partnerBadge,
    required this.partnerAvatarEmoji,
    required this.isGroupLounge,
    required this.partnerReconnecting,
    required this.partnerTyping,
    required this.handshakeCompleted,
    required this.handshakeSent,
    required this.extensionVoted,
    required this.timeLeftListenable,
    required this.onBack,
    required this.onOpenPartnerCard,
    required this.onOpenGuessModal,
    required this.onRequestHandshake,
    required this.onRequestExtension,
    required this.onReportStudent,
  });

  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      backgroundColor: const Color(0xFFFFF9F0),
      elevation: 0,
      scrolledUnderElevation: 0,
      leading: IconButton(
        icon: const Icon(Icons.arrow_back_ios_rounded, size: 18),
        onPressed: onBack,
      ),
      titleSpacing: 0,
      title: GestureDetector(
        onTap: isGroupLounge ? null : onOpenPartnerCard,
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFFFF6B4A), Color(0xFF0FB881)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: const Color(0xFF1E1B18), width: 1.4),
              ),
              child: Center(
                child: (partnerAvatarEmoji != null && !isGroupLounge)
                    ? Text(partnerAvatarEmoji!, style: const TextStyle(fontSize: 18))
                    : Icon(
                        isGroupLounge ? Icons.groups_rounded : Icons.person_rounded,
                        size: 20,
                        color: const Color(0xFF1E1B18),
                      ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          partnerAlias,
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFF1E1B18),
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0xFF0FB881).withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: const Color(0xFF0FB881).withValues(alpha: 0.3)),
                        ),
                        child: Text(
                          partnerBadge,
                          style: const TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFF0FB881),
                          ),
                        ),
                      ),
                    ],
                  ),
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 200),
                    child: Text(
                      partnerReconnecting
                          ? 'Reconnecting...'
                          : (partnerTyping
                              ? 'typing...'
                              : (isGroupLounge ? 'Cafeteria Group Lounge' : 'Huffman Wire • Anonymous')),
                      key: ValueKey('$partnerReconnecting-$partnerTyping'),
                      style: TextStyle(
                        fontSize: 11,
                        color: partnerReconnecting
                            ? const Color(0xFFF59E0B)
                            : (partnerTyping
                                ? const Color(0xFF0FB881)
                                : const Color(0xFF1E1B18).withValues(alpha: 0.50)),
                        fontWeight: (partnerTyping || partnerReconnecting) ? FontWeight.w600 : FontWeight.w400,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      actions: [
        if (!isGroupLounge) ...[
          IconButton(
            tooltip: 'Guess partner\'s vibe',
            icon: const Icon(Icons.psychology_alt_rounded, size: 20, color: Color(0xFF818CF8)),
            onPressed: onOpenGuessModal,
          ),
          IconButton(
            tooltip: 'Request Handshake',
            icon: Icon(
              Icons.handshake_rounded,
              size: 20,
              color: handshakeCompleted
                  ? const Color(0xFF0FB881)
                  : (handshakeSent ? const Color(0xFFF59E0B) : const Color(0xFF44403C)),
            ),
            onPressed: handshakeCompleted ? null : onRequestHandshake,
          ),
          ValueListenableBuilder<int>(
            valueListenable: timeLeftListenable,
            builder: (_, timeLeft, _) {
              final minutes = timeLeft ~/ 60;
              final seconds = (timeLeft % 60).toString().padLeft(2, '0');
              final isUrgent = timeLeft < 120;
              final isCritical = timeLeft < 30;
              return Container(
                margin: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: isCritical
                      ? const Color(0xFFEF4444).withValues(alpha: 0.25)
                      : (isUrgent ? const Color(0xFFF59E0B).withValues(alpha: 0.2) : const Color(0xFFFFFFFF)),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: isCritical
                        ? const Color(0xFFEF4444)
                        : (isUrgent ? const Color(0xFFF59E0B) : const Color(0xFF1E1B18).withValues(alpha: 0.15)),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.timer_outlined,
                      size: 13,
                      color: isUrgent ? const Color(0xFFEF4444) : const Color(0xFF44403C),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      '$minutes:$seconds',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        fontFeatures: const [FontFeature.tabularFigures()],
                        color: isUrgent ? const Color(0xFFEF4444) : const Color(0xFF1E1B18),
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ],
        PopupMenuButton<String>(
          icon: Icon(Icons.more_vert_rounded, color: const Color(0xFF1E1B18).withValues(alpha: 0.80), size: 20),
          color: const Color(0xFFFFFFFF),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          onSelected: (value) {
            if (value == 'extend') onRequestExtension();
            if (value == 'report') onReportStudent();
            if (value == 'end') onBack();
          },
          itemBuilder: (_) => [
            if (!isGroupLounge)
              PopupMenuItem(
                value: 'extend',
                child: Row(
                  children: [
                    Icon(
                      Icons.more_time_rounded,
                      size: 18,
                      color: extensionVoted ? const Color(0xFF0FB881) : const Color(0xFF44403C),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      extensionVoted ? 'Extension Voted' : 'Extend (+15m)',
                      style: const TextStyle(color: Color(0xFF1E1B18), fontSize: 13),
                    ),
                  ],
                ),
              ),
            const PopupMenuItem(
              value: 'report',
              child: Row(
                children: [
                  Icon(Icons.flag_outlined, size: 18, color: Color(0xFF44403C)),
                  SizedBox(width: 10),
                  Text('Report Student', style: TextStyle(color: Color(0xFF1E1B18), fontSize: 13)),
                ],
              ),
            ),
            const PopupMenuItem(
              value: 'end',
              child: Row(
                children: [
                  Icon(Icons.exit_to_app_rounded, size: 18, color: Color(0xFFEF4444)),
                  SizedBox(width: 10),
                  Text('Leave Bench', style: TextStyle(color: Color(0xFFEF4444), fontSize: 13)),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class ChatUrgentExtendBanner extends StatelessWidget {
  final ValueListenable<int> timeLeftListenable;
  final bool extensionVoted;
  final VoidCallback onExtend;

  const ChatUrgentExtendBanner({
    super.key,
    required this.timeLeftListenable,
    required this.extensionVoted,
    required this.onExtend,
  });

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<int>(
      valueListenable: timeLeftListenable,
      builder: (_, timeLeft, _) {
        if (timeLeft >= 120) return const SizedBox.shrink();
        final minutes = timeLeft ~/ 60;
        final seconds = (timeLeft % 60).toString().padLeft(2, '0');
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            color: const Color(0xFFF59E0B).withValues(alpha: 0.14),
            border: Border(bottom: BorderSide(color: const Color(0xFFF59E0B).withValues(alpha: 0.3))),
          ),
          child: Row(
            children: [
              const Icon(Icons.hourglass_bottom_rounded, size: 15, color: Color(0xFFD97706)),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  extensionVoted
                      ? 'Waiting for partner to agree to +15m...'
                      : 'Ending soon ($minutes:$seconds left). Want to keep talking?',
                  style: const TextStyle(color: Color(0xFF92400E), fontSize: 11.5, fontWeight: FontWeight.w700),
                ),
              ),
              if (!extensionVoted)
                InkWell(
                  onTap: onExtend,
                  borderRadius: BorderRadius.circular(8),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: const Color(0xFF0FB881),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Text(
                      'Extend +15m',
                      style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w800),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class ChatPrivacyBanner extends StatelessWidget {
  const ChatPrivacyBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFFEF3C7),
        border: Border(bottom: BorderSide(color: const Color(0xFF1E1B18).withValues(alpha: 0.15))),
      ),
      child: Row(
        children: [
          const Icon(Icons.shield_outlined, size: 13, color: Color(0xFFF59E0B)),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Stay safe: Never share phone numbers, student IDs, socials, or personal details.',
              style: TextStyle(
                fontSize: 10.5,
                color: const Color(0xFF1E1B18).withValues(alpha: 0.82),
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class ChatIcebreakerCard extends StatelessWidget {
  final String icebreaker;
  final VoidCallback onAsk;
  final VoidCallback onDismiss;

  const ChatIcebreakerCard({
    super.key,
    required this.icebreaker,
    required this.onAsk,
    required this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFF0FB881).withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFF0FB881).withValues(alpha: 0.25)),
      ),
      child: Row(
        children: [
          const Text('💡', style: TextStyle(fontSize: 16)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'CAMPUS ADDA SPARK',
                  style: TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1.0,
                    color: const Color(0xFF0FB881).withValues(alpha: 0.9),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  icebreaker,
                  style: const TextStyle(fontSize: 12.5, color: Color(0xFF1E1B18), fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          InkWell(
            onTap: onAsk,
            borderRadius: BorderRadius.circular(8),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(color: const Color(0xFF0FB881), borderRadius: BorderRadius.circular(8)),
              child: const Text('Ask', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
            ),
          ),
          const SizedBox(width: 4),
          IconButton(
            icon: const Icon(Icons.close, size: 16, color: Color(0xFF575049)),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
            onPressed: onDismiss,
          ),
        ],
      ),
    );
  }
}

class ChatPartnerLeftFooter extends StatelessWidget {
  final String? partnerLeftAlias;
  final VoidCallback onFindNewBench;

  const ChatPartnerLeftFooter({
    super.key,
    required this.partnerLeftAlias,
    required this.onFindNewBench,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF9F0),
        border: Border(top: BorderSide(color: const Color(0xFF1E1B18).withValues(alpha: 0.15))),
      ),
      child: SafeArea(
        child: ElevatedButton.icon(
          onPressed: onFindNewBench,
          icon: const Icon(Icons.arrow_back_rounded, size: 18),
          label: Text(
            '${partnerLeftAlias ?? "Partner"} Left • Find New Bench',
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
          ),
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF0FB881),
            foregroundColor: Colors.white,
            elevation: 0,
            minimumSize: const Size(double.infinity, 48),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
        ),
      ),
    );
  }
}

class ChatMessageInputBar extends StatelessWidget {
  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onSend;

  const ChatMessageInputBar({
    super.key,
    required this.controller,
    required this.onChanged,
    required this.onSend,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF9F0),
        border: Border(top: BorderSide(color: const Color(0xFF1E1B18).withValues(alpha: 0.15))),
      ),
      child: SafeArea(
        child: Row(
          children: [
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  color: const Color(0xFFFFFFFF),
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: const Color(0xFF1E1B18).withValues(alpha: 0.15)),
                ),
                child: TextField(
                  controller: controller,
                  onChanged: onChanged,
                  onSubmitted: (_) => onSend(),
                  style: const TextStyle(color: Color(0xFF1E1B18), fontSize: 14),
                  decoration: InputDecoration(
                    hintText: 'Type message (Huffman encoded)...',
                    hintStyle: TextStyle(color: const Color(0xFF1E1B18).withValues(alpha: 0.28), fontSize: 14),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    border: InputBorder.none,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            InkWell(
              onTap: onSend,
              borderRadius: BorderRadius.circular(24),
              child: Container(
                width: 44,
                height: 44,
                decoration: const BoxDecoration(color: Color(0xFF0FB881), shape: BoxShape.circle),
                child: const Icon(Icons.send_rounded, color: Colors.white, size: 20),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
