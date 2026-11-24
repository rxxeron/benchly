import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../rive_lottie_beacons.dart';

class HomeCampusPulseBanner extends StatelessWidget {
  final bool socketConnected;
  final int onlineUsersCount;
  final int streak;

  const HomeCampusPulseBanner({
    super.key,
    required this.socketConnected,
    required this.onlineUsersCount,
    required this.streak,
  });

  @override
  Widget build(BuildContext context) {
    final color = socketConnected ? const Color(0xFF0FB881) : const Color(0xFFF59E0B);
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.22)),
      ),
      child: Row(
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              !socketConnected
                  ? 'Connecting to Benchly campus server...'
                  : (onlineUsersCount > 1
                      ? '$onlineUsersCount EWU students online right now'
                      : 'Quiet hours • Invite a friend or open a Group Lounge'),
              style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w600),
            ),
          ),
          if (streak > 0)
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.local_fire_department_rounded, color: Color(0xFFFB923C), size: 14),
                const SizedBox(width: 3),
                Text(
                  '$streak d',
                  style: const TextStyle(color: Color(0xFFFB923C), fontSize: 11, fontWeight: FontWeight.bold),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class HomeAnonymousProfileCard extends StatelessWidget {
  final String? currentAlias;
  final String? equippedAvatarEmoji;
  final bool isMale;
  final String? userBadge;
  final VoidCallback onEditProfile;

  const HomeAnonymousProfileCard({
    super.key,
    required this.currentAlias,
    required this.equippedAvatarEmoji,
    required this.isMale,
    required this.userBadge,
    required this.onEditProfile,
  });

  @override
  Widget build(BuildContext context) {
    final genderColor = isMale ? const Color(0xFF0284C7) : const Color(0xFFF472B6);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFFFF),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFF1E1B18), width: 1.8),
        boxShadow: const [BoxShadow(color: Color(0xFF1E1B18), offset: Offset(4, 4))],
      ),
      child: Row(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFFFF6B4A), Color(0xFF0FB881)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: const Color(0xFF1E1B18), width: 1.5),
            ),
            child: Center(
              child: equippedAvatarEmoji != null
                  ? Text(equippedAvatarEmoji!, style: const TextStyle(fontSize: 26))
                  : Text(
                      (currentAlias != null && currentAlias!.isNotEmpty)
                          ? currentAlias![0].toUpperCase()
                          : 'B',
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: Colors.white),
                    ),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  currentAlias ?? 'Finding alias...',
                  style: const TextStyle(
                    color: Color(0xFF1E1B18),
                    fontWeight: FontWeight.w800,
                    fontSize: 16,
                    letterSpacing: -0.3,
                  ),
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                      decoration: BoxDecoration(
                        color: genderColor.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        isMale ? '♂ MALE' : '♀ FEMALE',
                        style: TextStyle(color: genderColor, fontSize: 10, fontWeight: FontWeight.w700),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                      decoration: BoxDecoration(
                        color: const Color(0xFF0FB881).withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        userBadge ?? 'EWU Student',
                        style: const TextStyle(color: Color(0xFF0FB881), fontSize: 10, fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Edit nickname, department & semester',
            onPressed: onEditProfile,
            style: IconButton.styleFrom(
              backgroundColor: const Color(0xFFFFF2DF),
              side: const BorderSide(color: Color(0xFF1E1B18), width: 1.5),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            icon: const Icon(Icons.edit_rounded, color: Color(0xFF1E1B18), size: 18),
          ),
        ],
      ),
    );
  }
}

class HomeInviteFriendCard extends StatelessWidget {
  final VoidCallback onTap;

