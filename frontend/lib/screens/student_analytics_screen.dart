import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import '../config/app_config.dart';
import '../widgets/mobile_container.dart';

class StudentAnalyticsScreen extends StatefulWidget {
  const StudentAnalyticsScreen({super.key});

  @override
  State<StudentAnalyticsScreen> createState() => _StudentAnalyticsScreenState();
}

class _StudentAnalyticsScreenState extends State<StudentAnalyticsScreen> {
  // 0: daily, 1: weekly, 2: monthly
  int _selectedTimeframeIndex = 1;
  bool _isLoading = true;
  String? _error;

  Map<String, dynamic> _stats = {
    'people_talked_to': 0,
    'total_chats': 0,
    'messages_sent': 0,
    'messages_received': 0,
    'total_messages': 0,
    'avg_messages_per_chat': 0.0,
    'total_duration_seconds': 0,
    'usage_minutes': 0.0,
  };

  String? _userAlias;
  int _userStreak = 0;
  String? _userDept;
  String? _userBatch;
  int _totalReferrals = 0;

  @override
  void initState() {
    super.initState();
    _loadUserProfile();
    _fetchAnalytics();
  }

  String get _currentPeriod {
    switch (_selectedTimeframeIndex) {
      case 0:
        return 'daily';
      case 2:
        return 'monthly';
      case 1:
      default:
        return 'weekly';
    }
  }

  String get _periodLabel {
    switch (_selectedTimeframeIndex) {
      case 0:
        return 'Today';
      case 2:
        return 'Past 30 Days';
      case 1:
      default:
        return 'Past 7 Days';
    }
  }

  Future<void> _loadUserProfile() async {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) return;

