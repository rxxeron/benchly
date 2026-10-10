import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../config/app_config.dart';
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
  int _stones = 10;
  int _streak = 0;
  String _matchPref = 'anyone'; // 'male', 'female', 'anyone'
  late AnimationController _radarController;

  Timer? _searchCountdownTimer;
  int _searchCountdown = 35;
  bool _rotationPromptShown = false;
  bool _urlInviteChecked = false;

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
    _searchCountdownTimer?.cancel();
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

    debugPrint('🔌 [Socket] Connecting to ${AppConfig.socketUrl} with token: ${session.accessToken.substring(0, 15)}...');

    socket = io.io(AppConfig.socketUrl, io.OptionBuilder()
        .setTransports(['websocket', 'polling'])
        .enableAutoConnect()
        .enableReconnection()
        .setAuth({'token': session.accessToken})
        .build());

    socket.onConnect((_) {
      debugPrint('🟢 [Socket] Connected! socket.id=${socket.id}');
    });

    socket.onConnectError((err) {
      debugPrint('🔴 [Socket] Connect Error: $err');
    });

    socket.on('connect_timeout', (data) {
      debugPrint('⏰ [Socket] Connect Timeout: $data');
    });

    socket.onError((err) {
      debugPrint('🔴 [Socket] Error: $err');
    });

    socket.onDisconnect((reason) {
      debugPrint('⚠️ [Socket] Disconnected: $reason');
    });

    socket.on('authenticated', (data) {
      debugPrint('🎉 [Socket] Authenticated: $data');
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
            backgroundColor: const Color(0xFF10B981),
          ),
        );
      }
    });

    socket.on('invite_error', (data) {
      if (mounted) {
        showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: const Color(0xFF121622),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
            title: const Row(
              children: [
                Icon(Icons.info_outline_rounded, color: Color(0xFFEF4444), size: 20),
                SizedBox(width: 8),
                Text('Bench Invite', style: TextStyle(color: Colors.white, fontSize: 16)),
              ],
            ),
            content: Text(
              data?['message'] ?? 'This bench invite has expired or already ended.',
              style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 13),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('OK', style: TextStyle(color: Color(0xFF10B981))),
              ),
            ],
          ),
        );
      }
    });

    socket.on('match_found', (data) {
      _searchCountdownTimer?.cancel();
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
      _searchCountdown = 35;
    });

    socket.emit('join_1v1_queue', {'seeking': _matchPref});
    debugPrint('🚀 Emitted join_1v1_queue with seeking=$_matchPref');

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
      backgroundColor: const Color(0xFF10141E),
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
                  color: Colors.white,
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
                  color: Colors.white.withValues(alpha: 0.6),
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
                    backgroundColor: const Color(0xFF10B981),
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
                  foregroundColor: Colors.white,
                  side: BorderSide(color: Colors.white.withValues(alpha: 0.15)),
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
                    color: Colors.white.withValues(alpha: 0.4),
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
        backgroundColor: const Color(0xFF121622),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Row(
          children: [
            Text('⏳', style: TextStyle(fontSize: 22)),
            SizedBox(width: 8),
            Text(
              '15-Day Alias Rotation',
              style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Your alias "$currentAlias" is 15+ days old. To ensure complete privacy and anonymity, Benchly rotates nicknames every 15 days.',
              style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 13, height: 1.4),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF10B981).withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFF10B981).withValues(alpha: 0.25)),
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
            child: Text('Auto-Rotate Now', style: TextStyle(color: Colors.white.withValues(alpha: 0.6))),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              socket.emit('rotate_alias', {'changeType': 'manual'});
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF10B981),
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
      backgroundColor: const Color(0xFF10141E),
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
                    color: const Color(0xFF10B981).withValues(alpha: 0.15),
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: const Color(0xFF10B981).withValues(alpha: 0.3),
                      width: 1.5,
                    ),
                  ),
                  child: const Center(
                    child: Icon(Icons.chair_rounded, color: Color(0xFF10B981), size: 28),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Private Bench Invitation',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white,
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
                  color: Colors.white.withValues(alpha: 0.7),
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
                  backgroundColor: const Color(0xFF10B981),
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
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 13),
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
        backgroundColor: const Color(0xFF10B981),
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
      backgroundColor: const Color(0xFF10141E),
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
                    generatedUrl = data['inviteUrl'] ?? 'https://benchly.live/b/${data['code']}';
                    isGenerating = false;
                  });
                }
              }

              socket.once('invite_bench_created', onCreated);
              socket.emit('create_invite_bench');
            }

            final url = generatedUrl ?? (generatedCode != null ? 'https://benchly.live/b/$generatedCode' : '');

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
                          color: Colors.white.withValues(alpha: 0.2),
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
                              colors: [Color(0xFF6366F1), Color(0xFF10B981)],
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
                                  color: Colors.white,
                                  fontSize: 17,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: -0.3,
                                ),
                              ),
                              SizedBox(height: 2),
                              Text(
                                'Bring a friend for a 15-min adda • Earn +5 Stones',
                                style: TextStyle(
                                  color: Color(0xFF10B981),
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
                            CircularProgressIndicator(color: Color(0xFF10B981), strokeWidth: 2.5),
                            SizedBox(height: 14),
                            Text(
                              'Generating your private short link...',
                              style: TextStyle(color: Colors.white70, fontSize: 13),
                            ),
                          ],
                        ),
                      )
                    else ...[
                      // Link Display Box
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        decoration: BoxDecoration(
                          color: const Color(0xFF141824),
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
                                  color: Colors.white,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            IconButton(
                              tooltip: 'Copy Link',
                              icon: const Icon(Icons.copy_rounded, color: Color(0xFF10B981), size: 18),
                              onPressed: () {
                                Clipboard.setData(ClipboardData(text: url));
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text('Short link copied! Share with your friend.'),
                                    backgroundColor: Color(0xFF10B981),
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
                                    backgroundColor: Color(0xFF10B981),
                                  ),
                                );
                              },
                              icon: const Icon(Icons.copy_rounded, size: 16),
                              label: const Text('Copy Link'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFF141824),
                                foregroundColor: Colors.white,
                                elevation: 0,
                                minimumSize: const Size(0, 46),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  side: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
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
                                        backgroundColor: Color(0xFF10B981),
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
                          color: const Color(0xFF121622),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: Colors.white.withValues(alpha: 0.05)),
                        ),
                        child: Row(
                          children: [
                            Container(
                              width: 8,
                              height: 8,
                              decoration: const BoxDecoration(
                                color: Color(0xFF10B981),
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                'Bench is waiting for your friend to open the link. Once they join, this screen will automatically open the chat!',
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.65),
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

            // Invite Friend Direct Bench Card
            Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    const Color(0xFF6366F1).withValues(alpha: 0.15),
                    const Color(0xFF10B981).withValues(alpha: 0.12),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFF6366F1).withValues(alpha: 0.3)),
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
                                      color: Colors.white,
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
                                  color: Colors.white.withValues(alpha: 0.6),
                                  fontSize: 11,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Icon(Icons.arrow_forward_ios_rounded, size: 14, color: Colors.white.withValues(alpha: 0.4)),
                      ],
                    ),
                  ),
                ),
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
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text(
                'Scanning the EWU benches...',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: const Color(0xFF10B981).withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: const Color(0xFF10B981).withValues(alpha: 0.3),
                  ),
                ),
                child: Text(
                  '${_searchCountdown}s',
                  style: const TextStyle(
                    color: Color(0xFF10B981),
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            _searchCountdown > 15
                ? 'Looking for another student in queue (~10-20s)'
                : 'Benches quiet right now... checking other batches...',
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