  const HomeInviteFriendCard({super.key, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFFEF3C7),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFF1E1B18), width: 1.8),
        boxShadow: const [BoxShadow(color: Color(0xFF1E1B18), offset: Offset(3, 3))],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFF6366F1).withValues(alpha: 0.25),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.share_rounded, color: Color(0xFF818CF8), size: 20),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Text(
                            'Invite a Friend to Bench',
                            style: TextStyle(color: Color(0xFF1E1B18), fontWeight: FontWeight.w700, fontSize: 14),
                          ),
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF59E0B).withValues(alpha: 0.2),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: const Text(
                              '+5 💎',
                              style: TextStyle(color: Color(0xFFF59E0B), fontWeight: FontWeight.w800, fontSize: 10),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(
                        'Share a short link to WhatsApp/Messenger. Connect instantly on a private bench!',
                        style: TextStyle(color: const Color(0xFF1E1B18).withValues(alpha: 0.70), fontSize: 11),
                      ),
                    ],
                  ),
                ),
                Icon(Icons.arrow_forward_ios_rounded, size: 14, color: const Color(0xFF1E1B18).withValues(alpha: 0.50)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class HomeTodaysTopicCard extends StatelessWidget {
  final String topic;

  const HomeTodaysTopicCard({super.key, required this.topic});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFFFF),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFF1E1B18), width: 1.8),
        boxShadow: const [BoxShadow(color: Color(0xFF1E1B18), offset: Offset(3, 3))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text('☕', style: TextStyle(fontSize: 16)),
              const SizedBox(width: 8),
              Text(
                'TODAY\'S BENCH TOPIC',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.0,
                  color: const Color(0xFF1E1B18).withValues(alpha: 0.60),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '"$topic"',
            style: const TextStyle(
              fontSize: 13,
              color: Color(0xFF1E1B18),
              fontStyle: FontStyle.italic,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}

class HomeCampaignCard extends StatelessWidget {
  final Map<String, dynamic> campaign;
  final ValueChanged<String> onClaim;

  const HomeCampaignCard({
    super.key,
    required this.campaign,
    required this.onClaim,
  });

  @override
  Widget build(BuildContext context) {
    final progress = (campaign['current_progress'] as num?)?.toInt() ?? 0;
    final target = (campaign['target_value'] as num?)?.toInt() ?? 1;
    final reward = (campaign['reward_stones'] as num?)?.toInt() ?? 5;
    final claimed = campaign['claimed'] == true;
    final canClaim = campaign['can_claim'] == true;
    final ratio = (progress / target).clamp(0.0, 1.0);

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFFFF),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: canClaim
              ? const Color(0xFF0FB881).withValues(alpha: 0.5)
              : const Color(0xFF1E1B18).withValues(alpha: 0.15),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(campaign['icon_emoji']?.toString() ?? '⭐', style: const TextStyle(fontSize: 16)),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  campaign['title']?.toString() ?? 'Campus Campaign',
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF1E1B18)),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: const Color(0xFF0FB881).withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '+$reward 💎',
                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Color(0xFF0FB881)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            campaign['description']?.toString() ?? '',
            style: TextStyle(fontSize: 12, color: const Color(0xFF1E1B18).withValues(alpha: 0.75)),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(999),
                  child: LinearProgressIndicator(
                    value: ratio,
                    minHeight: 6,
                    backgroundColor: const Color(0xFF1E1B18).withValues(alpha: 0.15),
                    valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF0FB881)),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Text(
                '$progress/$target',
                style: TextStyle(fontSize: 11, color: const Color(0xFF1E1B18).withValues(alpha: 0.80)),
              ),
              if (canClaim) ...[
                const SizedBox(width: 10),
                ElevatedButton(
                  onPressed: () => onClaim(campaign['id'].toString()),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0FB881),
                    foregroundColor: const Color(0xFF03130D),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: const Text('Claim', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700)),
                ),
              ] else if (claimed) ...[
                const SizedBox(width: 10),
                const Text('Claimed ✓', style: TextStyle(fontSize: 11, color: Color(0xFF0FB881), fontWeight: FontWeight.w700)),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class HomeSearchingRadarCard extends StatelessWidget {
  final ValueListenable<int> countdownListenable;
  final String matchMode;
  final VoidCallback onCancel;

  const HomeSearchingRadarCard({
    super.key,
    required this.countdownListenable,
    required this.matchMode,
    required this.onCancel,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 22, horizontal: 20),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFFFF),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFF0FB881).withValues(alpha: 0.3)),
      ),
      child: ValueListenableBuilder<int>(
        valueListenable: countdownListenable,
        builder: (_, countdown, _) => Column(
          children: [
            RiveLottieRadarBeacon(
              state: RadarMachineState.scanning1v1,
              countdownSeconds: countdown,
              activeTopic: matchMode,
            ),
            const SizedBox(height: 12),
            const Text(
              'Scanning the EWU benches...',
              style: TextStyle(
                color: Color(0xFF1E1B18),
                fontSize: 15,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              countdown > 15
                  ? 'Everyone searching right now is matched together every ~1.5s, so more people get a seat.'
                  : 'Checking across all EWU departments...',
              style: TextStyle(
                color: const Color(0xFF1E1B18).withValues(alpha: 0.60),
                fontSize: 12,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 14),
            TextButton(
              onPressed: onCancel,
              style: TextButton.styleFrom(minimumSize: const Size(48, 44)),
              child: const Text(
                'Cancel Search',
                style: TextStyle(color: Color(0xFFB91C1C), fontSize: 14, fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
