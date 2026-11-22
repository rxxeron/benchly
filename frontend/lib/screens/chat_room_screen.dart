import 'dart:async';
import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../config/app_config.dart';
import '../utils/screenshot_guard.dart';
import '../widgets/mobile_container.dart';

class ChatRoomScreen extends StatefulWidget {
  final io.Socket socket;
  final String roomId;
  final String myAlias;
  final String partnerAlias;
  final String partnerBadge;
  final String? initialIcebreaker;
  final bool isGroupLounge;
  final List<Map<String, dynamic>>? initialMessages;
  final int? initialTimeLeftSeconds;

  const ChatRoomScreen({
    super.key,
    required this.socket,
    required this.roomId,
    required this.myAlias,
    this.partnerAlias = 'Anonymous Student',
    this.partnerBadge = 'EWU Student',
    this.initialIcebreaker,
    this.isGroupLounge = false,
    this.initialMessages,
    this.initialTimeLeftSeconds,
  });

  @override
  State<ChatRoomScreen> createState() => _ChatRoomScreenState();
}

class _ChatRoomScreenState extends State<ChatRoomScreen> {
  final TextEditingController _msgController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final List<Map<String, dynamic>> _messages = [];

  int _timeLeft = AppConfig.chatDurationSeconds;
  Timer? _timer;
  bool _partnerTyping = false;
  Timer? _typingDebounce;
  String? _currentIcebreaker;
  bool _handshakeSent = false;
  bool _handshakeCompleted = false;
  bool _extensionVoted = false;
  bool _partnerLeft = false;
  bool _partnerReconnecting = false;
  bool _hasLeft = false;
  String? _partnerLeftAlias;
  Map<String, dynamic>? _partnerCard;

  @override
  void initState() {
    super.initState();
    if (widget.initialMessages != null && widget.initialMessages!.isNotEmpty) {
      _messages.addAll(widget.initialMessages!);
    }
    if (widget.initialTimeLeftSeconds != null && widget.initialTimeLeftSeconds! > 0) {
      _timeLeft = widget.initialTimeLeftSeconds!;
    }
    ScreenshotGuard.startListening(onScreenshotDetected: _onScreenshotDetected);
    widget.socket.emit('join_room', widget.roomId);
    _currentIcebreaker = widget.initialIcebreaker;
    _startTimer();
    _setupListeners();
    if (_messages.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
    }
  }

  void _onScreenshotDetected() {
    if (!mounted) return;
    widget.socket.emit('screenshot_taken', widget.roomId);
  }

  void _fetchPartnerCard({bool openSheet = false}) {
    if (widget.isGroupLounge) return;
    widget.socket.emitWithAck('get_partner_card', {'roomId': widget.roomId}, ack: (resp) {
      if (!mounted || resp is! Map || resp['success'] != true || resp['card'] is! Map) return;
      final card = Map<String, dynamic>.from(resp['card'] as Map);
      setState(() => _partnerCard = card);
      if (openSheet) _openPartnerCardSheet(card);
    });
  }

