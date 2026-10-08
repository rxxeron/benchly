import 'dart:async';
import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../config/app_config.dart';

class ChatRoomScreen extends StatefulWidget {
  final io.Socket socket;
  final String roomId;
  final String myAlias;
  final String partnerAlias;
  final String partnerBadge;
  final String? initialIcebreaker;

  const ChatRoomScreen({
    super.key,
    required this.socket,
    required this.roomId,
    required this.myAlias,
    this.partnerAlias = 'Anonymous Student',
    this.partnerBadge = 'EWU Student',
    this.initialIcebreaker,
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

  @override
  void initState() {
    super.initState();
    widget.socket.emit('join_room', widget.roomId);
    _currentIcebreaker = widget.initialIcebreaker;
    _startTimer();
    _setupListeners();
  }

  void _setupListeners() {
    widget.socket.on('new_message', (data) {
      if (mounted) {
        setState(() => _messages.add(data));
        _scrollToBottom();
      }
    });

    widget.socket.on('partner_typing', (_) {
      if (mounted) setState(() => _partnerTyping = true);
    });

    widget.socket.on('partner_stopped_typing', (_) {
      if (mounted) setState(() => _partnerTyping = false);
    });

    widget.socket.on('chat_closed', (_) {
      _timer?.cancel();
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Chat session ended. Take a breath on the benches!'),
            backgroundColor: Color(0xFF1E2433),
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
            backgroundColor: Color(0xFF10B981),
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
            backgroundColor: Color(0xFF10B981),
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
        backgroundColor: Color(0xFF10B981),
      ),
    );
  }

  void _showHandshakeSuccessDialog(String message) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF121622),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: const Row(
          children: [
            Icon(Icons.handshake_rounded, color: Color(0xFF10B981), size: 24),
            SizedBox(width: 8),
            Text('Mutual Handshake!', style: TextStyle(color: Colors.white, fontSize: 17)),
          ],
        ),
        content: Text(
          '$message\n\nBoth of you agreed to break anonymity. You can now freely share your department, batch, or Instagram handle in chat.',
          style: TextStyle(color: Colors.white.withValues(alpha: 0.8), fontSize: 13, height: 1.5),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Awesome', style: TextStyle(color: Color(0xFF10B981), fontWeight: FontWeight.bold)),
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
      backgroundColor: const Color(0xFF121622),
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
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Reports are confidential. Messages are retained for 90 days to investigate abuse and maintain a safe campus.',
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.white.withValues(alpha: 0.5),
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
                              : const Color(0xFF181C2A),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                            color: selectedReason == reason
                                ? const Color(0xFFEF4444)
                                : Colors.white.withValues(alpha: 0.06),
                          ),
                        ),
                        child: Text(
                          reason,
                          style: TextStyle(
                            color: selectedReason == reason
                                ? const Color(0xFFEF4444)
                                : Colors.white.withValues(alpha: 0.8),
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
                      disabledBackgroundColor: const Color(0xFF262838),
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

  void _endChatEarly() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF121622),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Leave Conversation?', style: TextStyle(color: Colors.white, fontSize: 17)),
        content: Text(
          'You will exit this bench session. A 30-minute cooldown will apply before entering queue again.',
          style: TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('Stay', style: TextStyle(color: Colors.white.withValues(alpha: 0.6))),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              _timer?.cancel();
              Navigator.pop(context);
            },
            child: const Text('Exit Bench', style: TextStyle(color: Color(0xFFEF4444), fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
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
    widget.socket.off('report_submitted');
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final minutes = _timeLeft ~/ 60;
    final seconds = (_timeLeft % 60).toString().padLeft(2, '0');
    final isUrgent = _timeLeft < 120;
    final isCritical = _timeLeft < 30;

    return Scaffold(
      backgroundColor: const Color(0xFF080A0F),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0E121B),
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_rounded, size: 18),
          onPressed: _endChatEarly,
        ),
        titleSpacing: 0,
        title: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF6366F1), Color(0xFF10B981)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(Icons.person_rounded, size: 20, color: Colors.white),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        widget.partnerAlias,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0xFF10B981).withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: const Color(0xFF10B981).withValues(alpha: 0.3)),
                        ),
                        child: Text(
                          widget.partnerBadge,
                          style: const TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFF10B981),
                          ),
                        ),
                      ),
                    ],
                  ),
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 200),
                    child: Text(
                      _partnerTyping ? 'typing...' : 'Encrypted & Anonymous',
                      key: ValueKey(_partnerTyping),
                      style: TextStyle(
                        fontSize: 11,
                        color: _partnerTyping
                            ? const Color(0xFF10B981)
                            : Colors.white.withValues(alpha: 0.4),
                        fontWeight: _partnerTyping ? FontWeight.w600 : FontWeight.w400,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          // Handshake Button
          IconButton(
            tooltip: 'Request Handshake',
            icon: Icon(
              Icons.handshake_rounded,
              size: 20,
              color: _handshakeCompleted
                  ? const Color(0xFF10B981)
                  : (_handshakeSent ? const Color(0xFFF59E0B) : Colors.white70),
            ),
            onPressed: _handshakeCompleted ? null : _requestHandshake,
          ),

          // Countdown Timer Badge
          Container(
            margin: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: isCritical
                  ? const Color(0xFFEF4444).withValues(alpha: 0.25)
                  : (isUrgent ? const Color(0xFFF59E0B).withValues(alpha: 0.2) : const Color(0xFF181C2A)),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: isCritical
                    ? const Color(0xFFEF4444)
                    : (isUrgent ? const Color(0xFFF59E0B) : Colors.white.withValues(alpha: 0.08)),
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.timer_outlined,
                  size: 13,
                  color: isUrgent ? const Color(0xFFEF4444) : Colors.white70,
                ),
                const SizedBox(width: 4),
                Text(
                  '$minutes:$seconds',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    fontFeatures: const [FontFeature.tabularFigures()],
                    color: isUrgent ? const Color(0xFFEF4444) : Colors.white,
                  ),
                ),
              ],
            ),
          ),

          // Options Menu
          PopupMenuButton<String>(
            icon: Icon(Icons.more_vert_rounded, color: Colors.white.withValues(alpha: 0.7), size: 20),
            color: const Color(0xFF161A26),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            onSelected: (value) {
              if (value == 'extend') _requestExtension();
              if (value == 'handshake') _requestHandshake();
              if (value == 'report') _showReportDialog();
              if (value == 'end') _endChatEarly();
            },
            itemBuilder: (context) => [
              PopupMenuItem(
                value: 'extend',
                child: Row(
                  children: [
                    Icon(Icons.more_time_rounded, size: 18, color: _extensionVoted ? const Color(0xFF10B981) : Colors.white70),
                    const SizedBox(width: 10),
                    Text(_extensionVoted ? 'Extension Voted' : 'Extend (+15m)', style: const TextStyle(color: Colors.white, fontSize: 13)),
                  ],
                ),
              ),
              PopupMenuItem(
                value: 'handshake',
                child: Row(
                  children: [
                    const Icon(Icons.handshake_rounded, size: 18, color: Color(0xFF10B981)),
                    const SizedBox(width: 10),
                    const Text('Shake Hands', style: TextStyle(color: Colors.white, fontSize: 13)),
                  ],
                ),
              ),
              PopupMenuItem(
                value: 'report',
                child: Row(
                  children: [
                    const Icon(Icons.flag_outlined, size: 18, color: Colors.white70),
                    const SizedBox(width: 10),
                    const Text('Report Student', style: TextStyle(color: Colors.white, fontSize: 13)),
                  ],
                ),
              ),
              PopupMenuItem(
                value: 'end',
                child: Row(
                  children: [
                    const Icon(Icons.exit_to_app_rounded, size: 18, color: Color(0xFFEF4444)),
                    const SizedBox(width: 10),
                    const Text('End Chat', style: TextStyle(color: Color(0xFFEF4444), fontSize: 13)),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          // Campus Icebreaker Prompt Card
          if (_currentIcebreaker != null)
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: const Color(0xFF10B981).withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0xFF10B981).withValues(alpha: 0.25)),
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
                            color: const Color(0xFF10B981).withValues(alpha: 0.9),
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          _currentIcebreaker!,
                          style: const TextStyle(fontSize: 12, color: Colors.white, fontWeight: FontWeight.w500),
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
                        color: const Color(0xFF10B981),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Text('Ask', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
                    ),
                  ),
                  const SizedBox(width: 4),
                  IconButton(
                    icon: const Icon(Icons.close, size: 16, color: Colors.white54),
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
                            color: Colors.white.withValues(alpha: 0.03),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.forum_outlined, size: 32, color: Colors.white24),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          'You\'re seated with an EWU student!',
                          style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 14, fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Break the ice or reply to the prompt above.',
                          style: TextStyle(color: Colors.white.withValues(alpha: 0.35), fontSize: 12),
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
                              color: const Color(0xFF141824),
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: const Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF10B981)),
                                ),
                                SizedBox(width: 8),
                                Text('Partner is typing...', style: TextStyle(color: Colors.white54, fontSize: 12)),
                              ],
                            ),
                          ),
                        );
                      }

                      final msg = _messages[index];
                      final isMe = msg['authorAlias'] == widget.myAlias;
                      final isPiiCensored = (msg['content'] as String).contains('[CENSORED');

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
                            color: isMe ? null : const Color(0xFF161A26),
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
                                      : Colors.white.withValues(alpha: 0.05)),
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                msg['content'],
                                style: const TextStyle(color: Colors.white, fontSize: 14, height: 1.3),
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
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),

          // Chat Input Bar
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: const Color(0xFF0E121B),
              border: Border(top: BorderSide(color: Colors.white.withValues(alpha: 0.05))),
            ),
            child: SafeArea(
              child: Row(
                children: [
                  Expanded(
                    child: Container(
                      decoration: BoxDecoration(
                        color: const Color(0xFF161A26),
                        borderRadius: BorderRadius.circular(24),
                        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
                      ),
                      child: TextField(
                        controller: _msgController,
                        onChanged: _onTypingChanged,
                        onSubmitted: (_) => _sendMessage(),
                        style: const TextStyle(color: Colors.white, fontSize: 14),
                        decoration: InputDecoration(
                          hintText: 'Type your message...',
                          hintStyle: TextStyle(color: Colors.white.withValues(alpha: 0.35), fontSize: 14),
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
                        color: Color(0xFF10B981),
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
    );
  }
}
