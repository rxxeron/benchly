import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:url_launcher/url_launcher.dart';
import '../staggered_reveal.dart';

void showQueueTimeoutBottomSheet(
  BuildContext context, {
  String? customMessage,
  required bool showMatchAnyoneOption,
  required VoidCallback onMatchAnyone,
  required VoidCallback onRetrySearch,
}) {
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
                color: Color(0xFF1E1B18),
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
                color: const Color(0xFF1E1B18).withValues(alpha: 0.70),
                fontSize: 13,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 24),
            if (showMatchAnyoneOption) ...[
              ElevatedButton(
                onPressed: () {
                  Navigator.pop(ctx);
                  onMatchAnyone();
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
                onRetrySearch();
              },
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFF1E1B18),
                side: BorderSide(color: const Color(0xFF1E1B18).withValues(alpha: 0.28)),
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
                  color: const Color(0xFF1E1B18).withValues(alpha: 0.50),
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

void showAliasRotationDialog(
  BuildContext context, {
  required String? currentAlias,
  required io.Socket socket,
}) {
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
            style: TextStyle(color: const Color(0xFF1E1B18).withValues(alpha: 0.85), fontSize: 13, height: 1.4),
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
              style: TextStyle(color: Color(0xFF047857), fontSize: 11),
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
          child: Text('Auto-Rotate Now', style: TextStyle(color: const Color(0xFF1E1B18).withValues(alpha: 0.70))),
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

void showJoinInviteBenchSheet(
  BuildContext context, {
  required String code,
  required VoidCallback onAccept,
}) {
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
                color: const Color(0xFF1E1B18).withValues(alpha: 0.80),
                fontSize: 13,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 22),
            ElevatedButton(
              onPressed: () {
                Navigator.pop(ctx);
                onAccept();
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
                style: TextStyle(color: const Color(0xFF1E1B18).withValues(alpha: 0.50), fontSize: 13),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

void showInviteFriendBottomSheet(BuildContext context, {required io.Socket socket}) {
  if (!socket.connected) {
    socket.connect();
  }
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFFFFF9F0),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (_) => _InviteFriendSheet(socket: socket),
  );
}

class _InviteFriendSheet extends StatefulWidget {
  final io.Socket socket;

  const _InviteFriendSheet({required this.socket});

  @override
  State<_InviteFriendSheet> createState() => _InviteFriendSheetState();
}

class _InviteFriendSheetState extends State<_InviteFriendSheet> {
  String? _generatedCode;
  String? _generatedUrl;
  bool _isGenerating = true;

  void _onInviteCreated(dynamic data) {
    if (!mounted || data is! Map) return;
    setState(() {
      _generatedCode = data['code']?.toString();
      _generatedUrl = data['inviteUrl']?.toString() ??
          'https://app.benchly.live/?invite=${data['code']}';
      _isGenerating = false;
    });
  }

  @override
  void initState() {
    super.initState();
    widget.socket.once('invite_bench_created', _onInviteCreated);
    widget.socket.emit('create_invite_bench');
  }

  @override
  void dispose() {
    widget.socket.off('invite_bench_created', _onInviteCreated);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final url = _generatedUrl ??
        (_generatedCode != null ? 'https://app.benchly.live/?invite=$_generatedCode' : '');

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
                  color: const Color(0xFF1E1B18).withValues(alpha: 0.28),
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
                    gradient: const LinearGradient(colors: [Color(0xFF6366F1), Color(0xFF0FB881)]),
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
                          color: Color(0xFF1E1B18),
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
            if (_isGenerating)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 36),
                child: Column(
                  children: [
                    CircularProgressIndicator(color: Color(0xFF0FB881), strokeWidth: 2.5),
                    SizedBox(height: 14),
                    Text(
                      'Generating your private short link...',
                      style: TextStyle(color: Color(0xFF44403C), fontSize: 13),
                    ),
                  ],
                ),
              )
            else ...[
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
                        final messenger = ScaffoldMessenger.of(context);
                        final text = Uri.encodeComponent(
                          'Hey! Sit with me on Benchly for an adda: $url',
                        );
                        final waUri = Uri.parse('https://wa.me/?text=$text');
                        if (await canLaunchUrl(waUri)) {
                          await launchUrl(waUri, mode: LaunchMode.externalApplication);
                        } else {
                          Clipboard.setData(ClipboardData(text: url));
                          if (mounted) {
                            messenger.showSnackBar(
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
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFFFFF),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFF1E1B18).withValues(alpha: 0.15)),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: const BoxDecoration(color: Color(0xFF0FB881), shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Bench is waiting for your friend to open the link. Once they join, this screen will automatically open the chat!',
                        style: TextStyle(
                          color: const Color(0xFF1E1B18).withValues(alpha: 0.75),
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
  }
}

void showGroupLoungeTopicBottomSheet(BuildContext context, {required io.Socket socket}) {
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
                color: Color(0xFF1E1B18),
                fontSize: 17,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Pick a live campus lounge topic. Up to 5 EWU classmates sit together anonymously!',
              style: TextStyle(color: const Color(0xFF1E1B18).withValues(alpha: 0.70), fontSize: 12),
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
                                    color: Color(0xFF1E1B18),
                                    fontWeight: FontWeight.w700,
                                    fontSize: 13.5,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  t['desc']!,
                                  style: TextStyle(
                                    color: const Color(0xFF1E1B18).withValues(alpha: 0.65),
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
