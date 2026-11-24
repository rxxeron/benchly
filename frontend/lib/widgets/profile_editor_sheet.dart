import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import '../config/app_config.dart';

class ProfileEditResult {
  final String alias;
  final String deptCode;
  final String? currentSemester;
  final String? admittedSemester;
  final String realName;
  final int? realAge;
  final bool allowGuessing;
  final String badge;

  const ProfileEditResult({
    required this.alias,
    required this.deptCode,
    this.currentSemester,
    this.admittedSemester,
    this.realName = '',
    this.realAge,
    this.allowGuessing = true,
    required this.badge,
  });
}

/// Reusable bottom sheet powered 100% by Benchly's server & database APIs:
/// - GET  /api/profile/options               (DB-backed departments & semesters)
/// - GET  /api/profile/nicknames/suggestions (Server-side eclectic nicknames)
/// - GET  /api/profile/me                    (Current student profile)
/// - POST /api/profile/update                (Saves anytime, zero cooldown)
Future<ProfileEditResult?> showProfileEditorSheet(
  BuildContext context, {
  required String currentAlias,
  required String currentDept,
  String? currentSemester,
}) {
  return showModalBottomSheet<ProfileEditResult>(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFFFFF9F0),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (ctx) => _ProfileEditorSheetBody(
      initialAlias: currentAlias,
      initialDept: currentDept,
      initialSemester: currentSemester,
    ),
  );
}

class _ProfileEditorSheetBody extends StatefulWidget {
  final String initialAlias;
  final String initialDept;
  final String? initialSemester;

  const _ProfileEditorSheetBody({
    required this.initialAlias,
    required this.initialDept,
    this.initialSemester,
  });

  @override
  State<_ProfileEditorSheetBody> createState() => _ProfileEditorSheetBodyState();
}

class _ProfileEditorSheetBodyState extends State<_ProfileEditorSheetBody> {
  late TextEditingController _aliasController;
  late TextEditingController _realNameController;
  late TextEditingController _ageController;

  List<String> _departments = [];
  List<String> _currentSemesters = [];
  List<String> _admittedSemesters = [];
  List<String> _suggestions = [];

  bool _loadingOptions = true;
  bool _loadingSuggestions = false;

  String? _selectedDept;
  String? _selectedCurrentSemester;
  String? _selectedAdmittedSemester;
  bool _allowGuessing = true;
  bool _saving = false;
  String? _errorText;

  @override
  void initState() {
    super.initState();
    _aliasController = TextEditingController(text: widget.initialAlias);
    _realNameController = TextEditingController();
    _ageController = TextEditingController();
    _selectedDept = widget.initialDept;
    _selectedCurrentSemester = widget.initialSemester;
    _initFromServer();
  }

  @override
  void dispose() {
    _aliasController.dispose();
    _realNameController.dispose();
    _ageController.dispose();
    super.dispose();
  }

  Future<void> _initFromServer() async {
    await Future.wait([
      _loadDbOptions(),
      _loadServerProfile(),
      _fetchServerSuggestions(),
    ]);
  }

