import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

void showPartnerCardBottomSheet(
  BuildContext context, {
  required Map<String, dynamic> card,
  required String fallbackAlias,
}) {
  final alias = card['alias']?.toString() ?? fallbackAlias;
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
                style: TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.0,
                  color: Color(0xFF575049),
                ),
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
              style: TextStyle(fontSize: 11.5, color: const Color(0xFF1E1B18).withValues(alpha: 0.65)),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    ),
  );
}

void showGuessPartnerModal(
  BuildContext context, {
  required io.Socket socket,
  required String roomId,
  required String partnerAlias,
}) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFFFFF9F0),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
    ),
    builder: (_) => _GuessPartnerSheet(
      socket: socket,
      roomId: roomId,
      partnerAlias: partnerAlias,
    ),
  );
}

class _GuessPartnerSheet extends StatefulWidget {
  final io.Socket socket;
  final String roomId;
  final String partnerAlias;

  const _GuessPartnerSheet({
    required this.socket,
    required this.roomId,
    required this.partnerAlias,
  });

  @override
  State<_GuessPartnerSheet> createState() => _GuessPartnerSheetState();
}

class _GuessPartnerSheetState extends State<_GuessPartnerSheet> {
  String _selectedField = 'dept';
  final TextEditingController _guessCtrl = TextEditingController();

  static const _fieldHints = {
    'dept': 'e.g. CSE, BBA, EEE, English...',
    'current_semester': 'e.g. 6th Sem, 3rd Sem...',
    'admitted_semester': 'e.g. Spring 2023, Fall 2024...',
    'age': 'e.g. 21',
    'real_name': 'e.g. First name or full name',
  };

  @override
  void dispose() {
    _guessCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
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
                          color: Color(0xFF1E1B18),
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const Text(
                        'Server checks privately — nothing leaks unless you nail it!',
                        style: TextStyle(color: Color(0xFF575049), fontSize: 11),
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
                    selected: _selectedField == entry.$1,
                    selectedColor: const Color(0xFF0FB881).withValues(alpha: 0.25),
                    backgroundColor: const Color(0xFFFFF2DF),
                    labelStyle: TextStyle(
                      color: _selectedField == entry.$1 ? const Color(0xFF047857) : const Color(0xFF44403C),
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                    side: BorderSide(
                      color: _selectedField == entry.$1
                          ? const Color(0xFF0FB881)
                          : const Color(0xFF1E1B18).withValues(alpha: 0.15),
                    ),
                    onSelected: (_) => setState(() => _selectedField = entry.$1),
                  ),
              ],
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _guessCtrl,
              keyboardType: _selectedField == 'age' ? TextInputType.number : TextInputType.text,
              style: const TextStyle(color: Color(0xFF1E1B18), fontSize: 14),
              decoration: InputDecoration(
                hintText: _fieldHints[_selectedField],
                hintStyle: TextStyle(color: const Color(0xFF1E1B18).withValues(alpha: 0.28), fontSize: 13),
                filled: true,
                fillColor: const Color(0xFFFFF2DF),
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: const Color(0xFF1E1B18).withValues(alpha: 0.15)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: const Color(0xFF1E1B18).withValues(alpha: 0.15)),
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
                final val = _guessCtrl.text.trim();
                if (val.isEmpty) return;
                widget.socket.emit('submit_guess', {
                  'roomId': widget.roomId,
                  'field': _selectedField,
                  'guess': val,
                });
                Navigator.pop(context);
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
  }
}

void showReportStudentDialog(
  BuildContext context, {
  required io.Socket socket,
  required String roomId,
}) {
  String? selectedReason;
  showModalBottomSheet(
    context: context,
    backgroundColor: const Color(0xFFFFFFFF),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (ctx) => StatefulBuilder(
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
                  color: Color(0xFF1E1B18),
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Reports are confidential. Messages are retained for 90 days to investigate abuse and maintain a safe campus.',
                style: TextStyle(
                  fontSize: 12,
                  color: const Color(0xFF1E1B18).withValues(alpha: 0.60),
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
                                : const Color(0xFF1E1B18).withValues(alpha: 0.15),
                          ),
                        ),
                        child: Text(
                          reason,
                          style: TextStyle(
                            color: selectedReason == reason
                                ? const Color(0xFFEF4444)
                                : const Color(0xFF1E1B18).withValues(alpha: 0.85),
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
                        socket.emit('report_user', {
                          'roomId': roomId,
                          'reason': selectedReason,
                        });
                        Navigator.pop(ctx);
                      },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFEF4444),
                  foregroundColor: Colors.white,
                  disabledBackgroundColor: const Color(0xFFFFF2DF),
                  minimumSize: const Size(double.infinity, 46),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: const Text('Submit Report', style: TextStyle(fontWeight: FontWeight.w700)),
              ),
            ],
          ),
        );
      },
    ),
  );
}

void showGuessRevealApprovalDialog(
  BuildContext context, {
  required io.Socket socket,
  required String revealId,
  required String guesserAlias,
  required String fieldLabel,
  required String actualValue,
}) {
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
            socket.emit('respond_guess_reveal', {'revealId': revealId, 'approved': false});
            Navigator.pop(ctx);
          },
          child: const Text('Keep Private', style: TextStyle(color: Color(0xFF575049), fontWeight: FontWeight.w700)),
        ),
        ElevatedButton(
          onPressed: () {
            socket.emit('respond_guess_reveal', {'revealId': revealId, 'approved': true});
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
}

void showHandshakeCompletedDialog(BuildContext context, String message) {
  showDialog(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: const Color(0xFFFFFFFF),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      title: const Row(
        children: [
          Icon(Icons.handshake_rounded, color: Color(0xFF0FB881), size: 24),
          SizedBox(width: 8),
          Text('Mutual Handshake!', style: TextStyle(color: Color(0xFF1E1B18), fontSize: 17, fontWeight: FontWeight.w800)),
        ],
      ),
      content: Text(
        '$message\n\nBoth of you agreed to break anonymity. You can now freely share your department, batch, or Instagram handle in chat.',
        style: TextStyle(color: const Color(0xFF1E1B18).withValues(alpha: 0.85), fontSize: 13, height: 1.5),
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

void showPartnerLeftChatDialog(
  BuildContext context, {
  required String alias,
  required VoidCallback onExitToHome,
}) {
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
          Text('Partner Left', style: TextStyle(color: Color(0xFF1E1B18), fontSize: 17, fontWeight: FontWeight.bold)),
        ],
      ),
      content: Text(
        '$alias has left this bench session.',
        style: TextStyle(color: const Color(0xFF1E1B18).withValues(alpha: 0.85), fontSize: 13, height: 1.4),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx),
          child: Text('Review Chat', style: TextStyle(color: const Color(0xFF1E1B18).withValues(alpha: 0.60))),
        ),
        ElevatedButton(
          onPressed: () {
            Navigator.pop(ctx);
            onExitToHome();
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
