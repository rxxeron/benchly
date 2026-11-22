import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../config/app_config.dart';
import '../utils/pwa_notifications.dart';
import '../widgets/profile_editor_sheet.dart';
import '../widgets/rive_lottie_beacons.dart';
import '../widgets/staggered_reveal.dart';
import 'chat_room_screen.dart';

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
  String _deptCode = 'CSE';
  String? _currentSemester;
  int _stones = 10;
  int _streak = 0;
  String? _equippedAvatarEmoji;
  String _matchPref = 'anyone'; // 'male', 'female', 'anyone'
  String _matchMode = 'campus_adda'; // 'campus_adda', 'same_dept', 'study_buddy'
  late AnimationController _radarController;

  Timer? _searchCountdownTimer;
  int _searchCountdown = AppConfig.searchTimeoutSeconds;
  bool _rotationPromptShown = false;
  bool _urlInviteChecked = false;
  bool _socketConnected = false;
  int _onlineUsersCount = 0;
  String _todaysBenchTopic = 'Aftabnagar street food vs Campus Cafeteria: which spot has the best adda vibes?';
  List<Map<String, dynamic>> _activeCampaigns = [];
  StreamSubscription<AuthState>? _authSub;

  @override
  void initState() {
    super.initState();
    _radarController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat();
    _fetchProfile();
    _fetchCampusConfig();
    _recordAppOpenBeacon();
    _syncWebPushOnStartup();
    _connectSocket();
    _authSub = Supabase.instance.client.auth.onAuthStateChange.listen((data) {
      final token = data.session?.accessToken;
      if (token != null) {
        socket.auth = {'token': token};
        if (!socket.connected) {
          socket.connect();
        }
      }
    });
  }

  @override
  void dispose() {
    _authSub?.cancel();
    _searchCountdownTimer?.cancel();
    _radarController.dispose();
    socket.dispose();
    super.dispose();
  }

  Future<void> _syncWebPushOnStartup() async {
    final token = Supabase.instance.client.auth.currentSession?.accessToken;
    await syncBenchlyPushSubscription(apiBase: AppConfig.socketUrl, bearerToken: token);
  }

  Future<void> _recordAppOpenBeacon() async {
    try {
      await http.post(
        Uri.parse('${AppConfig.socketUrl}/api/telemetry/visit'),
        headers: const {'Content-Type': 'application/json'},
        body: jsonEncode({
          'domain': kIsWeb ? 'app.benchly.live' : 'android-app',
          'event_type': 'app_open',
          'platform': kIsWeb ? 'web' : 'android',
        }),
      );
    } catch (_) {}
  }

  Future<void> _fetchCampusConfig() async {
    try {
      final token = Supabase.instance.client.auth.currentSession?.accessToken;
      final res = await http.get(
        Uri.parse('${AppConfig.socketUrl}/api/campus/config'),
        headers: token != null ? {'Authorization': 'Bearer $token'} : {},
      );
      if (res.statusCode == 200) {
        final body = jsonDecode(res.body) as Map<String, dynamic>;
        final topic = body['todaysBenchTopic']?.toString();
        final camps = (body['activeCampaigns'] as List<dynamic>? ?? [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        if (mounted) {
          setState(() {
            if (topic != null && topic.isNotEmpty) _todaysBenchTopic = topic;
            _activeCampaigns = camps;
          });
        }
      }
    } catch (_) {}
  }

  Future<void> _claimCampaign(String campaignId) async {
    final token = Supabase.instance.client.auth.currentSession?.accessToken;
    if (token == null) return;
    try {
      final res = await http.post(
        Uri.parse('${AppConfig.socketUrl}/api/campaigns/$campaignId/claim'),
        headers: {'Authorization': 'Bearer $token', 'Content-Type': 'application/json'},
      );
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      if (!mounted) return;
      if (res.statusCode == 200 && body['success'] == true) {
        setState(() {
          if (body['stones_balance'] != null) {
            _stones = (body['stones_balance'] as num).toInt();
          }
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Claimed +${body['awarded']} Campus Stones!'),
            backgroundColor: const Color(0xFF0FB881),
          ),
        );
        _fetchCampusConfig();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(body['error']?.toString() ?? 'Unable to claim reward yet.'),
            backgroundColor: const Color(0xFFEF4444),
          ),
        );
      }
    } catch (_) {}
  }

  void _fetchProfile() async {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) return;

    try {
      final data = await Supabase.instance.client
          .from('users')
          .select('stones_balance, streak_count, gender, match_preference, generated_alias, dept_code, batch_year, semester_intake, alias_change_count')
          .eq('id', user.id)
          .single();

      if (mounted) {
        setState(() {
          _stones = data['stones_balance'] ?? 10;
          _streak = data['streak_count'] ?? 0;
          userGender = data['gender'];
          final isFemale = (userGender ?? 'male').toLowerCase() == 'female';
          final savedPref = (data['match_preference'] ?? 'anyone').toString().toLowerCase();
          _matchPref = (isFemale && (savedPref == 'female' || savedPref == 'girls')) ? 'female' : 'anyone';
          currentAlias = data['generated_alias'];
          _deptCode = (data['dept_code'] ?? 'CSE').toString();
          _currentSemester = data['semester_intake']?.toString();
          final yearStr = data['batch_year']?.toString() ?? '';
          final shortYear = yearStr.length >= 2 ? "'${yearStr.substring(yearStr.length - 2)}" : "'23";
          userBadge = (_currentSemester != null && _currentSemester!.isNotEmpty)
              ? '$_deptCode • $_currentSemester'
              : '$_deptCode $shortYear';
        });
      }

      // Fetch equipped EWU Avatar emoji to display on the profile card
      try {
        final perkRows = await Supabase.instance.client
            .from('user_perks')
            .select('stone_perks(icon_emoji, category)')
            .eq('user_id', user.id)
            .eq('is_equipped', true);
        String? foundEmoji;
        for (final r in perkRows) {
          final sp = r['stone_perks'];
          if (sp is Map && sp['icon_emoji'] != null) {
            foundEmoji = sp['icon_emoji'].toString();
            if ((sp['category'] ?? '').toString().toLowerCase().contains('avatar')) break;
          }
        }
        if (mounted && foundEmoji != null) {
          setState(() => _equippedAvatarEmoji = foundEmoji);
        }
      } catch (_) {}
    } catch (e) {
      // Fallback — socket will provide alias
    }
  }

  Future<void> _openProfileEditor() async {
    final result = await showProfileEditorSheet(
      context,
      currentAlias: currentAlias ?? 'Anonymous',
      currentDept: _deptCode,
      currentSemester: _currentSemester,
    );

    if (result != null && mounted) {
      setState(() {
        currentAlias = result.alias;
        _deptCode = result.deptCode;
        _currentSemester = result.currentSemester;
        userBadge = result.badge;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Profile updated: ${result.alias} (${result.badge})'),
          backgroundColor: const Color(0xFF0FB881),
        ),
      );
    }
  }

  void _connectSocket() async {
    final session = Supabase.instance.client.auth.currentSession;
    if (session == null) return;

    if (kDebugMode) {
      debugPrint('🔌 [Socket] Connecting to ${AppConfig.socketUrl}');
    }

    socket = io.io(AppConfig.socketUrl, io.OptionBuilder()
        .setTransports(['websocket', 'polling'])
        .enableAutoConnect()
        .enableReconnection()
        .setAuth({'token': session.accessToken})
        .build());

    socket.onConnect((_) {
      if (kDebugMode) debugPrint('🟢 [Socket] Connected');
      if (mounted) setState(() => _socketConnected = true);
    });

    socket.onConnectError((err) {
      if (kDebugMode) debugPrint('🔴 [Socket] Connect Error: $err');
      if (mounted) setState(() => _socketConnected = false);
    });

    socket.on('connect_timeout', (data) {
      if (kDebugMode) debugPrint('⏰ [Socket] Connect Timeout');
      if (mounted) setState(() => _socketConnected = false);
    });

    socket.onError((err) {
      if (kDebugMode) debugPrint('🔴 [Socket] Error: $err');
    });

    socket.onDisconnect((reason) {
      if (kDebugMode) debugPrint('⚠️ [Socket] Disconnected: $reason');
      if (mounted) setState(() => _socketConnected = false);
      final freshToken = Supabase.instance.client.auth.currentSession?.accessToken;
      if (freshToken != null) {
        socket.auth = {'token': freshToken};
      }
    });

    socket.on('campus_pulse', (data) {
      if (mounted && data is Map && data['onlineUsers'] != null) {
        final count = (data['onlineUsers'] as num).toInt();
        setState(() => _onlineUsersCount = count);
      }
    });

    socket.on('authenticated', (data) {
      if (kDebugMode) debugPrint('🎉 [Socket] Authenticated');
      if (mounted) {
        setState(() {
          currentAlias = data['alias'] ?? currentAlias;
          userBadge ??= data['badge'] ?? 'EWU Student';
        });

        if (data['aliasRotationDue'] == true) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            _promptAliasRotation();
          });
        }

        _checkUrlInvite();
      }
    });

    socket.on('alias_updated', (data) {
      if (mounted && data?['newAlias'] != null) {
        setState(() {
          currentAlias = data['newAlias'];
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Your alias was updated to: ${data['newAlias']}'),
            backgroundColor: const Color(0xFF0FB881),
          ),
        );
      }
    });

    socket.on('invite_error', (data) {
      if (mounted) {
        showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: const Color(0xFFFFFFFF),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
            title: const Row(
              children: [
                Icon(Icons.info_outline_rounded, color: Color(0xFFEF4444), size: 20),
                SizedBox(width: 8),
                Text('Bench Invite', style: TextStyle(color: Color(0xFF1E1B18), fontSize: 16, fontWeight: FontWeight.w800)),
              ],
            ),
            content: Text(
              data?['message'] ?? 'This bench invite has expired or already ended.',
              style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.80), fontSize: 13),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('OK', style: TextStyle(color: Color(0xFF0FB881))),
              ),
            ],
          ),
        );
      }
    });

    socket.on('bench_topic_updated', (data) {
      final t = data?['topic']?.toString();
      if (mounted && t != null && t.isNotEmpty) {
        setState(() => _todaysBenchTopic = t);
      }
    });

    socket.on('campaigns_updated', (_) {
      _fetchCampusConfig();
    });

    socket.on('match_found', (data) {
      _searchCountdownTimer?.cancel();
      notifyBenchlyEvent(
        '🪑 Bench Match Found!',
        'Paired with ${data['partnerAlias'] ?? 'an EWU classmate'} — say hi!',
        tag: 'match_found',
      );
      if (mounted) {
        setState(() => isSearching = false);
        Navigator.push(context, MaterialPageRoute(
          builder: (context) => ChatRoomScreen(
            socket: socket,
            roomId: data['roomId'],
            myAlias: currentAlias ?? 'Anonymous',
            partnerAlias: data['partnerAlias'] ?? 'Anonymous Student',
            partnerBadge: data['partnerBadge'] ?? 'EWU Student',
            initialIcebreaker: data['icebreaker'],
          ),
        ));
      }
    });

    socket.on('session_resumed', (data) {
      _searchCountdownTimer?.cancel();
      if (mounted && data != null && data['roomId'] != null) {
        setState(() => isSearching = false);
        final rawMsgs = (data['messages'] as List?) ?? [];
        final restored = rawMsgs
            .whereType<Map>()
            .map((m) => Map<String, dynamic>.from(m))
            .toList();
        Navigator.push(context, MaterialPageRoute(
          builder: (context) => ChatRoomScreen(
            socket: socket,
            roomId: data['roomId'].toString(),
            myAlias: currentAlias ?? 'Anonymous',
            partnerAlias: data['partnerAlias']?.toString() ?? 'Anonymous Student',
            partnerBadge: data['partnerBadge']?.toString() ?? 'EWU Student',
            initialMessages: restored,
            initialTimeLeftSeconds: data['timeLeftSeconds'] is int ? data['timeLeftSeconds'] as int : null,
          ),
        ));
      }
    });

    socket.on('group_lounge_joined', (data) {
      _searchCountdownTimer?.cancel();
      notifyBenchlyEvent(
        '☕ Cafeteria Lounge Ready',
        'Pulled up a seat in ${data['topic'] ?? 'Cafeteria Hangout'}!',
        tag: 'group_lounge',
      );
      if (mounted) {
        setState(() => isSearching = false);
        final topic = data['topic']?.toString() ?? 'Cafeteria Hangout';
        final count = data['membersCount'] ?? 1;
        Navigator.push(context, MaterialPageRoute(
          builder: (context) => ChatRoomScreen(
            socket: socket,
            roomId: data['roomId'],
            myAlias: currentAlias ?? 'Anonymous',
            partnerAlias: '☕ $topic',
            partnerBadge: '$count/5 Seated',
            initialIcebreaker: data['icebreaker'],
            isGroupLounge: true,
          ),
        ));
      }
    });

    socket.on('waiting_in_queue', (_) {
      // Keep searching animation active
    });

    socket.on('queue_timeout', (data) {
      _searchCountdownTimer?.cancel();
      if (mounted) {
        setState(() => isSearching = false);
        _showTimeoutBottomSheet(data?['message']);
      }
    });

    socket.on('error', (err) {
      _searchCountdownTimer?.cancel();
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
    debugPrint('🔍 [_startSearching] socket.connected=${socket.connected}, id=${socket.id}, seeking=$_matchPref');
    if (!socket.connected) {
      debugPrint('⚠️ Socket not connected, calling socket.connect()...');
      socket.connect();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Connecting to Benchly server... please try again in a moment.'),
          backgroundColor: Color(0xFFF59E0B),
        ),
      );
      return;
    }

    _searchCountdownTimer?.cancel();
    setState(() {
      isSearching = true;
      _searchCountdown = AppConfig.searchTimeoutSeconds;
    });

    socket.emit('join_1v1_queue', {'seeking': _matchPref, 'mode': _matchMode});
    debugPrint('🚀 Emitted join_1v1_queue with seeking=$_matchPref, mode=$_matchMode');

    _searchCountdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_searchCountdown > 1) {
        setState(() => _searchCountdown--);
      } else {
        timer.cancel();
        _cancelSearching();
        _showTimeoutBottomSheet();
      }
    });
  }

  void _cancelSearching() {
    _searchCountdownTimer?.cancel();
    setState(() => isSearching = false);
    socket.emit('cancel_1v1_queue');
  }

  void _showTimeoutBottomSheet([String? customMessage]) {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFFFFF9F0),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 58,
                  height: 58,
                  decoration: BoxDecoration(
                    color: const Color(0xFFF59E0B).withValues(alpha: 0.15),
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: const Color(0xFFF59E0B).withValues(alpha: 0.3),
                      width: 1.5,
                    ),
                  ),
                  child: const Center(
                    child: Text('☕', style: TextStyle(fontSize: 26)),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'No Benches Open Right Now',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: const Color(0xFF1E1B18),
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.4,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                customMessage ??
                    'Looks like most EWU students are in class or offline right now.\nPeak Adda hours: 8:00 PM – 12:00 AM.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Color(0xFF1E1B18).withValues(alpha: 0.70),
                  fontSize: 13,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 24),
              if (_matchPref != 'anyone') ...[
                ElevatedButton(
                  onPressed: () {
                    Navigator.pop(ctx);
                    _updateMatchPref('anyone');
                    _startSearching();
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0FB881),
                    foregroundColor: Colors.white,
                    elevation: 0,
                    minimumSize: const Size(double.infinity, 48),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  child: const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.all_inclusive_rounded, size: 18),
                      SizedBox(width: 8),
                      Text('Match with Anyone (Higher Chance)',
                          style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                    ],
                  ),
                ),
                const SizedBox(height: 10),
              ],
              OutlinedButton(
                onPressed: () {
                  Navigator.pop(ctx);
                  _startSearching();
                },
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFF1E1B18),
                  side: BorderSide(color: Color(0xFF1E1B18).withValues(alpha: 0.28)),
                  minimumSize: const Size(double.infinity, 48),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: const Text('Try Searching Again',
                    style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
              ),
              const SizedBox(height: 6),
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: Text(
                  'Back to Home',
                  style: TextStyle(
                    color: Color(0xFF1E1B18).withValues(alpha: 0.50),
                    fontSize: 13,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
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

  void _promptAliasRotation() {
    if (_rotationPromptShown || !mounted) return;
    _rotationPromptShown = true;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFFFFFFFF),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Row(
          children: [
            Text('⏳', style: TextStyle(fontSize: 22)),
            SizedBox(width: 8),
            Text(
              '15-Day Alias Rotation',
              style: TextStyle(color: Color(0xFF1E1B18), fontSize: 17, fontWeight: FontWeight.bold),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Your alias "$currentAlias" is 15+ days old. To ensure complete privacy and anonymity, Benchly rotates nicknames every 15 days.',
              style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.85), fontSize: 13, height: 1.4),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF0FB881).withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFF0FB881).withValues(alpha: 0.25)),
              ),
              child: const Text(
                'Safety note: A permanent audit history is kept to investigate any harassment reports.',
                style: TextStyle(color: Color(0xFF34D399), fontSize: 11),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              socket.emit('rotate_alias', {'changeType': 'auto'});
            },
            child: Text('Auto-Rotate Now', style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.70))),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              socket.emit('rotate_alias', {'changeType': 'manual'});
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF0FB881),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: const Text('Roll New Alias'),
          ),
        ],
      ),
    );
  }

  void _checkUrlInvite() {
    if (_urlInviteChecked) return;
    _urlInviteChecked = true;

    try {
      final inviteParam = Uri.base.queryParameters['invite'];
      if (inviteParam != null && inviteParam.trim().isNotEmpty) {
        final code = inviteParam.trim().toLowerCase();
        debugPrint('🔗 [Invite] Found URL invite query parameter: $code');
        WidgetsBinding.instance.addPostFrameCallback((_) {
          _promptJoinInviteBench(code);
        });
      }
    } catch (e) {
      debugPrint('⚠️ [Invite] Error checking invite param: $e');
    }
  }

  void _promptJoinInviteBench(String code) {
    if (!mounted) return;
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFFFFF9F0),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 26),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 58,
                  height: 58,
                  decoration: BoxDecoration(
                    color: const Color(0xFF0FB881).withValues(alpha: 0.15),
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: const Color(0xFF0FB881).withValues(alpha: 0.3),
                      width: 1.5,
                    ),
                  ),
                  child: const Center(
                    child: Icon(Icons.chair_rounded, color: Color(0xFF0FB881), size: 28),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Private Bench Invitation',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Color(0xFF1E1B18),
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.4,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'You were invited to sit on a private East West University bench (Code: ${code.toUpperCase()}).\nBoth of you will earn +5 Stones!',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Color(0xFF1E1B18).withValues(alpha: 0.80),
                  fontSize: 13,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 22),
              ElevatedButton(
                onPressed: () {
                  Navigator.pop(ctx);
                  _joinInviteBench(code);
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0FB881),
                  foregroundColor: Colors.white,
                  minimumSize: const Size(double.infinity, 50),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.login_rounded, size: 18),
                    SizedBox(width: 8),
                    Text('Join Bench Now', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: Text(
                  'Decline / Back',
                  style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.50), fontSize: 13),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _joinInviteBench(String code) {
    if (!socket.connected) {
      socket.connect();
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Joining private bench ${code.toUpperCase()}...'),
        backgroundColor: const Color(0xFF0FB881),
        duration: const Duration(seconds: 2),
      ),
    );
    socket.emit('join_invite_bench', {'code': code});
  }

  void _showInviteFriendModal() {
    if (!socket.connected) {
      socket.connect();
    }

    String? generatedCode;
    String? generatedUrl;
    bool isGenerating = true;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFFFFF9F0),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (modalCtx, setModalState) {
            if (isGenerating && generatedCode == null) {
              void onCreated(dynamic data) {
                if (modalCtx.mounted) {
                  setModalState(() {
                    generatedCode = data['code'];
                    generatedUrl = data['inviteUrl'] ?? 'https://app.benchly.live/?invite=${data['code']}';
                    isGenerating = false;
                  });
                }
              }

              socket.once('invite_bench_created', onCreated);
              socket.emit('create_invite_bench');
            }

            final url = generatedUrl ?? (generatedCode != null ? 'https://app.benchly.live/?invite=$generatedCode' : '');

            return SafeArea(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Center(
                      child: Container(
                        width: 40,
                        height: 4,
                        decoration: BoxDecoration(
                          color: Color(0xFF1E1B18).withValues(alpha: 0.28),
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(
                              colors: [Color(0xFF6366F1), Color(0xFF0FB881)],
                            ),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Icon(Icons.share_rounded, color: Colors.white, size: 22),
                        ),
                        const SizedBox(width: 12),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Invite a Friend to Bench',
                                style: TextStyle(
                                  color: const Color(0xFF1E1B18),
                                  fontSize: 17,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: -0.3,
                                ),
                              ),
                              SizedBox(height: 2),
                              Text(
                                'Bring a friend for a 15-min adda • Earn +5 Stones',
                                style: TextStyle(
                                  color: Color(0xFF0FB881),
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),

                    if (isGenerating)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 36),
                        child: Column(
                          children: [
                            CircularProgressIndicator(color: Color(0xFF0FB881), strokeWidth: 2.5),
                            SizedBox(height: 14),
                            Text(
                              'Generating your private short link...',
                              style: TextStyle(color: const Color(0xFF44403C), fontSize: 13),
                            ),
                          ],
                        ),
                      )
                    else ...[
                      // Link Display Box
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFFFFF),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFF6366F1).withValues(alpha: 0.3)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.link_rounded, color: Color(0xFF818CF8), size: 18),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                url,
                                style: const TextStyle(
                                  color: Color(0xFF1E1B18),
                                  fontSize: 13,
                                  fontWeight: FontWeight.w700,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            IconButton(
                              tooltip: 'Copy Link',
                              icon: const Icon(Icons.copy_rounded, color: Color(0xFF0FB881), size: 18),
                              onPressed: () {
                                Clipboard.setData(ClipboardData(text: url));
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text('Short link copied! Share with your friend.'),
                                    backgroundColor: Color(0xFF0FB881),
                                    duration: Duration(seconds: 2),
                                  ),
                                );
                              },
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 14),

                      // Action Buttons
                      Row(
                        children: [
                          Expanded(
                            child: ElevatedButton.icon(
                              onPressed: () {
                                Clipboard.setData(ClipboardData(text: url));
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text('Invite link copied to clipboard!'),
                                    backgroundColor: Color(0xFF0FB881),
                                  ),
                                );
                              },
                              icon: const Icon(Icons.copy_rounded, size: 16),
                              label: const Text('Copy Link'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFFFFFFFF),
                                foregroundColor: const Color(0xFF1E1B18),
                                elevation: 0,
                                minimumSize: const Size(0, 46),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  side: const BorderSide(color: Color(0xFF1E1B18), width: 1.5),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: ElevatedButton.icon(
                              onPressed: () async {
                                final text = Uri.encodeComponent(
                                  'Hey! Sit with me on Benchly for an adda: $url',
                                );
                                final waUri = Uri.parse('https://wa.me/?text=$text');
                                if (await canLaunchUrl(waUri)) {
                                  await launchUrl(waUri, mode: LaunchMode.externalApplication);
                                } else {
                                  Clipboard.setData(ClipboardData(text: url));
                                  if (mounted) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                        content: Text('Link copied! Paste into WhatsApp or Messenger.'),
                                        backgroundColor: Color(0xFF0FB881),
                                      ),
                                    );
                                  }
                                }
                              },
                              icon: const Text('💬', style: TextStyle(fontSize: 16)),
                              label: const Text('WhatsApp'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFF25D366),
                                foregroundColor: Colors.white,
                                elevation: 0,
                                minimumSize: const Size(0, 46),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 18),

                      // Waiting Pulse Note
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFFFFF),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: Color(0xFF1E1B18).withValues(alpha: 0.15)),
                        ),
                        child: Row(
                          children: [
                            Container(
                              width: 8,
                              height: 8,
                              decoration: const BoxDecoration(
                                color: Color(0xFF0FB881),
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                'Bench is waiting for your friend to open the link. Once they join, this screen will automatically open the chat!',
                                style: TextStyle(
                                  color: Color(0xFF1E1B18).withValues(alpha: 0.75),
                                  fontSize: 11,
                                  height: 1.35,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    const SizedBox(height: 10),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final isMale = (userGender ?? 'male').toLowerCase() == 'male';

    return Scaffold(
      backgroundColor: const Color(0xFFFFF9F0),
      appBar: AppBar(
        backgroundColor: const Color(0xFFFFF9F0),
        elevation: 0,
        scrolledUnderElevation: 0,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
              decoration: BoxDecoration(
                color: const Color(0xFF0FB881),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: const Color(0xFF1E1B18), width: 1.8),
                boxShadow: const [
                  BoxShadow(color: Color(0xFF1E1B18), offset: Offset(2, 2)),
                ],
              ),
              child: const Text(
                'BENCHLY',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.2,
                  color: Colors.white,
                ),
              ),
            ),
          ],
        ),
        actions: [
          // Enable Alerts & Install PWA Pill Button
          GestureDetector(
            onTap: () async {
              final messenger = ScaffoldMessenger.of(context);
              final token = Supabase.instance.client.auth.currentSession?.accessToken;
              final perm = await enableBenchlyNotifications(
                apiBase: AppConfig.socketUrl,
                bearerToken: token,
              );
              final pwaRes = await promptBenchlyPwaInstall();
              if (!mounted) return;
              final msg = pwaRes == 'accepted'
                  ? '📲 Benchly installed & notifications active!'
                  : (perm == 'granted'
                      ? '🔔 Match & chat notifications enabled!'
                      : '🔔 Tap browser lock icon to allow notifications, or use "Add to Home Screen" to install PWA.');
              messenger.showSnackBar(
                SnackBar(
                  content: Text(msg),
                  backgroundColor: const Color(0xFF0FB881),
                  duration: const Duration(seconds: 3),
                ),
              );
            },
            child: Container(
              margin: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: const Color(0xFFDCFCE7),
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: const Color(0xFF1E1B18), width: 1.5),
                boxShadow: const [
                  BoxShadow(color: Color(0xFF1E1B18), offset: Offset(2, 2)),
                ],
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.notifications_active_rounded, color: Color(0xFF047857), size: 14),
                  SizedBox(width: 4),
                  Text(
                    'Alerts / App',
                    style: TextStyle(
                      color: Color(0xFF1E1B18),
                      fontWeight: FontWeight.w800,
                      fontSize: 11.5,
                    ),
                  ),
                ],
              ),
            ),
          ),
          // Stones Balance Pill
          Container(
            margin: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 4),
            decoration: BoxDecoration(
              color: const Color(0xFFFEF3C7),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: const Color(0xFF1E1B18), width: 1.5),
              boxShadow: const [
                BoxShadow(color: Color(0xFF1E1B18), offset: Offset(2, 2)),
              ],
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.diamond_rounded, color: Color(0xFFD97706), size: 14),
                const SizedBox(width: 4),
                Text(
                  '$_stones',
                  style: const TextStyle(
                    color: Color(0xFF1E1B18),
                    fontWeight: FontWeight.w800,
                    fontSize: 12.5,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 18.0, vertical: 10.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Real-Time Campus Pulse Ticker
            Container(
              margin: const EdgeInsets.only(bottom: 16),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                color: (_socketConnected ? const Color(0xFF0FB881) : const Color(0xFFF59E0B)).withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: (_socketConnected ? const Color(0xFF0FB881) : const Color(0xFFF59E0B)).withValues(alpha: 0.22),
                ),
              ),
              child: Row(
                children: [
                  Container(
                    width: 7,
                    height: 7,
                    decoration: BoxDecoration(
                      color: _socketConnected ? const Color(0xFF0FB881) : const Color(0xFFF59E0B),
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      !_socketConnected
                          ? 'Connecting to Benchly campus server...'
                          : (_onlineUsersCount > 1
                              ? '$_onlineUsersCount EWU students online right now'
                              : 'Quiet hours • Invite a friend or open a Group Lounge'),
                      style: TextStyle(
                        fontSize: 11,
                        color: _socketConnected ? const Color(0xFF0FB881) : const Color(0xFFF59E0B),
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
                color: const Color(0xFFFFFFFF),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFF1E1B18), width: 1.8),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0xFF1E1B18),
                    offset: Offset(4, 4),
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
                        colors: [Color(0xFFFF6B4A), Color(0xFF0FB881)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFF1E1B18), width: 1.5),
                    ),
                    child: Center(
                      child: _equippedAvatarEmoji != null
                          ? Text(
                              _equippedAvatarEmoji!,
                              style: const TextStyle(fontSize: 26),
                            )
                          : Text(
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
                            color: const Color(0xFF1E1B18),
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
                                color: (isMale ? const Color(0xFF0284C7) : const Color(0xFFF472B6))
                                    .withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                isMale ? '♂ MALE' : '♀ FEMALE',
                                style: TextStyle(
                                  color: isMale ? const Color(0xFF0284C7) : const Color(0xFFF472B6),
                                  fontSize: 10,
                                  fontWeight: FontWeight.w700,
                                ),
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
                                style: const TextStyle(
                                  color: Color(0xFF0FB881),
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
                  IconButton(
                    tooltip: 'Edit nickname, department & semester',
                    onPressed: _openProfileEditor,
                    style: IconButton.styleFrom(
                      backgroundColor: const Color(0xFFFFF2DF),
                      side: const BorderSide(color: Color(0xFF1E1B18), width: 1.5),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    icon: const Icon(Icons.edit_rounded, color: Color(0xFF1E1B18), size: 18),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 22),

            // Match Preference Chips (Girls Only option exclusively for female students; boys always match with Anyone)
            StaggeredReveal(
              index: 2,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (!isMale) ...[
                    Text(
                      'MATCH WITH',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.2,
                        color: Color(0xFF1E1B18).withValues(alpha: 0.50),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        _buildPrefChip('Anyone', 'anyone'),
                        const SizedBox(width: 8),
                        _buildPrefChip('Girls Only', 'female'),
                      ],
                    ),
                    const SizedBox(height: 14),
                  ],
                  Text(
                    'ADDA VIBE',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1.2,
                      color: Color(0xFF1E1B18).withValues(alpha: 0.50),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      _buildModeChip('☕ Campus Adda', 'campus_adda'),
                      const SizedBox(width: 8),
                      _buildModeChip('🎓 Same Dept', 'same_dept'),
                      const SizedBox(width: 8),
                      _buildModeChip('📚 Study Buddy', 'study_buddy'),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 22),

            // Radar Matchmaking Animation or Start Button
            if (isSearching)
              _buildSearchingRadar()
            else
              StaggeredReveal(
                index: 3,
                child: SpringTap(
                  child: Container(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: const [
                        BoxShadow(color: Color(0xFF1E1B18), offset: Offset(4, 4)),
                      ],
                    ),
                    child: ElevatedButton(
                      onPressed: _startSearching,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF0FB881),
                        foregroundColor: Colors.white,
                        elevation: 0,
                        minimumSize: const Size(double.infinity, 54),
                        side: const BorderSide(color: Color(0xFF1E1B18), width: 2),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
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
                  ),
                ),
              ),

            const SizedBox(height: 14),

            // Invite Friend Direct Bench Card
            Container(
              decoration: BoxDecoration(
                color: const Color(0xFFFEF3C7),
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: const Color(0xFF1E1B18), width: 1.8),
                boxShadow: const [
                  BoxShadow(color: Color(0xFF1E1B18), offset: Offset(3, 3)),
                ],
              ),
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: _showInviteFriendModal,
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
                                    style: TextStyle(
                                      color: const Color(0xFF1E1B18),
                                      fontWeight: FontWeight.w700,
                                      fontSize: 14,
                                    ),
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
                                      style: TextStyle(
                                        color: Color(0xFFF59E0B),
                                        fontWeight: FontWeight.w800,
                                        fontSize: 10,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 3),
                              Text(
                                'Share a short link to WhatsApp/Messenger. Connect instantly on a private bench!',
                                style: TextStyle(
                                  color: Color(0xFF1E1B18).withValues(alpha: 0.70),
                                  fontSize: 11,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Icon(Icons.arrow_forward_ios_rounded, size: 14, color: Color(0xFF1E1B18).withValues(alpha: 0.50)),
                      ],
                    ),
                  ),
                ),
              ),
            ),

            const SizedBox(height: 14),

            // Live 5-Person Cafeteria Group Adda Lounge Button
            StaggeredReveal(
              index: 5,
              child: SpringTap(
                onTap: _showGroupLoungeTopicSheet,
                child: OutlinedButton(
                  onPressed: _showGroupLoungeTopicSheet,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(double.infinity, 52),
                    side: BorderSide(color: const Color(0xFF6366F1).withValues(alpha: 0.45)),
                    backgroundColor: const Color(0xFF6366F1).withValues(alpha: 0.10),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.groups_rounded, size: 20, color: Color(0xFF818CF8)),
                      const SizedBox(width: 10),
                      const Text(
                        'Cafeteria Group Adda (5-Student Lounge)',
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w700,
                          color: const Color(0xFF1E1B18),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0xFF0FB881).withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: const Text(
                          'LIVE',
                          style: TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFF0FB881),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 22),

            // Daily Adda Spark Teaser
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFFFFFFF),
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: const Color(0xFF1E1B18), width: 1.8),
                boxShadow: const [
                  BoxShadow(color: Color(0xFF1E1B18), offset: Offset(3, 3)),
                ],
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
                          color: Color(0xFF1E1B18).withValues(alpha: 0.60),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '"$_todaysBenchTopic"',
                    style: const TextStyle(
                      fontSize: 13,
                      color: const Color(0xFF1E1B18),
                      fontStyle: FontStyle.italic,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),

            if (_activeCampaigns.isNotEmpty) ...[
              const SizedBox(height: 14),
              ..._activeCampaigns.map((camp) {
                final progress = (camp['current_progress'] as num?)?.toInt() ?? 0;
                final target = (camp['target_value'] as num?)?.toInt() ?? 1;
                final reward = (camp['reward_stones'] as num?)?.toInt() ?? 5;
                final claimed = camp['claimed'] == true;
                final canClaim = camp['can_claim'] == true;
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
                          : Color(0xFF1E1B18).withValues(alpha: 0.15),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(camp['icon_emoji']?.toString() ?? '⭐', style: const TextStyle(fontSize: 16)),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              camp['title']?.toString() ?? 'Campus Campaign',
                              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: const Color(0xFF1E1B18)),
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
                        camp['description']?.toString() ?? '',
                        style: TextStyle(fontSize: 12, color: Color(0xFF1E1B18).withValues(alpha: 0.75)),
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
                                backgroundColor: Color(0xFF1E1B18).withValues(alpha: 0.15),
                                valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF0FB881)),
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Text(
                            '$progress/$target',
                            style: TextStyle(fontSize: 11, color: Color(0xFF1E1B18).withValues(alpha: 0.80)),
                          ),
                          if (canClaim) ...[
                            const SizedBox(width: 10),
                            ElevatedButton(
                              onPressed: () => _claimCampaign(camp['id'].toString()),
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
              }),
            ],
          ],
        ),
      ),
    );
  }

  void _showGroupLoungeTopicSheet() {
    if (!socket.connected) {
      socket.connect();
    }

    const topics = [
      {'title': 'CSE Midterm & Lab Vent', 'emoji': '💻', 'desc': 'Algorithms, debugging & exam survival'},
      {'title': 'Aftabnagar Foodies Lounge', 'emoji': '☕', 'desc': 'Main gate cha, momos & cafeteria reviews'},
      {'title': 'Campus & Club Gossip', 'emoji': '🎭', 'desc': 'Ground floor benches & campus happenings'},
      {'title': 'Midnight Night-Owl Study', 'emoji': '🦉', 'desc': 'Late night cram sprint with batchmates'},
    ];

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFFFFF9F0),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Join a 5-Student Cafeteria Group Adda',
                style: TextStyle(
                  color: const Color(0xFF1E1B18),
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Pick a live campus lounge topic. Up to 5 EWU classmates sit together anonymously!',
                style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.70), fontSize: 12),
              ),
              const SizedBox(height: 16),
              ...topics.map((t) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: SpringTap(
                      onTap: () {
                        Navigator.pop(ctx);
                        socket.emit('join_group_lounge', {'topic': t['title']});
                      },
                      child: Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFFFFF),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFF6366F1).withValues(alpha: 0.3)),
                        ),
                        child: Row(
                          children: [
                            Text(t['emoji']!, style: const TextStyle(fontSize: 22)),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    t['title']!,
                                    style: const TextStyle(
                                      color: const Color(0xFF1E1B18),
                                      fontWeight: FontWeight.w700,
                                      fontSize: 13.5,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    t['desc']!,
                                    style: TextStyle(
                                      color: Color(0xFF1E1B18).withValues(alpha: 0.65),
                                      fontSize: 11,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const Icon(Icons.arrow_forward_ios_rounded, size: 14, color: Color(0xFF818CF8)),
                          ],
                        ),
                      ),
                    ),
                  )),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSearchingRadar() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 22, horizontal: 20),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFFFF),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFF0FB881).withValues(alpha: 0.3)),
      ),
      child: Column(
        children: [
          RiveLottieRadarBeacon(
            state: RadarMachineState.scanning1v1,
            countdownSeconds: _searchCountdown,
            activeTopic: _matchMode,
          ),
          const SizedBox(height: 12),
          const Text(
            'Scanning the EWU benches...',
            style: TextStyle(
              color: const Color(0xFF1E1B18),
              fontSize: 15,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            _searchCountdown > 15
                ? 'Finding the best campus classmate to sit with...'
                : 'Checking across all EWU departments...',
            style: TextStyle(
              color: Color(0xFF1E1B18).withValues(alpha: 0.60),
              fontSize: 12,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 14),
          TextButton(
            onPressed: _cancelSearching,
            child: const Text('Cancel Search', style: TextStyle(color: Color(0xFFEF4444), fontSize: 13)),
          ),
        ],
      ),
    );
  }

  Widget _buildModeChip(String label, String value) {
    final isActive = _matchMode == value;
    return Expanded(
      child: SpringTap(
        onTap: () => setState(() => _matchMode = value),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
          padding: const EdgeInsets.symmetric(vertical: 9),
          decoration: BoxDecoration(
            color: isActive
                ? const Color(0xFF6366F1).withValues(alpha: 0.18)
                : const Color(0xFFFFFFFF),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isActive
                  ? const Color(0xFF6366F1)
                  : Color(0xFF1E1B18).withValues(alpha: 0.15),
            ),
          ),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
                color: isActive
                    ? const Color(0xFF818CF8)
                    : Color(0xFF1E1B18).withValues(alpha: 0.70),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPrefChip(String label, String value) {
    final isActive = _matchPref == value;
    return Expanded(
      child: SpringTap(
        onTap: () => _updateMatchPref(value),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: isActive
                ? const Color(0xFF0FB881).withValues(alpha: 0.15)
                : const Color(0xFFFFFFFF),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isActive
                  ? const Color(0xFF0FB881)
                  : Color(0xFF1E1B18).withValues(alpha: 0.15),
            ),
          ),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: isActive
                    ? const Color(0xFF0FB881)
                    : Color(0xFF1E1B18).withValues(alpha: 0.70),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