  void _openPartnerCardSheet(Map<String, dynamic> card) {
    final alias = card['alias']?.toString() ?? widget.partnerAlias;
    final chats = (card['successfulChats'] as num?)?.toInt() ?? 0;
    final streak = (card['streakDays'] as num?)?.toInt() ?? 0;
    final hasReports = card['hasReports'] == true;
    final primaryEmoji = card['primaryAvatarEmoji']?.toString();
    final avatars = (card['equippedAvatars'] as List?) ?? [];

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFFFFF9F0),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(22),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Container(
                    width: 58,
                    height: 58,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFFFF6B4A), Color(0xFF0FB881)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFF1E1B18), width: 2),
                      boxShadow: const [BoxShadow(color: Color(0xFF1E1B18), offset: Offset(3, 3))],
                    ),
                    child: Center(
                      child: primaryEmoji != null
                          ? Text(primaryEmoji, style: const TextStyle(fontSize: 28))
                          : const Icon(Icons.person_rounded, color: Colors.white, size: 28),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          alias,
                          style: const TextStyle(
                            color: Color(0xFF1E1B18),
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: const Color(0xFFDCFCE7),
                            borderRadius: BorderRadius.circular(999),
                            border: Border.all(color: const Color(0xFF1E1B18), width: 1.2),
                          ),
                          child: const Text(
                            'Verified EWU Student • Anonymous',
                            style: TextStyle(
                              color: Color(0xFF047857),
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFFFFF),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(0xFF1E1B18), width: 1.5),
                      ),
                      child: Column(
                        children: [
                          Text(
                            '$chats',
                            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Color(0xFF1E1B18)),
                          ),
                          const Text('Successful Chats', style: TextStyle(fontSize: 10.5, color: Color(0xFF575049))),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFFFFF),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(0xFF1E1B18), width: 1.5),
                      ),
                      child: Column(
                        children: [
                          Text(
                            '${streak}d',
                            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Color(0xFFD97706)),
                          ),
                          const Text('Campus Streak', style: TextStyle(fontSize: 10.5, color: Color(0xFF575049))),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: hasReports ? const Color(0xFFFFE4E6) : const Color(0xFFDCFCE7),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(0xFF1E1B18), width: 1.5),
                      ),
                      child: Column(
                        children: [
                          Icon(
                            hasReports ? Icons.warning_amber_rounded : Icons.verified_user_rounded,
                            color: hasReports ? const Color(0xFFE11D48) : const Color(0xFF047857),
                            size: 22,
                          ),
                          const SizedBox(height: 2),
                          Text(
                            hasReports ? 'Reported' : 'No Reports',
                            style: TextStyle(
                              fontSize: 10.5,
                              fontWeight: FontWeight.w800,
                              color: hasReports ? const Color(0xFFE11D48) : const Color(0xFF047857),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
              if (avatars.isNotEmpty) ...[
                const SizedBox(height: 16),
                const Text(
                  'EQUIPPED EWU AVATARS & BADGES',
                  style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, letterSpacing: 1.0, color: Color(0xFF575049)),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: avatars.map((a) {
                    final m = a is Map ? a : {};
                    return Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEF3C7),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFF1E1B18), width: 1.3),
                      ),
                      child: Text(
                        '${m['icon_emoji'] ?? '⭐'} ${m['name'] ?? 'EWU Badge'}',
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF1E1B18)),
                      ),
                    );
                  }).toList(),
                ),
              ],
              const SizedBox(height: 16),
              Text(
                '🔒 Real name, email, and department stay private unless both of you agree to Handshake.',
                style: TextStyle(fontSize: 11.5, color: Color(0xFF1E1B18).withValues(alpha: 0.65)),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _setupListeners() {
    _fetchPartnerCard(openSheet: false);
    widget.socket.on('new_message', (data) {
      if (mounted) {
        setState(() {
          _partnerTyping = false;
          _messages.add(data);
        });
        _scrollToBottom();
      }
    });

    widget.socket.on('partner_typing', (data) {
      final isTyping = data is Map ? (data['isTyping'] != false) : true;
      if (mounted) setState(() => _partnerTyping = isTyping);
    });

    widget.socket.on('partner_stopped_typing', (_) {
      if (mounted) setState(() => _partnerTyping = false);
    });

    widget.socket.on('guess_reveal_request', (data) {
      if (!mounted || data is! Map) return;
      final revealId = data['revealId']?.toString() ?? '';
      final guesserAlias = data['guesserAlias']?.toString() ?? 'Your partner';
      final fieldLabel = data['fieldLabel']?.toString() ?? 'profile info';
      final actualValue = data['actualValue']?.toString() ?? '';
      if (revealId.isEmpty) return;

      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          backgroundColor: const Color(0xFFFFFFFF),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
            side: const BorderSide(color: Color(0xFF1E1B18), width: 1.8),
          ),
          title: const Text(
            '🎯 Partner Guessed Right!',
            style: TextStyle(color: Color(0xFF1E1B18), fontSize: 16, fontWeight: FontWeight.w800),
          ),
          content: Text(
            '$guesserAlias guessed your $fieldLabel ($actualValue)!\n\nDo you want to reveal this to them or keep it private?',
            style: const TextStyle(color: Color(0xFF575049), fontSize: 13.5, height: 1.4),
          ),
          actions: [
            TextButton(
              onPressed: () {
                widget.socket.emit('respond_guess_reveal', {'revealId': revealId, 'approved': false});
                Navigator.pop(ctx);
              },
              child: const Text('Keep Private', style: TextStyle(color: Color(0xFF575049), fontWeight: FontWeight.w700)),
            ),
            ElevatedButton(
              onPressed: () {
                widget.socket.emit('respond_guess_reveal', {'revealId': revealId, 'approved': true});
                Navigator.pop(ctx);
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF0FB881),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              child: const Text('Approve Reveal', style: TextStyle(fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      );
    });

    widget.socket.on('chat_closed', (_) {
      _timer?.cancel();
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Chat session ended. Take a breath on the benches!'),
            backgroundColor: Color(0xFFFFF2DF),
          ),
        );
      }
    });

    widget.socket.on('chat_ending_soon', (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('⏳ 1 minute remaining! Tap extend if you want to keep talking.'),
            backgroundColor: Color(0xFFF59E0B),
            duration: Duration(seconds: 4),
          ),
        );
      }
    });

    widget.socket.on('chat_extended', (data) {
      if (mounted) {
        setState(() {
          _timeLeft += ((data['minutes'] ?? 15) as num).toInt() * 60;
          _extensionVoted = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('🎉 Chat extended +15 minutes! Enjoy the adda.'),
            backgroundColor: Color(0xFF0FB881),
          ),
        );
      }
    });

    widget.socket.on('extension_requested_by_partner', (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('👋 Partner voted to extend +15 min! Tap "Extend" in top menu to agree.'),
            backgroundColor: Color(0xFF6366F1),
            duration: Duration(seconds: 6),
          ),
        );
      }
    });

    widget.socket.on('partner_requested_handshake', (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('🤝 Partner wants to shake hands! Tap Handshake icon to agree.'),
            backgroundColor: Color(0xFF0FB881),
            duration: Duration(seconds: 6),
          ),
        );
      }
    });

    widget.socket.on('handshake_completed', (data) {
      if (mounted) {
        setState(() => _handshakeCompleted = true);
        _showHandshakeSuccessDialog(data['message'] ?? 'Handshake completed!');
      }
    });

    widget.socket.on('partner_reconnecting', (_) {
      if (mounted) setState(() => _partnerReconnecting = true);
    });

    widget.socket.on('partner_reconnected', (_) {
      if (mounted) setState(() => _partnerReconnecting = false);
    });

    widget.socket.on('partner_left', (data) {
      if (mounted && !_partnerLeft) {
        final leftAlias = data?['alias'] ?? widget.partnerAlias;
        setState(() {
          _partnerLeft = true;
          _partnerReconnecting = false;
          _partnerLeftAlias = leftAlias;
          _timer?.cancel();
          _partnerTyping = false;
          _messages.add({
            'id': 'sys_left_${DateTime.now().millisecondsSinceEpoch}',
            'authorAlias': 'System',
            'content': '🚪 $leftAlias has left the bench.',
            'timestamp': DateTime.now().millisecondsSinceEpoch,
            'isSystem': true,
          });
        });
        _scrollToBottom();
        _showPartnerLeftDialog(leftAlias);
      }
    });

    widget.socket.on('report_submitted', (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Report submitted. Benchly logs are retained for investigation.'),
            backgroundColor: Color(0xFFEF4444),
          ),
        );
      }
    });

    widget.socket.on('pii_shield_event', (data) {
      if (mounted) {
        final types = (data?['blockedTypes'] as List?)?.join(', ') ?? 'PII';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('🛡️ Personal info shielded by Benchly ($types). Complete Mutual Handshake first!'),
            backgroundColor: const Color(0xFFF59E0B),
            duration: const Duration(seconds: 3),
          ),
        );
      }
    });

    widget.socket.on('guess_feedback', (data) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(data?['message']?.toString() ?? 'Guess could not be checked.'),
            backgroundColor: const Color(0xFF6366F1),
            duration: const Duration(seconds: 3),
          ),
        );
      }
    });
  }

  void _startTimer() {
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_timeLeft > 0) {
        if (mounted) setState(() => _timeLeft--);
      } else {
        _timer?.cancel();
      }
    });
  }

  void _onTypingChanged(String text) {
    if (text.isNotEmpty) {
      widget.socket.emit('typing', widget.roomId);
    }
    _typingDebounce?.cancel();
    _typingDebounce = Timer(const Duration(seconds: 2), () {
      widget.socket.emit('stop_typing', widget.roomId);
    });
  }

  void _sendMessage([String? overrideText]) {
    final text = (overrideText ?? _msgController.text).trim();
    if (text.isEmpty) return;
    if (text.length > AppConfig.maxMessageLength) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Message too long. Max 500 characters.')),
      );
      return;
    }

    widget.socket.emit('send_message', {
      'roomId': widget.roomId,
      'content': text,
    });
    widget.socket.emit('stop_typing', widget.roomId);
    if (overrideText == null) {
      _msgController.clear();
    }
  }

  void _requestExtension() {
    setState(() => _extensionVoted = true);
    widget.socket.emit('request_extension', widget.roomId);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Extension vote sent. Waiting for partner to agree...'),
        backgroundColor: Color(0xFF6366F1),
      ),
    );
  }

  void _requestHandshake() {
    setState(() => _handshakeSent = true);
    widget.socket.emit('request_handshake', widget.roomId);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('🤝 Handshake request sent! If partner accepts, you can exchange socials.'),
        backgroundColor: Color(0xFF0FB881),
      ),
    );
  }

  void _showHandshakeSuccessDialog(String message) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFFFFFFFF),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: const Row(
          children: [
            Icon(Icons.handshake_rounded, color: Color(0xFF0FB881), size: 24),
            SizedBox(width: 8),
            Text('Mutual Handshake!', style: TextStyle(color: Colors.white, fontSize: 17)),
          ],
        ),
        content: Text(
          '$message\n\nBoth of you agreed to break anonymity. You can now freely share your department, batch, or Instagram handle in chat.',
          style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.85), fontSize: 13, height: 1.5),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Awesome', style: TextStyle(color: Color(0xFF0FB881), fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  void _scrollToBottom() {
    Future.delayed(const Duration(milliseconds: 80), () {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _showReportDialog() {
    String? selectedReason;
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFFFFFFFF),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'Report & Investigation',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF1E1B18),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Reports are confidential. Messages are retained for 90 days to investigate abuse and maintain a safe campus.',
                    style: TextStyle(
                      fontSize: 12,
                      color: Color(0xFF1E1B18).withValues(alpha: 0.60),
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 16),
                  ...[
                    'Harassment or bullying',
                    'Doxxing / Forcing identity disclosure',
                    'Inappropriate sexual content',
                    'Spam or advertising',
                    'Other misconduct',
                  ].map((reason) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: InkWell(
                      onTap: () => setSheetState(() => selectedReason = reason),
                      borderRadius: BorderRadius.circular(10),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        decoration: BoxDecoration(
                          color: selectedReason == reason
                              ? const Color(0xFFEF4444).withValues(alpha: 0.15)
                              : const Color(0xFFFFFFFF),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                            color: selectedReason == reason
                                ? const Color(0xFFEF4444)
                                : Color(0xFF1E1B18).withValues(alpha: 0.15),
                          ),
                        ),
                        child: Text(
                          reason,
                          style: TextStyle(
                            color: selectedReason == reason
                                ? const Color(0xFFEF4444)
                                : Color(0xFF1E1B18).withValues(alpha: 0.85),
                            fontWeight: FontWeight.w500,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ),
                  )),
                  const SizedBox(height: 12),
                  ElevatedButton(
                    onPressed: selectedReason == null
                        ? null
                        : () {
                            widget.socket.emit('report_user', {
                              'roomId': widget.roomId,
                              'reason': selectedReason,
                            });
                            Navigator.pop(ctx);
                          },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFEF4444),
                      foregroundColor: Colors.white,
                      disabledBackgroundColor: const Color(0xFFFFF2DF),
                      minimumSize: const Size(double.infinity, 46),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: const Text('Submit Report', style: TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  void _exitBenchImmediately() {
    _timer?.cancel();
    if (!_partnerLeft && !_hasLeft) {
      _hasLeft = true;
      widget.socket.emit('leave_room', widget.roomId);
    }
    if (mounted && Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
    }
  }

  void _endChatEarly() {
    if (_partnerLeft) {
      _exitBenchImmediately();
      return;
    }
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFFFFFFFF),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Leave Conversation?', style: TextStyle(color: const Color(0xFF1E1B18), fontSize: 17)),
        content: Text(
          'You will exit this bench session and return to Home.',
          style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.70), fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('Stay', style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.70))),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              _exitBenchImmediately();
            },
            child: const Text('Exit Bench', style: TextStyle(color: Color(0xFFEF4444), fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }

  void _showPartnerLeftDialog(String alias) {
    showDialog(
      context: context,
      barrierDismissible: true,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFFFFFFFF),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: const Row(
          children: [
            Text('🚪', style: TextStyle(fontSize: 22)),
            SizedBox(width: 8),
            Text('Partner Left', style: TextStyle(color: const Color(0xFF1E1B18), fontSize: 17, fontWeight: FontWeight.bold)),
          ],
        ),
        content: Text(
          '$alias has left this bench session.',
          style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.85), fontSize: 13, height: 1.4),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('Review Chat', style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.60))),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              Navigator.pop(context);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF0FB881),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: const Text('Find New Bench'),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    ScreenshotGuard.stopListening();
    _timer?.cancel();
    _typingDebounce?.cancel();
    widget.socket.off('new_message');
    widget.socket.off('partner_typing');
    widget.socket.off('partner_stopped_typing');
    widget.socket.off('chat_closed');
    widget.socket.off('chat_ending_soon');
    widget.socket.off('chat_extended');
    widget.socket.off('extension_requested_by_partner');
    widget.socket.off('partner_requested_handshake');
    widget.socket.off('handshake_completed');
    widget.socket.off('partner_left');
    widget.socket.off('partner_reconnecting');
    widget.socket.off('partner_reconnected');
    widget.socket.off('report_submitted');
    widget.socket.off('pii_shield_event');
    widget.socket.off('guess_feedback');
    super.dispose();
  }

  void _showGuessModal() {
    String selectedField = 'dept';
    final guessCtrl = TextEditingController();

    const fieldHints = {
      'dept': 'e.g. CSE, BBA, EEE, English...',
      'current_semester': 'e.g. 6th Sem, 3rd Sem...',
      'admitted_semester': 'e.g. Spring 2023, Fall 2024...',
      'age': 'e.g. 21',
      'real_name': 'e.g. First name or full name',
    };

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFFFFF9F0),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (modalCtx, setModalState) {
          final bottomInset = MediaQuery.of(modalCtx).viewInsets.bottom;
          return SafeArea(
            child: Padding(
              padding: EdgeInsets.fromLTRB(20, 18, 20, 20 + bottomInset),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      const Text('🎯', style: TextStyle(fontSize: 22)),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Guess ${widget.partnerAlias}\'s Vibe',
                              style: const TextStyle(
                                color: const Color(0xFF1E1B18),
                                fontSize: 16,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const Text(
                              'Server checks privately — nothing leaks unless you nail it!',
                              style: TextStyle(color: const Color(0xFF575049), fontSize: 11),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final entry in const [
                        ('dept', '🎓 Dept'),
                        ('current_semester', '📚 Semester'),
                        ('admitted_semester', '🗓️ Admitted'),
                        ('age', '🎂 Age'),
                        ('real_name', '✨ Real Name'),
                      ])
                        ChoiceChip(
                          label: Text(entry.$2),
                          selected: selectedField == entry.$1,
                          selectedColor: const Color(0xFF0FB881).withValues(alpha: 0.25),
                          backgroundColor: const Color(0xFFFFF2DF),
                          labelStyle: TextStyle(
                            color: selectedField == entry.$1 ? const Color(0xFF34D399) : const Color(0xFF44403C),
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                          ),
                          side: BorderSide(
                            color: selectedField == entry.$1
                                ? const Color(0xFF0FB881)
                                : Color(0xFF1E1B18).withValues(alpha: 0.15),
                          ),
                          onSelected: (_) => setModalState(() => selectedField = entry.$1),
                        ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: guessCtrl,
                    keyboardType: selectedField == 'age' ? TextInputType.number : TextInputType.text,
                    style: const TextStyle(color: const Color(0xFF1E1B18), fontSize: 14),
                    decoration: InputDecoration(
                      hintText: fieldHints[selectedField],
                      hintStyle: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.28), fontSize: 13),
                      filled: true,
                      fillColor: const Color(0xFFFFF2DF),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: BorderSide(color: Color(0xFF1E1B18).withValues(alpha: 0.15)),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: BorderSide(color: Color(0xFF1E1B18).withValues(alpha: 0.15)),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: const BorderSide(color: Color(0xFF0FB881)),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  ElevatedButton(
                    onPressed: () {
                      final val = guessCtrl.text.trim();
                      if (val.isEmpty) return;
                      widget.socket.emit('submit_guess', {
                        'roomId': widget.roomId,
                        'field': selectedField,
                        'guess': val,
                      });
                      Navigator.pop(ctx);
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF0FB881),
                      foregroundColor: Colors.white,
                      minimumSize: const Size(double.infinity, 46),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: const Text('Lock In Guess 🎯', style: TextStyle(fontWeight: FontWeight.w800)),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final minutes = _timeLeft ~/ 60;
    final seconds = (_timeLeft % 60).toString().padLeft(2, '0');
    final isUrgent = _timeLeft < 120;
    final isCritical = _timeLeft < 30;

    return PopScope(
      canPop: _partnerLeft || _hasLeft,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) {
          _endChatEarly();
        }
      },
      child: MobileContainer(
        child: Scaffold(
      backgroundColor: const Color(0xFFFFF9F0),
      appBar: AppBar(
        backgroundColor: const Color(0xFFFFF9F0),
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_rounded, size: 18),
          onPressed: _endChatEarly,
        ),
        titleSpacing: 0,
        title: GestureDetector(
          onTap: () {
            if (widget.isGroupLounge) return;
            if (_partnerCard != null) {
              _openPartnerCardSheet(_partnerCard!);
            } else {
              _fetchPartnerCard(openSheet: true);
            }
          },
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
                  child: (_partnerCard?['primaryAvatarEmoji'] != null && !widget.isGroupLounge)
                      ? Text(
                          _partnerCard!['primaryAvatarEmoji'].toString(),
                          style: const TextStyle(fontSize: 18),
                        )
                      : Icon(
                          widget.isGroupLounge ? Icons.groups_rounded : Icons.person_rounded,
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
                          widget.partnerAlias,
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: const Color(0xFF1E1B18),
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
                          widget.partnerBadge,
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
                      _partnerReconnecting
                          ? 'Reconnecting...'
                          : (_partnerTyping
                              ? 'typing...'
                              : (widget.isGroupLounge ? 'Cafeteria Group Lounge' : 'Private & Anonymous')),
                      key: ValueKey('$_partnerReconnecting-$_partnerTyping'),
                      style: TextStyle(
                        fontSize: 11,
                        color: _partnerReconnecting
                            ? const Color(0xFFF59E0B)
                            : (_partnerTyping
                                ? const Color(0xFF0FB881)
                                : Color(0xFF1E1B18).withValues(alpha: 0.50)),
                        fontWeight: (_partnerTyping || _partnerReconnecting) ? FontWeight.w600 : FontWeight.w400,
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
          if (!widget.isGroupLounge) ...[
            IconButton(
              tooltip: 'Guess partner\'s vibe',
              icon: const Icon(Icons.psychology_alt_rounded, size: 20, color: Color(0xFF818CF8)),
              onPressed: _showGuessModal,
            ),
            // Handshake Button (1v1 only)
            IconButton(
              tooltip: 'Request Handshake',
              icon: Icon(
                Icons.handshake_rounded,
                size: 20,
                color: _handshakeCompleted
                    ? const Color(0xFF0FB881)
                    : (_handshakeSent ? const Color(0xFFF59E0B) : const Color(0xFF44403C)),
              ),
              onPressed: _handshakeCompleted ? null : _requestHandshake,
            ),
            // Countdown Timer Badge (1v1 only)
            Container(
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
                      : (isUrgent ? const Color(0xFFF59E0B) : Color(0xFF1E1B18).withValues(alpha: 0.15)),
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
            ),
          ],

          // Options Menu (no duplicate Handshake item)
          PopupMenuButton<String>(
            icon: Icon(Icons.more_vert_rounded, color: Color(0xFF1E1B18).withValues(alpha: 0.80), size: 20),
            color: const Color(0xFFFFFFFF),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            onSelected: (value) {
              if (value == 'extend') _requestExtension();
              if (value == 'report') _showReportDialog();
              if (value == 'end') _endChatEarly();
            },
            itemBuilder: (context) => [
              if (!widget.isGroupLounge)
                PopupMenuItem(
                  value: 'extend',
                  child: Row(
                    children: [
                      Icon(Icons.more_time_rounded, size: 18, color: _extensionVoted ? const Color(0xFF0FB881) : const Color(0xFF44403C)),
                      const SizedBox(width: 10),
                      Text(_extensionVoted ? 'Extension Voted' : 'Extend (+15m)', style: const TextStyle(color: const Color(0xFF1E1B18), fontSize: 13)),
                    ],
                  ),
                ),
              const PopupMenuItem(
                value: 'report',
                child: Row(
                  children: [
                    Icon(Icons.flag_outlined, size: 18, color: const Color(0xFF44403C)),
                    SizedBox(width: 10),
                    Text('Report Student', style: TextStyle(color: const Color(0xFF1E1B18), fontSize: 13)),
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
      ),
      body: Column(
        children: [
          // Inline 1-tap Extend Banner during final 2 minutes (1v1 only)
          if (isUrgent && !widget.isGroupLounge && !_partnerLeft)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFFF59E0B).withValues(alpha: 0.14),
                border: Border(
                  bottom: BorderSide(color: const Color(0xFFF59E0B).withValues(alpha: 0.3)),
                ),
              ),
              child: Row(
                children: [
                  const Icon(Icons.hourglass_bottom_rounded, size: 15, color: Color(0xFFF59E0B)),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _extensionVoted
                          ? 'Waiting for partner to agree to +15m...'
                          : 'Ending soon ($minutes:$seconds left). Want to keep talking?',
                      style: const TextStyle(color: Color(0xFFFDE68A), fontSize: 11.5, fontWeight: FontWeight.w600),
                    ),
                  ),
                  if (!_extensionVoted)
                    InkWell(
                      onTap: _requestExtension,
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
            ),
          // Always-visible Precautionary Privacy Notice
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(
              color: const Color(0xFFFEF3C7),
              border: Border(
                bottom: BorderSide(color: Color(0xFF1E1B18).withValues(alpha: 0.15)),
              ),
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
                      color: Color(0xFF1E1B18).withValues(alpha: 0.82),
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ],
            ),
          ),

          // Campus Icebreaker Prompt Card
          if (_currentIcebreaker != null)
            Container(
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
                          _currentIcebreaker!,
                          style: const TextStyle(fontSize: 12.5, color: Color(0xFF1E1B18), fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 6),
                  InkWell(
                    onTap: () {
                      _sendMessage('💡 ${_currentIcebreaker!}');
                      setState(() => _currentIcebreaker = null);
                    },
                    borderRadius: BorderRadius.circular(8),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: const Color(0xFF0FB881),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Text('Ask', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
                    ),
                  ),
                  const SizedBox(width: 4),
                  IconButton(
                    icon: const Icon(Icons.close, size: 16, color: const Color(0xFF575049)),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                    onPressed: () => setState(() => _currentIcebreaker = null),
                  ),
                ],
              ),
            ),

          // Messages View
          Expanded(
            child: _messages.isEmpty
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: Color(0xFF1E1B18).withValues(alpha: 0.15),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.forum_outlined, size: 32, color: const Color(0x331E1B18)),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          'You\'re seated with an EWU student!',
                          style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.80), fontSize: 14, fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Break the ice or reply to the prompt above.',
                          style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.28), fontSize: 12),
                        ),
                      ],
                    ),
                  )
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    itemCount: _messages.length + (_partnerTyping ? 1 : 0),
                    itemBuilder: (context, index) {
                      if (index == _messages.length && _partnerTyping) {
                        return Align(
                          alignment: Alignment.centerLeft,
                          child: Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            decoration: BoxDecoration(
                              color: const Color(0xFFFFFFFF),
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: const Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF0FB881)),
                                ),
                                SizedBox(width: 8),
                                Text('Partner is typing...', style: TextStyle(color: const Color(0xFF575049), fontSize: 12)),
                              ],
                            ),
                          ),
                        );
                      }

                      final msg = _messages[index];
                      if (msg['isSystem'] == true) {
                        final isGuessHit = msg['isGuessHit'] == true;
                        final isGuessMsg = (msg['content'] ?? '').toString().startsWith('🎲');
                        final accent = isGuessHit
                            ? const Color(0xFF0FB881)
                            : (isGuessMsg ? const Color(0xFF6366F1) : const Color(0xFFEF4444));
                        final textCol = isGuessHit
                            ? const Color(0xFF047857)
                            : (isGuessMsg ? const Color(0xFFC7D2FE) : const Color(0xFFFCA5A5));
                        return Center(
                          child: Container(
                            margin: const EdgeInsets.symmetric(vertical: 10),
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                            decoration: BoxDecoration(
                              color: accent.withValues(alpha: 0.14),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: accent.withValues(alpha: 0.3),
                              ),
                            ),
                            child: Text(
                              msg['content'] ?? '',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: textCol,
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        );
                      }

                      final isMe = msg['isMine'] == true ||
                          (msg['isMine'] == null && msg['authorAlias'] == widget.myAlias);
                      final contentStr = (msg['content'] ?? '').toString();
                      final isPiiCensored = contentStr.contains('[CENSORED') || contentStr.contains('ALGO-SHIELD');
                      final rawTs = msg['timestamp'];
                      String timeLabel = '';
                      if (rawTs is int) {
                        final dt = DateTime.fromMillisecondsSinceEpoch(rawTs).toLocal();
                        timeLabel = '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
                      }

                      return Align(
                        alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
                        child: Container(
                          margin: const EdgeInsets.only(bottom: 8),
                          constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.76),
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          decoration: BoxDecoration(
                            gradient: isMe
                                ? const LinearGradient(
                                    colors: [Color(0xFF6366F1), Color(0xFF4F46E5)],
                                    begin: Alignment.topLeft,
                                    end: Alignment.bottomRight,
                                  )
                                : null,
                            color: isMe ? null : const Color(0xFFFFFFFF),
                            borderRadius: BorderRadius.only(
                              topLeft: const Radius.circular(16),
                              topRight: const Radius.circular(16),
                              bottomLeft: isMe ? const Radius.circular(16) : const Radius.circular(4),
                              bottomRight: isMe ? const Radius.circular(4) : const Radius.circular(16),
                            ),
                            border: Border.all(
                              color: isMe
                                  ? Colors.transparent
                                  : (isPiiCensored
                                      ? const Color(0xFFF59E0B).withValues(alpha: 0.3)
                                      : Color(0xFF1E1B18).withValues(alpha: 0.15)),
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (widget.isGroupLounge && !isMe)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 3),
                                  child: Text(
                                    msg['authorAlias']?.toString() ?? 'EWU Student',
                                    style: const TextStyle(
                                      color: Color(0xFF34D399),
                                      fontSize: 10.5,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ),
                              Text(
                                contentStr,
                                style: TextStyle(
                                  color: isMe ? Colors.white : const Color(0xFF1E1B18),
                                  fontSize: 14,
                                  height: 1.35,
                                ),
                              ),
                              if (isPiiCensored)
                                Padding(
                                  padding: const EdgeInsets.only(top: 4),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Icon(Icons.shield_outlined, size: 11, color: Color(0xFFF59E0B)),
                                      const SizedBox(width: 4),
                                      Text(
                                        'PII shielded by Benchly',
                                        style: TextStyle(
                                          fontSize: 10,
                                          color: const Color(0xFFF59E0B).withValues(alpha: 0.9),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              if (timeLabel.isNotEmpty)
                                Padding(
                                  padding: const EdgeInsets.only(top: 4),
                                  child: Text(
                                    timeLabel,
                                    style: TextStyle(
                                      fontSize: 9.5,
                                      color: Colors.white.withValues(alpha: isMe ? 0.65 : 0.35),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),

          // Chat Input Bar or Partner Left Banner
          if (_partnerLeft)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF9F0),
                border: Border(top: BorderSide(color: Color(0xFF1E1B18).withValues(alpha: 0.15))),
              ),
              child: SafeArea(
                child: Row(
                  children: [
                    Expanded(
                      child: ElevatedButton.icon(
                        onPressed: () => Navigator.pop(context),
                        icon: const Icon(Icons.arrow_back_rounded, size: 18),
                        label: Text(
                          '${_partnerLeftAlias ?? "Partner"} Left • Find New Bench',
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
                  ],
                ),
              ),
            )
          else
            Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: const Color(0xFFFFF9F0),
              border: Border(top: BorderSide(color: Color(0xFF1E1B18).withValues(alpha: 0.15))),
            ),
            child: SafeArea(
              child: Row(
                children: [
                  Expanded(
                    child: Container(
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFFFFF),
                        borderRadius: BorderRadius.circular(24),
                        border: Border.all(color: Color(0xFF1E1B18).withValues(alpha: 0.15)),
                      ),
                      child: TextField(
                        controller: _msgController,
                        onChanged: _onTypingChanged,
                        onSubmitted: (_) => _sendMessage(),
                        style: const TextStyle(color: const Color(0xFF1E1B18), fontSize: 14),
                        decoration: InputDecoration(
                          hintText: 'Type your message...',
                          hintStyle: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.28), fontSize: 14),
                          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          border: InputBorder.none,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  InkWell(
                    onTap: _sendMessage,
                    borderRadius: BorderRadius.circular(24),
                    child: Container(
                      width: 44,
                      height: 44,
                      decoration: const BoxDecoration(
                        color: Color(0xFF0FB881),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.send_rounded, color: Colors.white, size: 20),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    ),
      ),
    );
  }
}
