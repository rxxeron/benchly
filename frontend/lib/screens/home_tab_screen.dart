import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:supabase_flutter/supabase_flutter.dart';
import '../config/app_config.dart';
import '../utils/pwa_notifications.dart';
import '../widgets/home/home_cards.dart';
import '../widgets/home/home_modals.dart';
import '../widgets/profile_editor_sheet.dart';
import '../widgets/staggered_reveal.dart';
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
  String? userBadge;
  String _deptCode = 'CSE';
  String? _currentSemester;
  int _stones = 10;
  int _streak = 0;
  String? _equippedAvatarEmoji;
  String _matchPref = 'anyone';
  String _matchMode = 'campus_adda';

  Timer? _searchCountdownTimer;
  final ValueNotifier<int> _searchCountdownNotifier = ValueNotifier<int>(AppConfig.searchTimeoutSeconds);
  bool _rotationPromptShown = false;
  bool _urlInviteChecked = false;
  bool _socketConnected = false;
  int _onlineUsersCount = 0;
  String _todaysBenchTopic =
      'Aftabnagar street food vs Campus Cafeteria: which spot has the best adda vibes?';
  List<Map<String, dynamic>> _activeCampaigns = [];
  StreamSubscription<AuthState>? _authSub;

  @override
  void initState() {
    super.initState();
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
    _searchCountdownNotifier.dispose();
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

  Future<void> _fetchProfile() async {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) return;

    try {
      final data = await Supabase.instance.client
          .from('users')
          .select(
              'stones_balance, streak_count, gender, match_preference, generated_alias, dept_code, batch_year, semester_intake, alias_change_count')
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
    } catch (_) {}
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

  void _connectSocket() {
    final session = Supabase.instance.client.auth.currentSession;
    if (session == null) return;

    socket = io.io(
      AppConfig.socketUrl,
      io.OptionBuilder()
          .setTransports(['websocket', 'polling'])
          .enableAutoConnect()
          .enableReconnection()
          .setAuth({'token': session.accessToken})
          .build(),
    );

    socket.onConnect((_) {
      if (mounted) setState(() => _socketConnected = true);
    });

    socket.onConnectError((_) {
      if (mounted) setState(() => _socketConnected = false);
    });

    socket.on('connect_timeout', (_) {
      if (mounted) setState(() => _socketConnected = false);
    });

    socket.onDisconnect((_) {
      if (mounted) setState(() => _socketConnected = false);
      final freshToken = Supabase.instance.client.auth.currentSession?.accessToken;
      if (freshToken != null) {
        socket.auth = {'token': freshToken};
      }
    });

    socket.on('campus_pulse', (data) {
      if (mounted && data is Map && data['onlineUsers'] != null) {
        final count = (data['onlineUsers'] as num).toInt();
        if (_onlineUsersCount != count) {
          setState(() => _onlineUsersCount = count);
        }
      }
    });

    socket.on('authenticated', (data) {
      if (mounted) {
        setState(() {
          currentAlias = data['alias'] ?? currentAlias;
          userBadge ??= data['badge'] ?? 'EWU Student';
        });

        if (data['aliasRotationDue'] == true && !_rotationPromptShown) {
          _rotationPromptShown = true;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) {
              showAliasRotationDialog(context, currentAlias: currentAlias, socket: socket);
            }
          });
        }

        _checkUrlInvite();
      }
    });

    socket.on('alias_updated', (data) {
      if (mounted && data?['newAlias'] != null) {
        setState(() => currentAlias = data['newAlias']);
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
                Text('Bench Invite',
                    style: TextStyle(color: Color(0xFF1E1B18), fontSize: 16, fontWeight: FontWeight.w800)),
              ],
            ),
            content: Text(
              data?['message'] ?? 'This bench invite has expired or already ended.',
              style: TextStyle(color: const Color(0xFF1E1B18).withValues(alpha: 0.80), fontSize: 13),
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

    socket.on('campaigns_updated', (_) => _fetchCampusConfig());

    socket.on('match_found', (data) {
      _searchCountdownTimer?.cancel();
      notifyBenchlyEvent(
        '🪑 Bench Match Found!',
        'Paired with ${data['partnerAlias'] ?? 'an EWU classmate'} — say hi!',
        tag: 'match_found',
      );
      if (mounted) {
        setState(() => isSearching = false);
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => ChatRoomScreen(
              socket: socket,
              roomId: data['roomId'],
              myAlias: currentAlias ?? 'Anonymous',
              partnerAlias: data['partnerAlias'] ?? 'Anonymous Student',
              partnerBadge: _badgeWithFit(data['partnerBadge'] ?? 'EWU Student', data['compatibilityScore']),
              initialIcebreaker: data['icebreaker'],
            ),
          ),
        );
      }
    });

    socket.on('session_resumed', (data) {
      _searchCountdownTimer?.cancel();
      if (mounted && data != null && data['roomId'] != null) {
        setState(() => isSearching = false);
        final rawMsgs = (data['messages'] as List?) ?? [];
        final restored = rawMsgs.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => ChatRoomScreen(
              socket: socket,
              roomId: data['roomId'].toString(),
              myAlias: currentAlias ?? 'Anonymous',
              partnerAlias: data['partnerAlias']?.toString() ?? 'Anonymous Student',
              partnerBadge: data['partnerBadge']?.toString() ?? 'EWU Student',
              initialMessages: restored,
              initialTimeLeftSeconds: data['timeLeftSeconds'] is int ? data['timeLeftSeconds'] as int : null,
            ),
          ),
        );
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
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => ChatRoomScreen(
              socket: socket,
              roomId: data['roomId'],
              myAlias: currentAlias ?? 'Anonymous',
              partnerAlias: '☕ $topic',
              partnerBadge: '$count/5 Seated',
              initialIcebreaker: data['icebreaker'],
              isGroupLounge: true,
            ),
          ),
        );
      }
    });

    socket.on('queue_timeout', (data) {
      _searchCountdownTimer?.cancel();
      if (mounted) {
        setState(() => isSearching = false);
        _openTimeoutSheet(data?['message']?.toString());
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

  String _badgeWithFit(dynamic badge, dynamic score) {
    final s = score is num ? score.toInt() : int.tryParse('$score');
    if (s == null) return '$badge';
    final fit = s >= 110 ? 'Great fit' : s >= 85 ? 'Good fit' : 'New face';
    return '$badge · $fit';
  }

  void _openTimeoutSheet([String? customMessage]) {
    showQueueTimeoutBottomSheet(
      context,
      customMessage: customMessage,
      showMatchAnyoneOption: _matchPref != 'anyone',
      onMatchAnyone: () {
        _updateMatchPref('anyone');
        _startSearching();
      },
      onRetrySearch: _startSearching,
    );
  }

  void _startSearching() {
    if (!socket.connected) {
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
    _searchCountdownNotifier.value = AppConfig.searchTimeoutSeconds;
    setState(() => isSearching = true);

    socket.emit('join_1v1_queue', {'seeking': _matchPref, 'mode': _matchMode});

    _searchCountdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_searchCountdownNotifier.value > 1) {
        _searchCountdownNotifier.value--;
      } else {
        timer.cancel();
        _cancelSearching();
        _openTimeoutSheet();
      }
    });
  }

  void _cancelSearching() {
    _searchCountdownTimer?.cancel();
    setState(() => isSearching = false);
    socket.emit('cancel_1v1_queue');
  }

  Future<void> _updateMatchPref(String pref) async {
    setState(() => _matchPref = pref);
    final user = Supabase.instance.client.auth.currentUser;
    if (user != null) {
      await Supabase.instance.client.from('users').update({'match_preference': pref}).eq('id', user.id);
    }
  }

  void _checkUrlInvite() {
    if (_urlInviteChecked) return;
    _urlInviteChecked = true;
    try {
      final inviteParam = Uri.base.queryParameters['invite'];
      if (inviteParam != null && inviteParam.trim().isNotEmpty) {
        final code = inviteParam.trim().toLowerCase();
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            showJoinInviteBenchSheet(
              context,
              code: code,
              onAccept: () => _joinInviteBench(code),
            );
          }
        });
      }
    } catch (_) {}
  }

  void _joinInviteBench(String code) {
    if (!socket.connected) socket.connect();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Joining private bench ${code.toUpperCase()}...'),
        backgroundColor: const Color(0xFF0FB881),
        duration: const Duration(seconds: 2),
      ),
    );
    socket.emit('join_invite_bench', {'code': code});
  }

  @override
  Widget build(BuildContext context) {
    final isMale = (userGender ?? 'male').toLowerCase() == 'male';

    return Scaffold(
      backgroundColor: const Color(0xFFFFF9F0),
      appBar: _buildAppBar(),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 18.0, vertical: 10.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            HomeCampusPulseBanner(
              socketConnected: _socketConnected,
              onlineUsersCount: _onlineUsersCount,
              streak: _streak,
            ),
            HomeAnonymousProfileCard(
              currentAlias: currentAlias,
              equippedAvatarEmoji: _equippedAvatarEmoji,
              isMale: isMale,
              userBadge: userBadge,
              onEditProfile: _openProfileEditor,
            ),
            const SizedBox(height: 22),
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
                        color: const Color(0xFF1E1B18).withValues(alpha: 0.50),
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
                      color: const Color(0xFF1E1B18).withValues(alpha: 0.50),
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
            if (isSearching)
              HomeSearchingRadarCard(
                countdownListenable: _searchCountdownNotifier,
                matchMode: _matchMode,
                onCancel: _cancelSearching,
              )
            else
              StaggeredReveal(
                index: 3,
                child: SpringTap(
                  child: Container(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: const [BoxShadow(color: Color(0xFF1E1B18), offset: Offset(4, 4))],
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
                            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, letterSpacing: -0.2),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            const SizedBox(height: 14),
            HomeInviteFriendCard(
              onTap: () => showInviteFriendBottomSheet(context, socket: socket),
            ),
            const SizedBox(height: 14),
            StaggeredReveal(
              index: 5,
              child: SpringTap(
                onTap: () => showGroupLoungeTopicBottomSheet(context, socket: socket),
                child: OutlinedButton(
                  onPressed: () => showGroupLoungeTopicBottomSheet(context, socket: socket),
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
                        style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: Color(0xFF1E1B18)),
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
                          style: TextStyle(fontSize: 9, fontWeight: FontWeight.w900, color: Color(0xFF0FB881)),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 22),
            HomeTodaysTopicCard(topic: _todaysBenchTopic),
            if (_activeCampaigns.isNotEmpty) ...[
              const SizedBox(height: 14),
              for (final camp in _activeCampaigns)
                HomeCampaignCard(campaign: camp, onClaim: _claimCampaign),
            ],
          ],
        ),
      ),
    );
  }

  PreferredSizeWidget _buildAppBar() {
    return AppBar(
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
              boxShadow: const [BoxShadow(color: Color(0xFF1E1B18), offset: Offset(2, 2))],
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
              boxShadow: const [BoxShadow(color: Color(0xFF1E1B18), offset: Offset(2, 2))],
            ),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.notifications_active_rounded, color: Color(0xFF047857), size: 14),
                SizedBox(width: 4),
                Text(
                  'Alerts / App',
                  style: TextStyle(color: Color(0xFF1E1B18), fontWeight: FontWeight.w800, fontSize: 11.5),
                ),
              ],
            ),
          ),
        ),
        Container(
          margin: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 4),
          decoration: BoxDecoration(
            color: const Color(0xFFFEF3C7),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: const Color(0xFF1E1B18), width: 1.5),
            boxShadow: const [BoxShadow(color: Color(0xFF1E1B18), offset: Offset(2, 2))],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.diamond_rounded, color: Color(0xFFD97706), size: 14),
              const SizedBox(width: 4),
              Text(
                '$_stones',
                style: const TextStyle(color: Color(0xFF1E1B18), fontWeight: FontWeight.w800, fontSize: 12.5),
              ),
            ],
          ),
        ),
        const SizedBox(width: 4),
      ],
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
            color: isActive ? const Color(0xFF6366F1).withValues(alpha: 0.18) : const Color(0xFFFFFFFF),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isActive ? const Color(0xFF6366F1) : const Color(0xFF1E1B18).withValues(alpha: 0.15),
            ),
          ),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
                color: isActive ? const Color(0xFF4F46E5) : const Color(0xFF1E1B18).withValues(alpha: 0.70),
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
            color: isActive ? const Color(0xFF0FB881).withValues(alpha: 0.15) : const Color(0xFFFFFFFF),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isActive ? const Color(0xFF0FB881) : const Color(0xFF1E1B18).withValues(alpha: 0.15),
            ),
          ),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: isActive ? const Color(0xFF0FB881) : const Color(0xFF1E1B18).withValues(alpha: 0.70),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
