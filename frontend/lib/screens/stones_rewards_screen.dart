import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import '../algorithms/benchly_algorithms.dart';
import '../config/app_config.dart';
import '../widgets/staggered_reveal.dart';

class StonesRewardsScreen extends StatefulWidget {
  const StonesRewardsScreen({super.key});

  @override
  State<StonesRewardsScreen> createState() => _StonesRewardsScreenState();
}

class _StonesRewardsScreenState extends State<StonesRewardsScreen> {
  bool _isLoading = true;
  bool _isClaimingDaily = false;
  int _liveStonesBalance = 0;
  int _streakCount = 0;
  int _totalReferrals = 0;

  List<StonePerkItem> _catalogPerks = [];
  Set<String> _unlockedPerkIds = {};
  Set<String> _equippedPerkIds = {};
  final Map<String, int> _freeSpotsLeftByPerk = {};
  final Map<String, int> _freeLimitByPerk = {};

  @override
  void initState() {
    super.initState();
    _loadLiveStonesData();
  }

  Future<void> _loadLiveStonesData() async {
    setState(() => _isLoading = true);
    final user = Supabase.instance.client.auth.currentUser;

    if (user != null) {
      try {
        final profile = await Supabase.instance.client
            .from('users')
            .select('stones_balance, streak_count, total_referrals')
            .eq('id', user.id)
            .maybeSingle();

        if (profile != null && mounted) {
          _liveStonesBalance = (profile['stones_balance'] as num?)?.toInt() ?? 10;
          _streakCount = (profile['streak_count'] as num?)?.toInt() ?? 0;
          _totalReferrals = (profile['total_referrals'] as num?)?.toInt() ?? 0;
        }
      } catch (_) {}

      try {
        final rows = await Supabase.instance.client
            .from('user_perks')
            .select('perk_id, is_equipped')
            .eq('user_id', user.id);

        final unlocked = <String>{};
        final equipped = <String>{};
        for (final r in rows) {
          final pid = r['perk_id']?.toString() ?? '';
          if (pid.isNotEmpty) {
            unlocked.add(pid);
            if (r['is_equipped'] == true) equipped.add(pid);
          }
        }
        _unlockedPerkIds = unlocked;
        _equippedPerkIds = equipped;
      } catch (_) {}
    }

    var loadedPerks = <StonePerkItem>[];
    try {
      final rows = await Supabase.instance.client
          .from('stone_perks')
          .select('id, name, category, stone_cost, engagement_boost, icon_emoji, free_claim_limit, claimed_count')
          .eq('is_active', true)
          .order('free_claim_limit', ascending: false)
          .order('stone_cost', ascending: true);

      _freeSpotsLeftByPerk.clear();
      _freeLimitByPerk.clear();
      loadedPerks = rows.map((r) {
        final pid = r['id'].toString();
        final limit = (r['free_claim_limit'] as num?)?.toInt() ?? 0;
        final claimed = (r['claimed_count'] as num?)?.toInt() ?? 0;
        if (limit > 0) {
          _freeLimitByPerk[pid] = limit;
          _freeSpotsLeftByPerk[pid] = (limit - claimed).clamp(0, limit);
        }
        return StonePerkItem(
          id: pid,
          name: r['name'].toString(),
          category: r['category'].toString(),
          stoneCost: (r['stone_cost'] as num).toInt(),
          engagementBoost: (r['engagement_boost'] as num).toInt(),
          iconEmoji: r['icon_emoji']?.toString() ?? '💎',
        );
      }).toList();
    } catch (_) {
      try {
        final baseUrl = AppConfig.socketUrl.replaceAll(RegExp(r'/+$'), '');
        final resp = await http
            .get(Uri.parse('$baseUrl/api/stones/optimize?stones=$_liveStonesBalance'))
            .timeout(const Duration(seconds: 4));
        if (resp.statusCode == 200) {
          final body = jsonDecode(resp.body);
          final list = (body['perks'] as List?) ?? [];
          loadedPerks = list
              .map((r) => StonePerkItem(
                    id: r['id'].toString(),
                    name: r['name'].toString(),
                    category: r['category'].toString(),
                    stoneCost: (r['stone_cost'] as num).toInt(),
                    engagementBoost: (r['engagement_boost'] as num).toInt(),
                    iconEmoji: r['icon_emoji']?.toString() ?? '💎',
                  ))
              .toList();
        }
      } catch (_) {}
    }

    if (loadedPerks.isEmpty) {
      loadedPerks = const [
        StonePerkItem(
          id: 'perk_dept_hint',
          name: 'Mid-Chat Dept Reveal Hint',
          category: 'In-Chat Boost',
          stoneCost: 2,
          engagementBoost: 18,
          iconEmoji: '🕵️',
        ),
        StonePerkItem(
          id: 'perk_priority_queue',
          name: 'Rush-Hour Priority Queue Pass',
          category: 'Matchmaking',
          stoneCost: 3,
          engagementBoost: 29,
          iconEmoji: '⚡',
        ),
        StonePerkItem(
          id: 'avatar_campus_cat',
          name: 'Campus Cat Collectible Badge',
          category: 'Avatar Shop',
          stoneCost: 4,
          engagementBoost: 36,
          iconEmoji: '🐱',
        ),
        StonePerkItem(
          id: 'perk_custom_alias',
          name: 'Custom Anonymous Pseudonym Pass',
          category: 'Identity',
          stoneCost: 5,
          engagementBoost: 48,
          iconEmoji: '🎭',
        ),
        StonePerkItem(
          id: 'avatar_tea_philosopher',
          name: 'Tea Stall Philosopher Flair',
          category: 'Avatar Shop',
          stoneCost: 6,
          engagementBoost: 62,
          iconEmoji: '☕',
        ),
        StonePerkItem(
          id: 'perk_super_extend',
          name: '+15m Instant Super-Extend Token',
          category: 'In-Chat Boost',
          stoneCost: 7,
          engagementBoost: 74,
          iconEmoji: '⏳',
        ),
        StonePerkItem(
          id: 'avatar_night_owl',
          name: 'Midnight Adda Night-Owl Aura',
          category: 'Avatar Shop',
          stoneCost: 9,
          engagementBoost: 96,
          iconEmoji: '🦉',
        ),
      ];
    }

    if (mounted) {
      setState(() {
        _catalogPerks = loadedPerks;
        _isLoading = false;
      });
    }
  }

