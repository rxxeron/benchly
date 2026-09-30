import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../config/app_config.dart';
import 'chat_room_screen.dart';

class HomeTabScreen extends StatefulWidget {
  const HomeTabScreen({super.key});
  @override
  State<HomeTabScreen> createState() => _HomeTabScreenState();
}

class _HomeTabScreenState extends State<HomeTabScreen> {
  late io.Socket socket;
  bool isSearching = false;
  String? currentAlias;
  String? userGender;
  int _stones = 10;
  int _streak = 0;
  String _matchPref = 'anyone'; // 'male', 'female', 'anyone'

  @override
  void initState() {
    super.initState();
    _fetchProfile();
    _connectSocket();
  }

  void _fetchProfile() async {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) return;

    try {
      final data = await Supabase.instance.client
          .from('users')
          .select('stones_balance, streak_count, gender, match_preference, generated_alias')
          .eq('id', user.id)
          .single();

      if (mounted) {
        setState(() {
          _stones = data['stones_balance'] ?? 10;
          _streak = data['streak_count'] ?? 0;
          userGender = data['gender'];
          _matchPref = data['match_preference'] ?? 'anyone';
          currentAlias = data['generated_alias'];
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
        setState(() => currentAlias ??= data['alias']);
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
          ),
        ));
      }
    });

    socket.on('waiting_in_queue', (_) {
      // Already showing searching state
    });
  }

  void _startSearching() {
    setState(() => isSearching = true);
    socket.emit('join_1v1_queue', {'seeking': _matchPref});
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
  void dispose() {
    socket.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isMale = (userGender ?? 'male').toLowerCase() == 'male';

    return Scaffold(
      backgroundColor: const Color(0xFF0F1015),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0F1015),
        elevation: 0,
        scrolledUnderElevation: 0,
        title: const Text(
          'Benchly',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.5,
            color: Colors.white,
          ),
        ),
        actions: [
          Container(
            margin: const EdgeInsets.symmetric(vertical: 10, horizontal: 16),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: BoxDecoration(
              color: const Color(0xFF1E1F29),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: const Color(0xFFF59E0B).withValues(alpha: 0.3),
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.diamond_rounded, color: Color(0xFFF59E0B), size: 15),
                const SizedBox(width: 6),
                Text(
                  '$_stones',
                  style: const TextStyle(
                    color: Color(0xFFF59E0B),
                    fontWeight: FontWeight.w700,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 20.0, vertical: 12.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Streak Pill
            if (_streak > 0)
              Align(
                alignment: Alignment.centerLeft,
                child: Container(
                  margin: const EdgeInsets.only(bottom: 16),
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: const Color(0xFF181920),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.local_fire_department_rounded, color: Color(0xFFFB923C), size: 16),
                      const SizedBox(width: 6),
                      Text(
                        '$_streak Day Streak',
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.85),
                          fontWeight: FontWeight.w600,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ),

            // Profile Card
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF181920),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.3),
                    blurRadius: 16,
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
                        colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Center(
                      child: Text(
                        (currentAlias != null && currentAlias!.isNotEmpty)
                            ? currentAlias![0].toUpperCase()
                            : 'B',
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
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
                            fontWeight: FontWeight.w700,
                            fontSize: 16,
                            letterSpacing: -0.3,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          '@${(currentAlias ?? 'user').replaceAll(' ', '').toLowerCase()}',
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.45),
                            fontSize: 12,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
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
                              letterSpacing: 0.3,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    Icons.verified_rounded,
                    size: 20,
                    color: const Color(0xFF6366F1).withValues(alpha: 0.7),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Match Preference Chips
            Text(
              'MATCH WITH',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
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

            // Primary CTA
            ElevatedButton(
              onPressed: isSearching ? null : _startSearching,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF6366F1),
                foregroundColor: Colors.white,
                elevation: 0,
                minimumSize: const Size(double.infinity, 54),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                disabledBackgroundColor: const Color(0xFF262838),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (isSearching)
                    const SizedBox(
                      width: 18, height: 18,
                      child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.2),
                    )
                  else
                    const Icon(Icons.bolt_rounded, size: 20),
                  const SizedBox(width: 10),
                  Text(
                    isSearching ? 'Matching with a student...' : 'Start Chatting 1v1',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.2,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),

            // Group Chat — Coming Soon
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
                    'Group Haunt',
                    style: TextStyle(
                      fontSize: 15,
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
                      'V2',
                      style: TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF6366F1),
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 28),

            // Empty State
            Container(
              padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 20),
              decoration: BoxDecoration(
                color: const Color(0xFF14151C),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.white.withValues(alpha: 0.04)),
              ),
              child: Column(
                children: [
                  Container(
                    width: 44, height: 44,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.04),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.chat_bubble_outline_rounded,
                      size: 20,
                      color: Colors.white.withValues(alpha: 0.35),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    'No active chats',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.6),
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Tap "Start Chatting 1v1" to begin\na 15-minute anonymous session',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.35),
                      fontSize: 12,
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
                ? const Color(0xFF6366F1).withValues(alpha: 0.15)
                : const Color(0xFF181920),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isActive
                  ? const Color(0xFF6366F1).withValues(alpha: 0.5)
                  : Colors.white.withValues(alpha: 0.06),
            ),
          ),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: isActive
                    ? const Color(0xFF6366F1)
                    : Colors.white.withValues(alpha: 0.6),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
