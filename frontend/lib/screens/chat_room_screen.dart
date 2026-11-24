import 'dart:async';
import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../algorithms/huffman_engine.dart';
import '../config/app_config.dart';
import '../utils/pwa_notifications.dart';
import '../utils/screenshot_guard.dart';
import '../widgets/chat/chat_chrome.dart';
import '../widgets/chat/chat_message_bubble.dart';
import '../widgets/chat/chat_modals.dart';
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
  late final ValueNotifier<int> _timeLeftNotifier;

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
    final startSec = (widget.initialTimeLeftSeconds != null && widget.initialTimeLeftSeconds! > 0)
        ? widget.initialTimeLeftSeconds!
        : AppConfig.chatDurationSeconds;
    _timeLeftNotifier = ValueNotifier<int>(startSec);

    if (widget.initialMessages != null && widget.initialMessages!.isNotEmpty) {
      for (final raw in widget.initialMessages!) {
        _messages.add(_hydrateIncomingMessage(raw));
      }
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

  /// Automatically decodes incoming Canonical Huffman wire packets (`packedBase64` + `codeLengths`)
  /// once on arrival and caches the reconstructed tree & bitstream for instant UI inspection.
  Map<String, dynamic> _hydrateIncomingMessage(dynamic raw) {
    final map = raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
    if (map['isSystem'] == true) return map;

    final huffmanPacket = HuffmanWirePacket.tryParse(map['huffman']);
    if (huffmanPacket != null) {
      try {
        final decoded = CanonicalHuffmanEngine.decodeLivePacket(huffmanPacket);
        map['content'] = decoded.decodedText;
        map['_decodedHuffman'] = decoded;
        return map;
      } catch (_) {
        map['content'] = map['content']?.toString() ?? '[Corrupted Huffman bitstream]';
        return map;
      }
    }

    // Fallback if a legacy message arrived as plain text: synthesize tree metadata for inspection
    final plain = map['content']?.toString() ?? '';
    if (plain.isNotEmpty) {
      final pkt = CanonicalHuffmanEngine.encodeLivePacket(plain);
      map['_decodedHuffman'] = CanonicalHuffmanEngine.decodeLivePacket(pkt);
    }
    return map;
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
      if (openSheet) {
        showPartnerCardBottomSheet(context, card: card, fallbackAlias: widget.partnerAlias);
      }
    });
  }

  void _setupListeners() {
    _fetchPartnerCard(openSheet: false);
    widget.socket.on('new_message', (data) {
      final hydrated = _hydrateIncomingMessage(data);
      if (hydrated['isMine'] != true && hydrated['isSystem'] != true) {
        final sender = hydrated['authorAlias']?.toString() ?? widget.partnerAlias;
        final text = hydrated['content']?.toString() ?? 'New message';
        notifyBenchlyEvent('💬 $sender', text, tag: 'chat_msg');
      }
      if (mounted) {
        setState(() {
          _partnerTyping = false;
          _messages.add(hydrated);
        });
        _scrollToBottom();
      }
    });

    widget.socket.on('partner_typing', (data) {
      final isTyping = data is Map ? (data['isTyping'] != false) : true;
      if (mounted && _partnerTyping != isTyping) {
        setState(() => _partnerTyping = isTyping);
      }
    });

    widget.socket.on('partner_stopped_typing', (_) {
      if (mounted && _partnerTyping) {
        setState(() => _partnerTyping = false);
      }
    });

    widget.socket.on('guess_reveal_request', (data) {
      if (!mounted || data is! Map) return;
      final revealId = data['revealId']?.toString() ?? '';
      final guesserAlias = data['guesserAlias']?.toString() ?? 'Your partner';
      final fieldLabel = data['fieldLabel']?.toString() ?? 'profile info';
      final actualValue = data['actualValue']?.toString() ?? '';
      if (revealId.isEmpty) return;
      notifyBenchlyEvent(
        '🎯 Partner Guessed Right!',
        '$guesserAlias guessed your $fieldLabel!',
        tag: 'guess_reveal',
      );
      showGuessRevealApprovalDialog(
        context,
        socket: widget.socket,
        revealId: revealId,
        guesserAlias: guesserAlias,
        fieldLabel: fieldLabel,
        actualValue: actualValue,
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
        final addedSec = ((data['minutes'] ?? 15) as num).toInt() * 60;
        _timeLeftNotifier.value += addedSec;
        setState(() => _extensionVoted = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('🎉 Chat extended +15 minutes! Enjoy the adda.'),
            backgroundColor: Color(0xFF0FB881),
          ),
        );
      }
    });

    widget.socket.on('extension_requested_by_partner', (_) {
      notifyBenchlyEvent(
        '⏳ +15m Extension Vote',
        '${widget.partnerAlias} voted to extend the chat!',
        tag: 'extend_vote',
      );
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
      notifyBenchlyEvent(
        '🤝 Handshake Request',
        '${widget.partnerAlias} wants to reveal profiles!',
        tag: 'handshake_req',
      );
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
        showHandshakeCompletedDialog(context, data['message']?.toString() ?? 'Handshake completed!');
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
        final leftAlias = data?['alias']?.toString() ?? widget.partnerAlias;
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
        showPartnerLeftChatDialog(
          context,
          alias: leftAlias,
          onExitToHome: () {
            if (mounted && Navigator.of(context).canPop()) {
              Navigator.of(context).pop();
            }
          },
        );
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

  /// Updates only `_timeLeftNotifier` without triggering full-screen `setState` rebuilds.
  void _startTimer() {
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_timeLeftNotifier.value > 0) {
        _timeLeftNotifier.value--;
      } else {
        timer.cancel();
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
    if (text.runes.length > AppConfig.maxMessageLength) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Message too long. Max 500 characters.')),
      );
      return;
    }

    final packet = CanonicalHuffmanEngine.encodeLivePacket(text);
    widget.socket.emit('send_message', {
      'roomId': widget.roomId,
      'huffman': packet.toJson(),
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
        title: const Text('Leave Conversation?', style: TextStyle(color: Color(0xFF1E1B18), fontSize: 17)),
        content: Text(
          'You will exit this bench session and return to Home.',
          style: TextStyle(color: const Color(0xFF1E1B18).withValues(alpha: 0.70), fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('Stay', style: TextStyle(color: const Color(0xFF1E1B18).withValues(alpha: 0.70))),
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

  @override
  void dispose() {
    ScreenshotGuard.stopListening();
    _timer?.cancel();
    _typingDebounce?.cancel();
    _msgController.dispose();
    _scrollController.dispose();
    _timeLeftNotifier.dispose();
    widget.socket.off('new_message');
    widget.socket.off('partner_typing');
    widget.socket.off('partner_stopped_typing');
    widget.socket.off('guess_reveal_request');
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

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: _partnerLeft || _hasLeft,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _endChatEarly();
      },
      child: MobileContainer(
        child: Scaffold(
          backgroundColor: const Color(0xFFFFF9F0),
          appBar: ChatRoomAppBar(
            partnerAlias: widget.partnerAlias,
            partnerBadge: widget.partnerBadge,
            partnerAvatarEmoji: _partnerCard?['primaryAvatarEmoji']?.toString(),
            isGroupLounge: widget.isGroupLounge,
            partnerReconnecting: _partnerReconnecting,
            partnerTyping: _partnerTyping,
            handshakeCompleted: _handshakeCompleted,
            handshakeSent: _handshakeSent,
            extensionVoted: _extensionVoted,
            timeLeftListenable: _timeLeftNotifier,
            onBack: _endChatEarly,
            onOpenPartnerCard: () {
              if (_partnerCard != null) {
                showPartnerCardBottomSheet(context, card: _partnerCard!, fallbackAlias: widget.partnerAlias);
              } else {
                _fetchPartnerCard(openSheet: true);
              }
            },
            onOpenGuessModal: () => showGuessPartnerModal(
              context,
              socket: widget.socket,
              roomId: widget.roomId,
              partnerAlias: widget.partnerAlias,
            ),
            onRequestHandshake: _requestHandshake,
            onRequestExtension: _requestExtension,
            onReportStudent: () =>
                showReportStudentDialog(context, socket: widget.socket, roomId: widget.roomId),
          ),
          body: Column(
            children: [
              if (!widget.isGroupLounge && !_partnerLeft)
                ChatUrgentExtendBanner(
                  timeLeftListenable: _timeLeftNotifier,
                  extensionVoted: _extensionVoted,
                  onExtend: _requestExtension,
                ),
              const ChatPrivacyBanner(),
              if (_currentIcebreaker != null)
                ChatIcebreakerCard(
                  icebreaker: _currentIcebreaker!,
                  onAsk: () {
                    _sendMessage('💡 ${_currentIcebreaker!}');
                    setState(() => _currentIcebreaker = null);
                  },
                  onDismiss: () => setState(() => _currentIcebreaker = null),
                ),
              Expanded(child: _buildMessagesList()),
              _partnerLeft
                  ? ChatPartnerLeftFooter(
                      partnerLeftAlias: _partnerLeftAlias,
                      onFindNewBench: () => Navigator.pop(context),
                    )
                  : ChatMessageInputBar(
                      controller: _msgController,
                      onChanged: _onTypingChanged,
                      onSend: _sendMessage,
                    ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMessagesList() {
    if (_messages.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF1E1B18).withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.forum_outlined, size: 32, color: Color(0x331E1B18)),
            ),
            const SizedBox(height: 12),
            Text(
              'You\'re seated with an EWU student!',
              style: TextStyle(
                color: const Color(0xFF1E1B18).withValues(alpha: 0.80),
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Messages travel as Canonical Huffman bitstreams + prefix trees.',
              style: TextStyle(color: const Color(0xFF1E1B18).withValues(alpha: 0.45), fontSize: 12),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
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
              decoration: BoxDecoration(color: const Color(0xFFFFFFFF), borderRadius: BorderRadius.circular(16)),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF0FB881)),
                  ),
                  SizedBox(width: 8),
                  Text('Partner is typing...', style: TextStyle(color: Color(0xFF575049), fontSize: 12)),
                ],
              ),
            ),
          );
        }

        return ChatMessageBubble(
          message: _messages[index],
          myAlias: widget.myAlias,
          isGroupLounge: widget.isGroupLounge,
        );
      },
    );
  }
}
