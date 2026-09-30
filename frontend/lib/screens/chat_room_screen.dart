import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'dart:async';
import '../config/app_config.dart';

class ChatRoomScreen extends StatefulWidget {
  final io.Socket socket;
  final String roomId;
  final String myAlias;

  const ChatRoomScreen({
    super.key,
    required this.socket,
    required this.roomId,
    required this.myAlias,
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

  @override
  void initState() {
    super.initState();
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
          const SnackBar(content: Text('Chat session ended.')),
        );
      }
    });

    widget.socket.on('chat_extended', (data) {
      if (mounted) {
        setState(() => _timeLeft += ((data['minutes'] ?? 15) as num).toInt() * 60);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Chat extended! Enjoy the conversation.')),
        );
      }
    });

    widget.socket.on('report_submitted', (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Report submitted. Thank you for keeping Benchly safe.')),
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

  void _sendMessage() {
    final text = _msgController.text.trim();
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
    _msgController.clear();
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
      backgroundColor: const Color(0xFF181920),
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
                    'Report Partner',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'This report is anonymous. Select a reason:',
                    style: TextStyle(
                      fontSize: 13,
                      color: Colors.white.withValues(alpha: 0.5),
                    ),
                  ),
                  const SizedBox(height: 16),
                  ...[
                    'Harassment or bullying',
                    'Sharing personal information',
                    'Inappropriate content',
                    'Spam or flooding',
                    'Other',
                  ].map((reason) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: InkWell(
                      onTap: () => setSheetState(() => selectedReason = reason),
                      borderRadius: BorderRadius.circular(10),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        decoration: BoxDecoration(
                          color: selectedReason == reason
                              ? const Color(0xFFEF4444).withValues(alpha: 0.12)
                              : const Color(0xFF14151C),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                            color: selectedReason == reason
                                ? const Color(0xFFEF4444).withValues(alpha: 0.5)
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
                            fontSize: 14,
                          ),
                        ),
                      ),
                    ),
                  )),
                  const SizedBox(height: 8),
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
                      minimumSize: const Size(double.infinity, 48),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: const Text(
                      'Submit Report',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
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
        backgroundColor: const Color(0xFF181920),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('End Chat?', style: TextStyle(color: Colors.white)),
        content: Text(
          'You will leave this conversation. You can start a new one after the cooldown period.',
          style: TextStyle(color: Colors.white.withValues(alpha: 0.6)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text(
              'Cancel',
              style: TextStyle(color: Colors.white.withValues(alpha: 0.6)),
            ),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              _timer?.cancel();
              Navigator.pop(context);
            },
            child: const Text(
              'End Chat',
              style: TextStyle(
                color: Color(0xFFEF4444),
                fontWeight: FontWeight.w700,
              ),
            ),
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
    widget.socket.off('chat_extended');
    widget.socket.off('report_submitted');
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final minutes = _timeLeft ~/ 60;
    final seconds = (_timeLeft % 60).toString().padLeft(2, '0');
    final isUrgent = _timeLeft < 60;

    return Scaffold(
      backgroundColor: const Color(0xFF0F1015),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0F1015),
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_rounded, size: 20),
          onPressed: _endChatEarly,
        ),
        titleSpacing: 0,
        title: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: const Color(0xFF181920),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(Icons.person_outline_rounded, size: 20, color: Colors.white70),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Anonymous Partner',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.2,
                      color: Colors.white,
                    ),
                  ),
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 200),
                    child: Text(
                      _partnerTyping ? 'typing...' : 'Connected securely',
                      key: ValueKey(_partnerTyping),
                      style: TextStyle(
                        fontSize: 11,
                        color: _partnerTyping
                            ? const Color(0xFF6366F1)
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
          // Countdown Timer Badge
          Container(
            margin: const EdgeInsets.symmetric(vertical: 12, horizontal: 6),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: const Color(0xFF181920),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: isUrgent
                    ? const Color(0xFFEF4444).withValues(alpha: 0.4)
                    : Colors.white.withValues(alpha: 0.08),
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.timer_outlined,
                  size: 14,
                  color: isUrgent ? const Color(0xFFEF4444) : Colors.white70,
                ),
                const SizedBox(width: 5),
                Text(
                  '$minutes:$seconds',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    fontFeatures: const [FontFeature.tabularFigures()],
                    color: isUrgent ? const Color(0xFFEF4444) : Colors.white,
                  ),
                ),
              ],
            ),
          ),
          // More Options Menu
          PopupMenuButton<String>(
            icon: Icon(
              Icons.more_vert_rounded,
              color: Colors.white.withValues(alpha: 0.6),
              size: 20,
            ),
            color: const Color(0xFF1E1F29),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            onSelected: (value) {
              if (value == 'report') _showReportDialog();
              if (value == 'end') _endChatEarly();
            },
            itemBuilder: (context) => [
              PopupMenuItem(
                value: 'report',
                child: Row(
                  children: [
                    Icon(Icons.flag_outlined, size: 18, color: Colors.white.withValues(alpha: 0.7)),
                    const SizedBox(width: 10),
                    const Text('Report', style: TextStyle(color: Colors.white)),
                  ],
                ),
              ),
              PopupMenuItem(
                value: 'end',
                child: Row(
                  children: [
                    const Icon(Icons.exit_to_app_rounded, size: 18, color: Color(0xFFEF4444)),
                    const SizedBox(width: 10),
                    const Text('End Chat', style: TextStyle(color: Color(0xFFEF4444))),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: _messages.isEmpty
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.lock_outline_rounded,
                          size: 28,
                          color: Colors.white.withValues(alpha: 0.15),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          'Say hi! This conversation is fully anonymous.',
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.35),
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ),
                  )
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    itemCount: _messages.length + (_partnerTyping ? 1 : 0),
                    itemBuilder: (context, index) {
                      // Typing indicator bubble at the end
                      if (index == _messages.length && _partnerTyping) {
                        return Align(
                          alignment: Alignment.centerLeft,
                          child: Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
                            decoration: BoxDecoration(
                              color: const Color(0xFF1C1D26),
                              borderRadius: const BorderRadius.only(
                                topLeft: Radius.circular(16),
                                topRight: Radius.circular(16),
                                bottomRight: Radius.circular(16),
                                bottomLeft: Radius.circular(4),
                              ),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                _buildDot(0),
                                const SizedBox(width: 4),
                                _buildDot(1),
                                const SizedBox(width: 4),
                                _buildDot(2),
                              ],
                            ),
                          ),
                        );
                      }

                      final msg = _messages[index];
                      final isMe = msg['authorAlias'] == widget.myAlias;

                      return Align(
                        alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
                        child: Container(
                          constraints: BoxConstraints(
                            maxWidth: MediaQuery.of(context).size.width * 0.75,
                          ),
                          margin: const EdgeInsets.only(bottom: 6),
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
                          decoration: BoxDecoration(
                            color: isMe ? const Color(0xFF6366F1) : const Color(0xFF1C1D26),
                            borderRadius: BorderRadius.only(
                              topLeft: const Radius.circular(16),
                              topRight: const Radius.circular(16),
                              bottomLeft: Radius.circular(isMe ? 16 : 4),
                              bottomRight: Radius.circular(isMe ? 4 : 16),
                            ),
                          ),
                          child: Text(
                            msg['content'] ?? '',
                            style: const TextStyle(
                              fontSize: 15,
                              color: Colors.white,
                              height: 1.35,
                            ),
                          ),
                        ),
                      );
                    },
                  ),
          ),
          // Bottom Input Bar
          Container(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
            decoration: BoxDecoration(
              color: const Color(0xFF0F1015),
              border: Border(
                top: BorderSide(color: Colors.white.withValues(alpha: 0.05)),
              ),
            ),
            child: SafeArea(
              top: false,
              child: Row(
                children: [
                  Expanded(
                    child: Container(
                      decoration: BoxDecoration(
                        color: const Color(0xFF181920),
                        borderRadius: BorderRadius.circular(24),
                        border: Border.all(
                          color: Colors.white.withValues(alpha: 0.06),
                        ),
                      ),
                      child: TextField(
                        controller: _msgController,
                        style: const TextStyle(color: Colors.white, fontSize: 15),
                        maxLength: AppConfig.maxMessageLength,
                        maxLines: 3,
                        minLines: 1,
                        onChanged: _onTypingChanged,
                        decoration: InputDecoration(
                          hintText: 'Type a message...',
                          hintStyle: TextStyle(
                            color: Colors.white.withValues(alpha: 0.35),
                            fontSize: 14,
                          ),
                          counterText: '',
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 20,
                            vertical: 12,
                          ),
                          border: InputBorder.none,
                        ),
                        onSubmitted: (_) => _sendMessage(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(
                    width: 44,
                    height: 44,
                    child: Material(
                      color: const Color(0xFF6366F1),
                      borderRadius: BorderRadius.circular(22),
                      child: InkWell(
                        onTap: _sendMessage,
                        borderRadius: BorderRadius.circular(22),
                        child: const Icon(
                          Icons.arrow_upward_rounded,
                          color: Colors.white,
                          size: 20,
                        ),
                      ),
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

  Widget _buildDot(int index) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.3, end: 1.0),
      duration: Duration(milliseconds: 600 + (index * 200)),
      curve: Curves.easeInOut,
      builder: (context, value, child) {
        return Opacity(
          opacity: value,
          child: Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.5),
              shape: BoxShape.circle,
            ),
          ),
        );
      },
    );
  }
}
