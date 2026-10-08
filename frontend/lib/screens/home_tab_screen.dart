import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../config/app_config.dart';
import 'chat_room_screen.dart';
import 'admin_analytics_screen.dart';

class HomeTabScreen extends StatefulWidget {
  const HomeTabScreen({super.key});
  @override
  State<HomeTabScreen> createState() => _HomeTabScreenState();
}

class _HomeTabScreenState extends State<HomeTabScreen> with SingleTickerProviderStateMixin {
  late io.Socket socket;
  bool isSearching = false;
  String? currentAlias;
  String? userGender;
  String? userBadge;
  int _stones = 10;
  int _streak = 0;
  String _matchPref = 'anyone'; // 'male', 'female', 'anyone'
  late AnimationController _radarController;

  @override
  void initState() {
    super.initState();
    _radarController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat();
    _fetchProfile();
    _connectSocket();
  }

  @override
  void dispose() {
    _radarController.dispose();
    socket.dispose();
    super.dispose();
  }

  void _fetchProfile() async {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) return;

    try {
      final data = await Supabase.instance.client
          .from('users')
          .select('stones_balance, streak_count, gender, match_preference, generated_alias, dept_code, batch_year')
          .eq('id', user.id)
          .single();

      if (mounted) {
        setState(() {
          _stones = data['stones_balance'] ?? 10;
          _streak = data['streak_count'] ?? 0;
          userGender = data['gender'];
          _matchPref = data['match_preference'] ?? 'anyone';
          currentAlias = data['generated_alias'];
          final dept = data['dept_code'] ?? 'CSE';
          final year = data['batch_year'] != null ? "'${data['batch_year'].toString().substring(2)}" : "'23";
          userBadge = '$dept $year';
        });
      }
    } catch (e) {
      // Fallback — socket will provide alias
    }
  }

  void _connectSocket() async {
    final session = Supabase.instance.client.auth.currentSession;
    if (session == null) return;

    socket = io.io(AppConfig.socketUrl, io.OptionBuilder()
        .setTransports(['websocket'])
        .setAuth({'token': session.accessToken})
        .build());

    socket.onConnect((_) {});

    socket.on('authenticated', (data) {
      if (mounted) {
        setState(() {
          currentAlias ??= data['alias'];
          userBadge ??= data['badge'] ?? 'EWU Student';
        });
      }
    });

    socket.on('match_found', (data) {
      if (mounted) {
        setState(() => isSearching = false);
        Navigator.push(context, MaterialPageRoute(
          builder: (context) => ChatRoomScreen(
            socket: socket,
            roomId: data['roomId'],
            myAlias: currentAlias ?? 'Anonymous',
            partnerBadge: data['partnerBadge'] ?? 'EWU Student',
            initialIcebreaker: data['icebreaker'],
          ),
        ));
      }
    });

    socket.on('waiting_in_queue', (_) {
      // Keep searching animation active
    });

    socket.on('error', (err) {
      if (mounted) {
        setState(() => isSearching = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(err['message'] ?? 'Error occurred'),
            backgroundColor: const Color(0xFFEF4444),
          ),
        );
      }
    });
  }

  void _startSearching() {
    setState(() => isSearching = true);
    socket.emit('join_1v1_queue', {'seeking': _matchPref});
  }

  void _cancelSearching() {
    setState(() => isSearching = false);
    socket.emit('cancel_1v1_queue');
  }

  void _updateMatchPref(String pref) async {
    setState(() => _matchPref = pref);
    final user = Supabase.instance.client.auth.currentUser;
    if (user != null) {
      await Supabase.instance.client
          .from('users')
          .update({'match_preference': pref})
          .eq('id', user.id);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isMale = (userGender ?? 'male').toLowerCase() == 'male';

    return Scaffold(
      backgroundColor: const Color(0xFF080A0F),
      appBar: AppBar(
        backgroundColor: const Color(0xFF080A0F),
        elevation: 0,
        scrolledUnderElevation: 0,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF6366F1), Color(0xFF10B981)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Text(
                'BENCHLY',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.4,
                  color: Colors.white,
                ),
              ),
            ),
          ],
        ),
        actions: [
          // Stones Balance Pill
          Container(
            margin: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: const Color(0xFF141824),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFF59E0B).withValues(alpha: 0.3)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.diamond_rounded, color: Color(0xFFF59E0B), size: 14),
                const SizedBox(width: 4),
                Text(
                  '$_stones',
                  style: const TextStyle(
                    color: Color(0xFFF59E0B),
                    fontWeight: FontWeight.w700,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),

          // Shortcut to Admin Analytics Dashboard
          IconButton(
            tooltip: 'Campus Analytics',
            icon: const Icon(Icons.insights_rounded, color: Color(0xFF10B981), size: 20),
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const AdminAnalyticsScreen()),
              );
            },
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 18.0, vertical: 10.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Campus Pulse Live Ticker
            Container(
              margin: const EdgeInsets.only(bottom: 16),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFF10B981).withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFF10B981).withValues(alpha: 0.2)),
              ),
              child: Row(
                children: [
                  Container(
                    width: 7,
                    height: 7,
                    decoration: const BoxDecoration(
                      color: Color(0xFF10B981),
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text(
                      'EWU Adda Live • Students chatting right now',
                      style: TextStyle(
                        fontSize: 11,
                        color: Color(0xFF10B981),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  if (_streak > 0)
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.local_fire_department_rounded, color: Color(0xFFFB923C), size: 14),
                        const SizedBox(width: 3),
                        Text(
                          '$_streak d',
                          style: const TextStyle(color: Color(0xFFFB923C), fontSize: 11, fontWeight: FontWeight.bold),
                        ),
                      ],
                    ),
                ],
              ),
            ),

            // Profile Anonymous Card
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF121622),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.4),
                    blurRadius: 18,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Row(
                children: [
                  Container(
                    width: 52,
                    height: 52,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF6366F1), Color(0xFF10B981)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Center(
                      child: Text(
                        (currentAlias != null && currentAlias!.isNotEmpty)
                            ? currentAlias![0].toUpperCase()
                            : 'B',
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w900,
                          color: Colors.white,
                        ),
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
                            color: Colors.white,
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
                                color: (isMale ? const Color(0xFF38BDF8) : const Color(0xFFF472B6))
                                    .withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                isMale ? '♂ MALE' : '♀ FEMALE',
                                style: TextStyle(
                                  color: isMale ? const Color(0xFF38BDF8) : const Color(0xFFF472B6),
                                  fontSize: 10,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                              decoration: BoxDecoration(
                                color: const Color(0xFF10B981).withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                userBadge ?? 'EWU Student',
                                style: const TextStyle(
                                  color: Color(0xFF10B981),
                                  fontSize: 10,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 22),

            // Match Preference Chips
            Text(
              'MATCH WITH',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                letterSpacing: 1.2,
                color: Colors.white.withValues(alpha: 0.4),
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                _buildPrefChip('Anyone', 'anyone'),
                const SizedBox(width: 8),
                _buildPrefChip('Guys', 'male'),
                const SizedBox(width: 8),
                _buildPrefChip('Girls', 'female'),
              ],
            ),
            const SizedBox(height: 24),

            // Radar Matchmaking Animation or Start Button
            if (isSearching)
              _buildSearchingRadar()
            else
              ElevatedButton(
                onPressed: _startSearching,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF10B981),
                  foregroundColor: Colors.white,
                  elevation: 0,
                  minimumSize: const Size(double.infinity, 54),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  shadowColor: const Color(0xFF10B981).withValues(alpha: 0.4),
                ),
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.chair_rounded, size: 20),
                    SizedBox(width: 10),
                    Text(
                      'Take a Seat on the Bench',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.2,
                      ),
                    ),
                  ],
                ),
              ),

            const SizedBox(height: 14),

            // Group Haunt Placeholder
            OutlinedButton(
              onPressed: null,
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(double.infinity, 50),
                side: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.groups_rounded, size: 20, color: Colors.white.withValues(alpha: 0.35)),
                  const SizedBox(width: 10),
                  Text(
                    'Cafeteria Group Adda',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: Colors.white.withValues(alpha: 0.35),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: const Color(0xFF6366F1).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: const Text(
                      'SOON',
                      style: TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF6366F1),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 22),

            // Daily Adda Spark Teaser
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF121622),
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: Colors.white.withValues(alpha: 0.05)),
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
                          color: Colors.white.withValues(alpha: 0.5),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    '"Aftabnagar street food vs Campus Cafeteria: which spot has the best adda vibes?"',
                    style: TextStyle(
                      fontSize: 13,
                      color: Colors.white,
                      fontStyle: FontStyle.italic,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSearchingRadar() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 20),
      decoration: BoxDecoration(
        color: const Color(0xFF121622),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFF10B981).withValues(alpha: 0.3)),
      ),
      child: Column(
        children: [
          AnimatedBuilder(
            animation: _radarController,
            builder: (context, child) {
              return Stack(
                alignment: Alignment.center,
                children: [
                  // Outer ripple
                  Container(
                    width: 72 + (20 * _radarController.value),
                    height: 72 + (20 * _radarController.value),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: const Color(0xFF10B981).withValues(alpha: 0.3 * (1.0 - _radarController.value)),
                        width: 2,
                      ),
                    ),
                  ),
                  // Inner Core
                  Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: const Color(0xFF10B981).withValues(alpha: 0.2),
                      shape: BoxShape.circle,
                      border: Border.all(color: const Color(0xFF10B981), width: 2),
                    ),
                    child: const Icon(Icons.radar_rounded, color: Color(0xFF10B981), size: 28),
                  ),
                ],
              );
            },
          ),
          const SizedBox(height: 16),
          const Text(
            'Scanning the EWU benches...',
            style: TextStyle(
              color: Colors.white,
              fontSize: 15,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Looking for another student in queue (~10-20s)',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.5),
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 16),
          TextButton(
            onPressed: _cancelSearching,
            child: const Text('Cancel Search', style: TextStyle(color: Color(0xFFEF4444), fontSize: 13)),
          ),
        ],
      ),
    );
  }

  Widget _buildPrefChip(String label, String value) {
    final isActive = _matchPref == value;
    return Expanded(
      child: InkWell(
        onTap: () => _updateMatchPref(value),
        borderRadius: BorderRadius.circular(12),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: isActive
                ? const Color(0xFF10B981).withValues(alpha: 0.15)
                : const Color(0xFF141824),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isActive
                  ? const Color(0xFF10B981)
                  : Colors.white.withValues(alpha: 0.06),
            ),
          ),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: isActive
                    ? const Color(0xFF10B981)
                    : Colors.white.withValues(alpha: 0.6),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