    try {
      final data = await Supabase.instance.client
          .from('users')
          .select('generated_alias, streak_count, dept_code, batch_year, total_referrals')
          .eq('id', user.id)
          .maybeSingle();

      if (data != null && mounted) {
        setState(() {
          _userAlias = data['generated_alias'];
          _userStreak = data['streak_count'] ?? 0;
          _userDept = data['dept_code'];
          _userBatch = data['batch_year'];
          _totalReferrals = data['total_referrals'] ?? 0;
        });
      }
    } catch (_) {}
  }

  Future<void> _fetchAnalytics({bool silent = false}) async {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) {
      if (mounted) setState(() => _isLoading = false);
      return;
    }

    if (!silent) setState(() => _isLoading = true);

    try {
      // 1. Try Supabase RPC direct call (Zero-cost, secure, instantaneous)
      final res = await Supabase.instance.client.rpc(
        'get_student_analytics',
        params: {
          'p_user_id': user.id,
          'p_timeframe': _currentPeriod,
        },
      );

      if (res != null && mounted) {
        final parsed = res is String ? jsonDecode(res) : Map<String, dynamic>.from(res);
        setState(() {
          _stats = {
            'people_talked_to': parsed['people_talked_to'] ?? 0,
            'total_chats': parsed['total_chats'] ?? 0,
            'messages_sent': parsed['messages_sent'] ?? 0,
            'messages_received': parsed['messages_received'] ?? 0,
            'total_messages': parsed['total_messages'] ?? 0,
            'avg_messages_per_chat': (parsed['avg_messages_per_chat'] as num?)?.toDouble() ?? 0.0,
            'total_duration_seconds': parsed['total_duration_seconds'] ?? 0,
            'usage_minutes': (parsed['usage_minutes'] as num?)?.toDouble() ?? 0.0,
          };
          _isLoading = false;
          _error = null;
        });
        return;
      }
    } catch (_) {
      // 2. Fallback to backend REST endpoint if RPC is unreachable
      try {
        final baseUrl = AppConfig.socketUrl.replaceAll(RegExp(r'/+$'), '');
        final response = await http
            .get(Uri.parse('$baseUrl/api/student/analytics?userId=${user.id}&timeframe=$_currentPeriod'))
            .timeout(const Duration(seconds: 4));

        if (response.statusCode == 200 && mounted) {
          final parsed = jsonDecode(response.body);
          setState(() {
            _stats = {
              'people_talked_to': parsed['people_talked_to'] ?? 0,
              'total_chats': parsed['total_chats'] ?? 0,
              'messages_sent': parsed['messages_sent'] ?? 0,
              'messages_received': parsed['messages_received'] ?? 0,
              'total_messages': parsed['total_messages'] ?? 0,
              'avg_messages_per_chat': (parsed['avg_messages_per_chat'] as num?)?.toDouble() ?? 0.0,
              'total_duration_seconds': parsed['total_duration_seconds'] ?? 0,
              'usage_minutes': (parsed['usage_minutes'] as num?)?.toDouble() ?? 0.0,
            };
            _isLoading = false;
            _error = null;
          });
          return;
        }
      } catch (err) {
        if (mounted) {
          setState(() {
            _isLoading = false;
            _error = 'Unable to fetch recent analytics. Pull down to retry.';
          });
        }
      }
    }

    if (mounted) {
      setState(() => _isLoading = false);
    }
  }

  String _formatDuration(int seconds) {
    if (seconds <= 0) return '0 mins';
    final mins = (seconds / 60).round();
    if (mins < 60) {
      return '$mins mins';
    }
    final hrs = mins ~/ 60;
    final remainingMins = mins % 60;
    if (remainingMins == 0) {
      return '$hrs hrs';
    }
    return '$hrs hr ${remainingMins}m';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF090B10),
      appBar: AppBar(
        backgroundColor: const Color(0xFF090B10),
        elevation: 0,
        scrolledUnderElevation: 0,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(7),
              decoration: BoxDecoration(
                color: const Color(0xFF10B981).withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(Icons.insights_rounded, color: Color(0xFF10B981), size: 18),
            ),
            const SizedBox(width: 10),
            const Text(
              'Adda Stats',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: Colors.white,
                letterSpacing: -0.4,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh Stats',
            icon: const Icon(Icons.refresh_rounded, color: Colors.white70, size: 20),
            onPressed: () => _fetchAnalytics(),
          ),
        ],
      ),
      body: MobileContainer(
        child: RefreshIndicator(
          onRefresh: () => _fetchAnalytics(silent: true),
          color: const Color(0xFF10B981),
          backgroundColor: const Color(0xFF161A26),
          child: ListView(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            children: [
              // User Identity & Streak Banner
              _buildStudentHeader(),
              const SizedBox(height: 18),

              // Timeframe Segmented Control (Daily, Weekly, Monthly)
              _buildTimeframeSelector(),
              const SizedBox(height: 18),

              if (_error != null)
                Container(
                  margin: const EdgeInsets.only(bottom: 14),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF59E0B).withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFF59E0B).withValues(alpha: 0.3)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.info_outline, color: Color(0xFFF59E0B), size: 16),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _error!,
                          style: const TextStyle(color: Color(0xFFF59E0B), fontSize: 11),
                        ),
                      ),
                    ],
                  ),
                ),

              // Engagement KPI Grid
              _buildMetricGrid(),
              const SizedBox(height: 18),

              // Friends Brought / Referral Impact Card
              _buildReferralImpactCard(),
              const SizedBox(height: 18),

              // Sent vs Received Balance Breakdown
              _buildMessageBalanceCard(),
              const SizedBox(height: 18),

              // Adda Highlights & Privacy Notice
              _buildHighlightsCard(),
              const SizedBox(height: 30),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStudentHeader() {
    final alias = _userAlias ?? 'Anonymous Student';
    final dept = _userDept != null ? '${_userDept!}${_userBatch != null ? " '$_userBatch" : ""}' : 'EWU Student';

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            const Color(0xFF10B981).withValues(alpha: 0.16),
            const Color(0xFF0E1A18),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFF10B981).withValues(alpha: 0.25)),
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: const Color(0xFF10B981).withValues(alpha: 0.2),
              shape: BoxShape.circle,
              border: Border.all(color: const Color(0xFF10B981).withValues(alpha: 0.4)),
            ),
            child: const Center(
              child: Icon(Icons.person_outline_rounded, color: Color(0xFF10B981), size: 24),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        alias,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                          color: Colors.white,
                          letterSpacing: -0.3,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                      decoration: BoxDecoration(
                        color: const Color(0xFF10B981).withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        dept,
                        style: const TextStyle(
                          color: Color(0xFF10B981),
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  'Privacy-first adda stats for $_periodLabel',
                  style: TextStyle(
                    fontSize: 11,
                    color: Colors.white.withValues(alpha: 0.6),
                  ),
                ),
              ],
            ),
          ),
          if (_userStreak > 0)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: const Color(0xFFF59E0B).withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFF59E0B).withValues(alpha: 0.3)),
              ),
              child: Row(
                children: [
                  const Text('🔥', style: TextStyle(fontSize: 13)),
                  const SizedBox(width: 4),
                  Text(
                    '$_userStreak',
                    style: const TextStyle(
                      color: Color(0xFFFBBF24),
                      fontWeight: FontWeight.w800,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildTimeframeSelector() {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: const Color(0xFF121622),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
      ),
      child: Row(
        children: [
          _buildTimeframeTab(0, 'Daily (24h)'),
          _buildTimeframeTab(1, 'Weekly (7d)'),
          _buildTimeframeTab(2, 'Monthly (30d)'),
        ],
      ),
    );
  }

  Widget _buildTimeframeTab(int index, String label) {
    final isSelected = _selectedTimeframeIndex == index;
    return Expanded(
      child: GestureDetector(
        onTap: () {
          if (_selectedTimeframeIndex != index) {
            setState(() => _selectedTimeframeIndex = index);
            _fetchAnalytics();
          }
        },
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: isSelected ? const Color(0xFF10B981) : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                color: isSelected ? Colors.white : Colors.white60,
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildMetricGrid() {
    final people = _stats['people_talked_to'] ?? 0;
    final sent = _stats['messages_sent'] ?? 0;
    final received = _stats['messages_received'] ?? 0;
    final avgPerChat = _stats['avg_messages_per_chat'] ?? 0.0;
    final durationSec = _stats['total_duration_seconds'] ?? 0;
    final totalChats = _stats['total_chats'] ?? 0;

    return GridView.count(
      crossAxisCount: 2,
      crossAxisSpacing: 12,
      mainAxisSpacing: 12,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      childAspectRatio: 1.28,
      children: [
        _buildMetricCard(
          title: 'People Talked To',
          value: '$people',
          icon: Icons.people_alt_rounded,
          accentColor: const Color(0xFF10B981), // Emerald
          subtitle: '$totalChats bench sessions',
        ),
        _buildMetricCard(
          title: 'Total Adda Time',
          value: _formatDuration(durationSec),
          icon: Icons.timer_outlined,
          accentColor: const Color(0xFF6366F1), // Indigo
          subtitle: 'Active time on benches',
        ),
        _buildMetricCard(
          title: 'Messages Sent',
          value: '$sent',
          icon: Icons.arrow_upward_rounded,
          accentColor: const Color(0xFF38BDF8), // Sky Blue
          subtitle: 'Your bench thoughts',
        ),
        _buildMetricCard(
          title: 'Messages Received',
          value: '$received',
          icon: Icons.arrow_downward_rounded,
          accentColor: const Color(0xFFEC4899), // Pink
          subtitle: 'From your partners',
        ),
        _buildMetricCard(
          title: 'Avg Messages / Chat',
          value: '$avgPerChat',
          icon: Icons.chat_bubble_outline_rounded,
          accentColor: const Color(0xFFF59E0B), // Amber
          subtitle: 'Conversation depth',
        ),
        _buildMetricCard(
          title: 'Total Messages',
          value: '${sent + received}',
          icon: Icons.forum_rounded,
          accentColor: const Color(0xFF8B5CF6), // Purple
          subtitle: 'Exchanged in $_periodLabel',
        ),
      ],
    );
  }

  Widget _buildMetricCard({
    required String title,
    required String value,
    required IconData icon,
    required Color accentColor,
    required String subtitle,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF121622),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withValues(alpha: 0.05)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                title,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: Colors.white.withValues(alpha: 0.65),
                ),
              ),
              Container(
                padding: const EdgeInsets.all(5),
                decoration: BoxDecoration(
                  color: accentColor.withValues(alpha: 0.15),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, size: 14, color: accentColor),
              ),
            ],
          ),
          _isLoading
              ? const SizedBox(
                  height: 18,
                  width: 18,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF10B981)),
                )
              : Text(
                  value,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                    letterSpacing: -0.4,
                  ),
                ),
          Text(
            subtitle,
            style: TextStyle(
              fontSize: 10,
              color: Colors.white.withValues(alpha: 0.4),
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }

  Widget _buildMessageBalanceCard() {
    final sent = _stats['messages_sent'] ?? 0;
    final received = _stats['messages_received'] ?? 0;
    final total = sent + received;

    double sentPct = total > 0 ? (sent / total) : 0.5;
    double recvPct = total > 0 ? (received / total) : 0.5;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF121622),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Colors.white.withValues(alpha: 0.05)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Conversation Dynamic',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: Colors.white,
                ),
              ),
              Text(
                'Sent vs Received',
                style: TextStyle(
                  fontSize: 11,
                  color: Colors.white38,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: SizedBox(
              height: 10,
              child: Row(
                children: [
                  Expanded(
                    flex: (sentPct * 100).round().clamp(1, 99),
                    child: Container(color: const Color(0xFF38BDF8)),
                  ),
                  Expanded(
                    flex: (recvPct * 100).round().clamp(1, 99),
                    child: Container(color: const Color(0xFFEC4899)),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(width: 8, height: 8, decoration: const BoxDecoration(color: Color(0xFF38BDF8), shape: BoxShape.circle)),
                  const SizedBox(width: 6),
                  Text(
                    'Sent: $sent (${(sentPct * 100).round()}%)',
                    style: const TextStyle(fontSize: 11, color: Colors.white70),
                  ),
                ],
              ),
              Row(
                children: [
                  Container(width: 8, height: 8, decoration: const BoxDecoration(color: Color(0xFFEC4899), shape: BoxShape.circle)),
                  const SizedBox(width: 6),
                  Text(
                    'Received: $received (${(recvPct * 100).round()}%)',
                    style: const TextStyle(fontSize: 11, color: Colors.white70),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildReferralImpactCard() {
    final earnedStones = _totalReferrals * 5;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            const Color(0xFF6366F1).withValues(alpha: 0.14),
            const Color(0xFF10B981).withValues(alpha: 0.10),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFF6366F1).withValues(alpha: 0.28)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: const Color(0xFF6366F1).withValues(alpha: 0.25),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.group_add_rounded, color: Color(0xFF818CF8), size: 18),
                  ),
                  const SizedBox(width: 10),
                  const Text(
                    'Friends Brought to Benchly',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: const Color(0xFF10B981).withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Text(
                  '+5 💎 / Friend',
                  style: TextStyle(color: Color(0xFF10B981), fontSize: 10, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFF121622),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Friends Invited',
                        style: TextStyle(fontSize: 11, color: Colors.white.withValues(alpha: 0.5)),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '$_totalReferrals',
                        style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Colors.white),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFF121622),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Stones Rewarded',
                        style: TextStyle(fontSize: 11, color: Colors.white.withValues(alpha: 0.5)),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '+$earnedStones 💎',
                        style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Color(0xFFF59E0B)),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            'Share your bench short links on Messenger or WhatsApp. Every EWU student you bring to the benches earns you +5 Stones.',
            style: TextStyle(
              fontSize: 11,
              color: Colors.white.withValues(alpha: 0.55),
              height: 1.35,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHighlightsCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF0D111A),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withValues(alpha: 0.05)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.shield_outlined, color: Color(0xFF10B981), size: 16),
              SizedBox(width: 8),
              Text(
                'Zero-PII Privacy Protection',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: Colors.white,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Your conversations are end-to-end anonymized. Nicknames rotate every 15 days, and phone numbers or social links are blocked unless both students complete a mutual handshake.',
            style: TextStyle(
              fontSize: 11,
              color: Colors.white.withValues(alpha: 0.55),
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}