  Future<void> _loadDbOptions() async {
    try {
      final res = await http.get(
        Uri.parse('${AppConfig.socketUrl}/api/profile/options'),
      );
      if (res.statusCode == 200 && mounted) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final depts = (data['departments'] as List?)?.map((e) => e.toString()).toList() ?? [];
        final curSems = (data['currentSemesters'] as List?)?.map((e) => e.toString()).toList() ?? [];
        final admSems = (data['admittedSemesters'] as List?)?.map((e) => e.toString()).toList() ?? [];
        setState(() {
          _departments = depts;
          _currentSemesters = curSems;
          _admittedSemesters = admSems;
          if (_selectedDept != null && !_departments.contains(_selectedDept)) {
            _selectedDept = _departments.isNotEmpty ? _departments.first : null;
          }
          if (_selectedCurrentSemester != null && !_currentSemesters.contains(_selectedCurrentSemester)) {
            _selectedCurrentSemester = null;
          }
          if (_selectedAdmittedSemester != null && !_admittedSemesters.contains(_selectedAdmittedSemester)) {
            _selectedAdmittedSemester = null;
          }
          _loadingOptions = false;
        });
        return;
      }
    } catch (_) {}
    if (mounted) setState(() => _loadingOptions = false);
  }

  Future<void> _loadServerProfile() async {
    final token = Supabase.instance.client.auth.currentSession?.accessToken;
    if (token == null) return;

    try {
      final res = await http.get(
        Uri.parse('${AppConfig.socketUrl}/api/profile/me'),
        headers: {'Authorization': 'Bearer $token'},
      );
      if (res.statusCode == 200 && mounted) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        setState(() {
          if (data['alias'] != null) _aliasController.text = data['alias'].toString();
          final dept = data['deptCode']?.toString();
          if (dept != null && dept.isNotEmpty) _selectedDept = dept;
          final sem = data['currentSemester']?.toString();
          if (sem != null && sem.isNotEmpty) _selectedCurrentSemester = sem;
          final adm = data['admittedSemester']?.toString();
          if (adm != null && adm.isNotEmpty) _selectedAdmittedSemester = adm;
          _realNameController.text = (data['realName'] ?? '').toString();
          if (data['realAge'] != null) {
            _ageController.text = data['realAge'].toString();
          }
          _allowGuessing = data['allowGuessing'] != false;
        });
      }
    } catch (_) {}
  }

  Future<void> _fetchServerSuggestions({bool selectFirst = false}) async {
    setState(() => _loadingSuggestions = true);
    try {
      final res = await http.get(
        Uri.parse('${AppConfig.socketUrl}/api/profile/nicknames/suggestions?count=6'),
      );
      if (res.statusCode == 200 && mounted) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final list = (data['suggestions'] as List?)?.map((e) => e.toString()).toList() ?? [];
        setState(() {
          _suggestions = list;
          if (selectFirst && list.isNotEmpty) {
            _aliasController.text = list.first;
            _errorText = null;
          }
          _loadingSuggestions = false;
        });
        return;
      }
    } catch (_) {}
    if (mounted) setState(() => _loadingSuggestions = false);
  }

  Future<void> _saveProfile({bool rollRandomOnServer = false}) async {
    final token = Supabase.instance.client.auth.currentSession?.accessToken;
    if (token == null) return;

    final newAlias = _aliasController.text.trim();
    if (!rollRandomOnServer && (newAlias.length < 3 || newAlias.length > 28)) {
      setState(() => _errorText = 'Nickname must be between 3 and 28 characters.');
      return;
    }

    final ageText = _ageController.text.trim();
    int? parsedAge;
    if (ageText.isNotEmpty) {
      parsedAge = int.tryParse(ageText);
      if (parsedAge == null || parsedAge < 15 || parsedAge > 45) {
        setState(() => _errorText = 'Enter a valid age between 15 and 45 (or leave blank).');
        return;
      }
    }

    setState(() {
      _saving = true;
      _errorText = null;
    });

    try {
      final res = await http.post(
        Uri.parse('${AppConfig.socketUrl}/api/profile/update'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'rollRandom': rollRandomOnServer,
          'newAlias': newAlias,
          'deptCode': _selectedDept ?? widget.initialDept,
          'currentSemester': _selectedCurrentSemester,
          'admittedSemester': _selectedAdmittedSemester,
          'realName': _realNameController.text.trim(),
          'realAge': parsedAge,
          'allowGuessing': _allowGuessing,
        }),
      );

      final data = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode == 200 && data['success'] == true) {
        if (mounted) {
          Navigator.pop(
            context,
            ProfileEditResult(
              alias: data['alias']?.toString() ?? newAlias,
              deptCode: data['deptCode']?.toString() ?? (_selectedDept ?? widget.initialDept),
              currentSemester: data['currentSemester']?.toString(),
              admittedSemester: data['admittedSemester']?.toString(),
              realName: (data['realName'] ?? '').toString(),
              realAge: data['realAge'] is int ? data['realAge'] as int : parsedAge,
              allowGuessing: data['allowGuessing'] != false,
              badge: data['badge']?.toString() ?? (_selectedDept ?? widget.initialDept),
            ),
          );
        }
      } else {
        if (mounted) {
          setState(() {
            _saving = false;
            _errorText = data['error']?.toString() ?? 'Could not update profile.';
          });
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _errorText = 'Server unreachable. Please try again.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(20, 14, 20, 20 + bottomInset),
        child: SingleChildScrollView(
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
              const SizedBox(height: 14),
              Row(
                children: [
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Customize Your Bench Vibe',
                          style: TextStyle(
                            color: Color(0xFF1E1B18),
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.3,
                          ),
                        ),
                        SizedBox(height: 2),
                        Text(
                          'Change nickname anytime • Private info only for fun guesses',
                          style: TextStyle(color: Color(0xFF575049), fontSize: 11.5),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded, color: Color(0xFF575049)),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              // Nickname Input + Server Shuffle
              Row(
                children: [
                  const Text(
                    'NICKNAME (ANYTIME)',
                    style: TextStyle(
                      color: Color(0xFF575049),
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1.0,
                    ),
                  ),
                  const Spacer(),
                  TextButton.icon(
                    onPressed: _loadingSuggestions
                        ? null
                        : () => _fetchServerSuggestions(selectFirst: true),
                    icon: _loadingSuggestions
                        ? const SizedBox(
                            width: 13,
                            height: 13,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Color(0xFF0FB881),
                            ),
                          )
                        : const Icon(Icons.casino_rounded, size: 16, color: Color(0xFF0FB881)),
                    label: const Text(
                      'Shuffle Fresh Vibes',
                      style: TextStyle(
                        color: Color(0xFF0FB881),
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _aliasController,
                maxLength: 28,
                style: const TextStyle(color: Color(0xFF1E1B18), fontWeight: FontWeight.w700, fontSize: 15),
                decoration: InputDecoration(
                  counterText: '',
                  hintText: 'Pick a server vibe or type your own...',
                  hintStyle: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.28)),
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
              const SizedBox(height: 10),

              if (_suggestions.isNotEmpty)
                Wrap(
                  spacing: 7,
                  runSpacing: 7,
                  children: _suggestions.map((name) {
                    final selected = _aliasController.text.trim() == name;
                    return InkWell(
                      onTap: () {
                        setState(() {
                          _aliasController.text = name;
                          _errorText = null;
                        });
                      },
                      borderRadius: BorderRadius.circular(20),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
                        decoration: BoxDecoration(
                          color: selected
                              ? const Color(0xFF0FB881).withValues(alpha: 0.18)
                              : const Color(0xFFFFF2DF),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: selected
                                ? const Color(0xFF0FB881)
                                : Color(0xFF1E1B18).withValues(alpha: 0.15),
                          ),
                        ),
                        child: Text(
                          name,
                          style: TextStyle(
                            color: selected ? const Color(0xFF34D399) : const Color(0xFF44403C),
                            fontSize: 11.5,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    );
                  }).toList(),
                ),

              const SizedBox(height: 18),

              if (_loadingOptions)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Center(
                    child: SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF0FB881)),
                    ),
                  ),
                )
              else ...[
                // Department & Current Semester (DB-backed)
                Row(
                  children: [
                    Expanded(
                      child: _buildDropdownColumn(
                        label: 'DEPARTMENT',
                        value: _departments.contains(_selectedDept) ? _selectedDept : null,
                        hint: 'Select Dept',
                        items: _departments,
                        onChanged: (v) {
                          if (v != null) setState(() => _selectedDept = v);
                        },
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _buildDropdownColumn(
                        label: 'CURRENT SEMESTER',
                        value: _currentSemesters.contains(_selectedCurrentSemester)
                            ? _selectedCurrentSemester
                            : null,
                        hint: 'Which Sem?',
                        items: _currentSemesters,
                        onChanged: (v) => setState(() => _selectedCurrentSemester = v),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),

                // Admitted Semester (DB-backed) & Real Age
                Row(
                  children: [
                    Expanded(
                      flex: 3,
                      child: _buildDropdownColumn(
                        label: 'ADMITTED SEMESTER',
                        value: _admittedSemesters.contains(_selectedAdmittedSemester)
                            ? _selectedAdmittedSemester
                            : null,
                        hint: 'Select Intake',
                        items: _admittedSemesters,
                        onChanged: (v) => setState(() => _selectedAdmittedSemester = v),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      flex: 2,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'REAL AGE',
                            style: TextStyle(
                              color: Color(0xFF575049),
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 1.0,
                            ),
                          ),
                          const SizedBox(height: 6),
                          TextField(
                            controller: _ageController,
                            keyboardType: TextInputType.number,
                            maxLength: 2,
                            style: const TextStyle(color: Color(0xFF1E1B18), fontWeight: FontWeight.w700, fontSize: 14),
                            decoration: InputDecoration(
                              counterText: '',
                              hintText: 'e.g. 21',
                              hintStyle: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.28), fontSize: 13),
                              filled: true,
                              fillColor: const Color(0xFFFFF2DF),
                              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
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
                        ],
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 14),

              // Private Real Name
              const Text(
                'REAL NAME (HIDDEN — FOR GUESSING GAME)',
                style: TextStyle(
                  color: Color(0xFF575049),
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.0,
                ),
              ),
              const SizedBox(height: 6),
              TextField(
                controller: _realNameController,
                maxLength: 40,
                style: const TextStyle(color: Color(0xFF1E1B18), fontWeight: FontWeight.w600, fontSize: 14),
                decoration: InputDecoration(
                  counterText: '',
                  hintText: 'Optional — never shown unless someone guesses right!',
                  hintStyle: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.28), fontSize: 12.5),
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

              // Opt-In Guessing Game Toggle
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                  color: const Color(0xFF6366F1).withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: const Color(0xFF6366F1).withValues(alpha: 0.3)),
                ),
                child: Row(
                  children: [
                    const Text('🎯', style: TextStyle(fontSize: 20)),
                    const SizedBox(width: 10),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Allow Fun Guessing in Chat',
                            style: TextStyle(
                              color: Color(0xFF1E1B18),
                              fontWeight: FontWeight.w700,
                              fontSize: 13,
                            ),
                          ),
                          Text(
                            'Partners can guess your name, age, dept or semester — server checks secretly!',
                            style: TextStyle(color: Color(0xFF575049), fontSize: 11),
                          ),
                        ],
                      ),
                    ),
                    Switch(
                      value: _allowGuessing,
                      activeThumbColor: const Color(0xFF0FB881),
                      onChanged: (v) => setState(() => _allowGuessing = v),
                    ),
                  ],
                ),
              ),

              if (_errorText != null) ...[
                const SizedBox(height: 10),
                Text(
                  _errorText!,
                  style: const TextStyle(color: Color(0xFFEF4444), fontSize: 12, fontWeight: FontWeight.w600),
                ),
              ],

              const SizedBox(height: 18),
              ElevatedButton(
                onPressed: _saving ? null : () => _saveProfile(),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0FB881),
                  foregroundColor: Colors.white,
                  minimumSize: const Size(double.infinity, 50),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  elevation: 0,
                ),
                child: _saving
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                      )
                    : const Text(
                        'Save Profile',
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDropdownColumn({
    required String label,
    required String? value,
    required String hint,
    required List<String> items,
    required ValueChanged<String?> onChanged,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: Color(0xFF575049),
            fontSize: 11,
            fontWeight: FontWeight.w800,
            letterSpacing: 1.0,
          ),
        ),
        const SizedBox(height: 6),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            color: const Color(0xFFFFF2DF),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Color(0xFF1E1B18).withValues(alpha: 0.15)),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              value: value,
              hint: Text(
                hint,
                style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.28), fontSize: 12.5),
              ),
              isExpanded: true,
              dropdownColor: const Color(0xFFFFF2DF),
              style: const TextStyle(
                color: Color(0xFF1E1B18),
                fontWeight: FontWeight.w700,
                fontSize: 13,
              ),
              items: items.map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
              onChanged: onChanged,
            ),
          ),
        ),
      ],
    );
  }
}