  Future<void> _claimDailyStones() async {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null || _isClaimingDaily) return;

    setState(() => _isClaimingDaily = true);
    try {
      final res = await Supabase.instance.client.rpc(
        'claim_daily_login_stones',
        params: {'p_user_id': user.id},
      );
      final parsed = res is String ? jsonDecode(res) : Map<String, dynamic>.from(res);
      if (mounted) {
        setState(() {
          _liveStonesBalance = (parsed['stones_balance'] as num?)?.toInt() ?? _liveStonesBalance;
          _streakCount = (parsed['streak_count'] as num?)?.toInt() ?? _streakCount;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              parsed['success'] == true
                  ? '🎉 Claimed +2 Daily Stones! Balance: $_liveStonesBalance 💎'
                  : (parsed['message']?.toString() ?? 'Already claimed today!'),
            ),
            backgroundColor: parsed['success'] == true
                ? const Color(0xFF0FB881)
                : const Color(0xFFF59E0B),
          ),
        );
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not claim daily stones right now. Please try again later.'),
            backgroundColor: Color(0xFFEF4444),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isClaimingDaily = false);
    }
  }

  Future<void> _unlockOrTogglePerk(StonePerkItem perk) async {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) return;

    final isOwned = _unlockedPerkIds.contains(perk.id);
    final isFreeNow = (_freeSpotsLeftByPerk[perk.id] ?? 0) > 0;
    if (!isOwned && !isFreeNow && _liveStonesBalance < perk.stoneCost) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Need ${perk.stoneCost} 💎 to unlock ${perk.name} (You have $_liveStonesBalance 💎).',
          ),
          backgroundColor: const Color(0xFFEF4444),
        ),
      );
      return;
    }

    try {
      final res = await Supabase.instance.client.rpc(
        'purchase_stone_perk',
        params: {'p_user_id': user.id, 'p_perk_id': perk.id},
      );
      final parsed = res is String ? jsonDecode(res) : Map<String, dynamic>.from(res);
      if (parsed['success'] == true && mounted) {
        final claimedFree = parsed['free_early_bird'] == true;
        setState(() {
          _liveStonesBalance = (parsed['stones_balance'] as num?)?.toInt() ?? _liveStonesBalance;
          if (parsed['free_spots_left'] != null) {
            _freeSpotsLeftByPerk[perk.id] = (parsed['free_spots_left'] as num).toInt();
          }
          _unlockedPerkIds.add(perk.id);
          if (_equippedPerkIds.contains(perk.id)) {
            _equippedPerkIds.remove(perk.id);
          } else {
            _equippedPerkIds.add(perk.id);
          }
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              isOwned
                  ? 'Updated ${perk.name}!'
                  : (claimedFree
                      ? '🎉 Claimed FREE Early-Bird Avatar: ${perk.name}!'
                      : '✨ Unlocked ${perk.name} for ${perk.stoneCost} 💎!'),
            ),
            backgroundColor: const Color(0xFF0FB881),
          ),
        );
        return;
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not update perk right now. Please try again later.'),
            backgroundColor: Color(0xFFEF4444),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // Runs 0/1 Knapsack DP silently in the background to recommend the best perk bundle for the student's real balance
    final lockedPerks = _catalogPerks.where((p) => !_unlockedPerkIds.contains(p.id)).toList();
    final bestBundle = lockedPerks.isNotEmpty && _liveStonesBalance > 0
        ? KnapsackStonesEngine.solvePerkLoadout(
            items: lockedPerks,
            walletCapacity: _liveStonesBalance,
          )
        : null;

    return Scaffold(
      backgroundColor: const Color(0xFFFFF9F0),
      appBar: AppBar(
        backgroundColor: const Color(0xFFFFF9F0),
        elevation: 0,
        scrolledUnderElevation: 0,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(7),
              decoration: BoxDecoration(
                color: const Color(0xFFF59E0B).withValues(alpha: 0.16),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(Icons.diamond_rounded, color: Color(0xFFF59E0B), size: 18),
            ),
            const SizedBox(width: 10),
            const Text(
              'Campus Stones',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: const Color(0xFF1E1B18),
                letterSpacing: -0.3,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh Wallet',
            icon: const Icon(Icons.refresh_rounded, color: const Color(0xFF44403C), size: 20),
            onPressed: _loadLiveStonesData,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF0FB881)))
          : RefreshIndicator(
              onRefresh: _loadLiveStonesData,
              color: const Color(0xFF0FB881),
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                children: [
                  // 1. Clean Wallet Hero Card
                  StaggeredReveal(
                    index: 0,
                    child: Container(
                      padding: const EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [
                            const Color(0xFFF59E0B).withValues(alpha: 0.18),
                            const Color(0xFFFFFFFF),
                          ],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: const Color(0xFFF59E0B).withValues(alpha: 0.35)),
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 52,
                            height: 52,
                            decoration: BoxDecoration(
                              color: const Color(0xFFF59E0B).withValues(alpha: 0.2),
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: const Icon(Icons.diamond_rounded, color: Color(0xFFF59E0B), size: 28),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '$_liveStonesBalance Stones',
                                  style: const TextStyle(
                                    color: const Color(0xFF1E1B18),
                                    fontWeight: FontWeight.w900,
                                    fontSize: 22,
                                    letterSpacing: -0.5,
                                  ),
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  '🔥 $_streakCount day streak • 🤝 $_totalReferrals invites',
                                  style: TextStyle(
                                    color: Color(0xFF1E1B18).withValues(alpha: 0.75),
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          SpringTap(
                            onTap: _claimDailyStones,
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                              decoration: BoxDecoration(
                                color: const Color(0xFF0FB881),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(
                                _isClaimingDaily ? '...' : 'Daily +2 💎',
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w800,
                                  fontSize: 12,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // 2. Smart Recommended Bundle (Powered silently by 0/1 Knapsack DP)
                  if (bestBundle != null && bestBundle.dpSelectedItems.isNotEmpty) ...[
                    StaggeredReveal(
                      index: 1,
                      child: Container(
                        padding: const EdgeInsets.all(15),
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [
                              const Color(0xFF0FB881).withValues(alpha: 0.14),
                              const Color(0xFF6366F1).withValues(alpha: 0.10),
                            ],
                          ),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0xFF0FB881).withValues(alpha: 0.3)),
                        ),
                        child: Row(
                          children: [
                            const Text('✨', style: TextStyle(fontSize: 22)),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text(
                                    'Smart Pick for Your Balance',
                                    style: TextStyle(
                                      color: Color(0xFF34D399),
                                      fontSize: 12,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    'Best value with $_liveStonesBalance 💎: ${bestBundle.dpSelectedItems.map((e) => e.name).join(" + ")} (+${bestBundle.dpOptimalValue} Aura)',
                                    style: TextStyle(
                                      color: Color(0xFF1E1B18).withValues(alpha: 0.85),
                                      fontSize: 12,
                                      height: 1.35,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                  ],

                  // 3. Ways to Earn Stones
                  StaggeredReveal(
                    index: 2,
                    child: Text(
                      'WAYS TO EARN STONES',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.1,
                        color: Color(0xFF1E1B18).withValues(alpha: 0.55),
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  StaggeredReveal(
                    index: 3,
                    child: Row(
                      children: [
                        Expanded(child: _earnChip('Daily Login', '+2 💎', const Color(0xFF0FB881))),
                        const SizedBox(width: 8),
                        Expanded(child: _earnChip('Invite Friend', '+5 💎', const Color(0xFF6366F1))),
                        const SizedBox(width: 8),
                        Expanded(child: _earnChip('7-Day Streak', '+10 💎', const Color(0xFFF59E0B))),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),

                  // 4. Perks & Collectibles Shop
                  StaggeredReveal(
                    index: 4,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'PERKS & BADGE SHOP',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 1.1,
                            color: Color(0xFF1E1B18).withValues(alpha: 0.55),
                          ),
                        ),
                        Text(
                          '${_unlockedPerkIds.length}/${_catalogPerks.length} Owned',
                          style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFF0FB881),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),

                  ...List.generate(_catalogPerks.length, (i) {
                    final perk = _catalogPerks[i];
                    final isOwned = _unlockedPerkIds.contains(perk.id);
                    final isEquipped = _equippedPerkIds.contains(perk.id);
                    final freeLeft = _freeSpotsLeftByPerk[perk.id] ?? 0;
                    final freeLimit = _freeLimitByPerk[perk.id] ?? 0;
                    final isFreeEarlyBird = !isOwned && freeLeft > 0;
                    final canAfford = isFreeEarlyBird || _liveStonesBalance >= perk.stoneCost;

                    return StaggeredReveal(
                      index: 5 + i,
                      child: Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: SpringTap(
                          onTap: () => _unlockOrTogglePerk(perk),
                          child: Container(
                            padding: const EdgeInsets.all(14),
                            decoration: BoxDecoration(
                              color: isEquipped
                                  ? const Color(0xFF6366F1).withValues(alpha: 0.14)
                                  : const Color(0xFFFFFFFF),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: isEquipped
                                    ? const Color(0xFF6366F1)
                                    : Color(0xFF1E1B18).withValues(alpha: 0.15),
                              ),
                            ),
                            child: Row(
                              children: [
                                Container(
                                  width: 46,
                                  height: 46,
                                  decoration: BoxDecoration(
                                    color: Color(0xFF1E1B18).withValues(alpha: 0.15),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Center(
                                    child: Text(perk.iconEmoji, style: const TextStyle(fontSize: 22)),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        perk.name,
                                        style: const TextStyle(
                                          color: const Color(0xFF1E1B18),
                                          fontWeight: FontWeight.w700,
                                          fontSize: 13.5,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Row(
                                        children: [
                                          if (isFreeEarlyBird) ...[
                                            Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                              decoration: BoxDecoration(
                                                color: const Color(0xFF0FB881).withValues(alpha: 0.16),
                                                borderRadius: BorderRadius.circular(6),
                                              ),
                                              child: Text(
                                                'FREE • $freeLeft/$freeLimit left',
                                                style: const TextStyle(
                                                  color: Color(0xFF047857),
                                                  fontSize: 10.5,
                                                  fontWeight: FontWeight.w800,
                                                ),
                                              ),
                                            ),
                                            const SizedBox(width: 6),
                                            Text(
                                              '${perk.stoneCost} 💎',
                                              style: TextStyle(
                                                color: Color(0xFF1E1B18).withValues(alpha: 0.40),
                                                fontSize: 10.5,
                                                decoration: TextDecoration.lineThrough,
                                              ),
                                            ),
                                          ] else
                                            Text(
                                              '${perk.stoneCost} 💎',
                                              style: const TextStyle(
                                                color: Color(0xFFD97706),
                                                fontSize: 11.5,
                                                fontWeight: FontWeight.w800,
                                              ),
                                            ),
                                          const SizedBox(width: 8),
                                          Flexible(
                                            child: Text(
                                              perk.category,
                                              overflow: TextOverflow.ellipsis,
                                              style: TextStyle(
                                                color: Color(0xFF1E1B18).withValues(alpha: 0.55),
                                                fontSize: 11,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                                  decoration: BoxDecoration(
                                    color: isOwned
                                        ? (isEquipped ? const Color(0xFF6366F1) : const Color(0xFFFFF2DF))
                                        : (isFreeEarlyBird
                                            ? const Color(0xFFFF6B4A)
                                            : (canAfford ? const Color(0xFF0FB881) : const Color(0xFFFFF2DF))),
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: Text(
                                    isOwned
                                        ? (isEquipped ? 'Equipped' : 'Equip')
                                        : (isFreeEarlyBird ? 'Claim Free' : 'Unlock'),
                                    style: TextStyle(
                                      color: (isOwned && !isEquipped) || (!isOwned && !canAfford)
                                          ? const Color(0xFF575049)
                                          : Colors.white,
                                      fontSize: 11.5,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    );
                  }),
                  const SizedBox(height: 24),
                ],
              ),
            ),
    );
  }

  Widget _earnChip(String label, String reward, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.28)),
      ),
      child: Column(
        children: [
          Text(
            reward,
            style: TextStyle(color: color, fontWeight: FontWeight.w900, fontSize: 14),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.80), fontSize: 10.5),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
