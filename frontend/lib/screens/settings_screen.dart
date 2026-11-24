import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import '../config/app_config.dart';
import '../widgets/profile_editor_sheet.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _isLoading = true;
  String? _currentAlias;
  String _deptCode = 'CSE';
  String? _currentSemester;
  String? _admittedSemester;
  String _realName = '';
  int? _realAge;
  bool _allowGuessing = true;
  String? _gender;
  String? _ageRange;
  String? _matchPreference;

  @override
  void initState() {
    super.initState();
    _fetchSettings();
  }

  Future<void> _fetchSettings() async {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) return;

    try {
      final token = Supabase.instance.client.auth.currentSession?.accessToken;
      final results = await Future.wait<dynamic>([
        Supabase.instance.client
            .from('users')
            .select('generated_alias, dept_code, semester_intake, gender, age_range, match_preference')
            .eq('id', user.id)
            .single(),
        if (token != null)
          http
              .get(
                Uri.parse('${AppConfig.socketUrl}/api/profile/me'),
                headers: {'Authorization': 'Bearer $token'},
              )
              .catchError((_) => http.Response('{}', 500)),
      ]);

      final data = results[0] as Map<String, dynamic>;
      String? admittedSem;
      String realName = '';
      int? realAge;
      bool allowGuess = true;

      if (results.length > 1) {
        final res = results[1] as http.Response;
        if (res.statusCode == 200) {
          final serverProfile = jsonDecode(res.body) as Map<String, dynamic>;
          admittedSem = serverProfile['admittedSemester']?.toString();
          realName = (serverProfile['realName'] ?? '').toString();
          if (serverProfile['realAge'] != null) {
            realAge = int.tryParse(serverProfile['realAge'].toString());
          }
          allowGuess = serverProfile['allowGuessing'] != false;
        }
      }

      if (mounted) {
        setState(() {
          _currentAlias = data['generated_alias'];
          _deptCode = (data['dept_code'] ?? 'CSE').toString();
          _currentSemester = data['semester_intake']?.toString();
          _admittedSemester = admittedSem;
          _realName = realName;
          _realAge = realAge;
          _allowGuessing = allowGuess;
          _gender = data['gender'];
          _ageRange = data['age_range'];
          _matchPreference = data['match_preference'] ?? 'anyone';
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _openProfileEditor() async {
    final result = await showProfileEditorSheet(
      context,
      currentAlias: _currentAlias ?? 'Anonymous',
      currentDept: _deptCode,
      currentSemester: _currentSemester,
    );

    if (result != null && mounted) {
      setState(() {
        _currentAlias = result.alias;
        _deptCode = result.deptCode;
        _currentSemester = result.currentSemester;
        _admittedSemester = result.admittedSemester;
        _realName = result.realName;
        _realAge = result.realAge;
        _allowGuessing = result.allowGuessing;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Updated: ${result.alias} • ${result.badge}'),
          backgroundColor: const Color(0xFF0FB881),
        ),
      );
    }
  }

  Future<void> _updateField(String field, dynamic value) async {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) return;

    try {
      await Supabase.instance.client.from('users').update({field: value}).eq('id', user.id);
      if (mounted) {
        setState(() {
          if (field == 'gender') _gender = value;
          if (field == 'age_range') _ageRange = value;
          if (field == 'match_preference') _matchPreference = value;
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error updating $field')));
      }
    }
  }

  void _showAliasHistoryModal() {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) return;
    final historyFuture = Supabase.instance.client
        .from('alias_history')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', ascending: false);

    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFFFFFFFF),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) {
        return FutureBuilder<List<Map<String, dynamic>>>(
          future: historyFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const SizedBox(
                height: 250,
                child: Center(child: CircularProgressIndicator(color: Color(0xFF0FB881))),
              );
            }
            final list = snapshot.data ?? [];
            return Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.history_rounded, color: Color(0xFF0FB881), size: 20),
                      SizedBox(width: 8),
                      Text(
                        'Alias Rotation History',
                        style: TextStyle(color: Color(0xFF1E1B18), fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Audit records retained for safety & harassment investigations.',
                    style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.60), fontSize: 11),
                  ),
                  const SizedBox(height: 16),
                  if (list.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 24),
                      child: Center(
                        child: Text(
                          'No alias changes recorded yet.',
                          style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.50), fontSize: 13),
                        ),
                      ),
                    )
                  else
                    Flexible(
                      child: ListView.separated(
                        shrinkWrap: true,
                        itemCount: list.length,
                        separatorBuilder: (_, _) => Divider(color: Color(0xFF1E1B18).withValues(alpha: 0.15)),
                        itemBuilder: (context, i) {
                          final item = list[i];
                          final created = DateTime.tryParse(item['created_at'] ?? '')?.toLocal();
                          final dateStr = created != null ? '${created.day}/${created.month}/${created.year}' : '';
                          final type = item['change_type'] == 'auto' ? 'Auto-rotated' : 'Manual change';
                          return ListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text(
                              '${item['old_alias']} ➔ ${item['new_alias']}',
                              style: const TextStyle(color: Color(0xFF1E1B18), fontSize: 13, fontWeight: FontWeight.w600),
                            ),
                            subtitle: Text('$type • $dateStr', style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.50), fontSize: 11)),
                          );
                        },
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

  Future<void> _logout() async {
    await Supabase.instance.client.auth.signOut();
    if (mounted) {
      Navigator.of(context).pushNamedAndRemoveUntil('/', (route) => false);
    }
  }

  Future<void> _deleteAccount() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFFFFFFFF),
        title: const Text('Delete Account', style: TextStyle(color: Color(0xFF1E1B18))),
        content: const Text('Are you sure you want to delete your account? This action cannot be undone.', style: TextStyle(color: Color(0xFF44403C))),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel', style: TextStyle(color: Color(0xFF1E1B18))),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete', style: TextStyle(color: Color(0xFFEF4444))),
          ),
        ],
      ),
    );

    if (confirm == true) {
      try {
        final token = Supabase.instance.client.auth.currentSession?.accessToken;
        if (token != null) {
          final baseUrl = AppConfig.socketUrl.replaceAll(RegExp(r'/+$'), '');
          final res = await http.delete(
            Uri.parse('$baseUrl/api/account'),
            headers: {'Authorization': 'Bearer $token'},
          ).timeout(const Duration(seconds: 10));
          if (res.statusCode < 200 || res.statusCode >= 300) {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Failed to delete account. Please try again.')),
              );
            }
            return;
          }
        }
        await _logout();
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not reach server to delete account.')),
          );
        }
      }
    }
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.only(left: 16, bottom: 8, top: 24),
      child: Text(
        title,
        style: TextStyle(
          color: Color(0xFF1E1B18).withValues(alpha: 0.50),
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 1.2,
        ),
      ),
    );
  }

  Widget _buildGroup(List<Widget> children) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFFFFFFF),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Color(0xFF1E1B18).withValues(alpha: 0.15)),
      ),
      child: Column(
        children: children,
      ),
    );
  }

  Widget _buildDivider() {
    return Container(
      height: 1,
      color: Color(0xFF1E1B18).withValues(alpha: 0.15),
      margin: const EdgeInsets.symmetric(horizontal: 16),
    );
  }

  Widget _buildListTile({
    required String title,
    Widget? trailing,
    Widget? subtitle,
    VoidCallback? onTap,
    Color textColor = const Color(0xFF1E1B18),
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        constraints: const BoxConstraints(minHeight: 48),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: textColor,
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 4),
                    subtitle,
                  ],
                ],
              ),
            ),
            if (trailing != null) ...[
              const SizedBox(width: 8),
              trailing,
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(
        backgroundColor: Color(0xFFFFF9F0),
        body: Center(child: CircularProgressIndicator(color: Color(0xFF0FB881))),
      );
    }

    return Scaffold(
      backgroundColor: const Color(0xFFFFF9F0),
      appBar: AppBar(
        title: const Text(
          'Settings',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            color: Color(0xFF1E1B18),
          ),
        ),
        backgroundColor: const Color(0xFFFFF9F0),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildSectionHeader('PROFILE & VIBE'),
            _buildGroup([
              _buildListTile(
                title: 'Nickname',
                subtitle: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _currentAlias ?? 'Loading...',
                      style: TextStyle(
                        color: Color(0xFF1E1B18).withValues(alpha: 0.85),
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 2),
                    const Text(
                      'Change anytime • Server-generated fresh vibes',
                      style: TextStyle(
                        color: Color(0xFF34D399),
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
                trailing: ElevatedButton(
                  onPressed: _openProfileEditor,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0FB881),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    minimumSize: const Size(0, 36),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                    elevation: 0,
                  ),
                  child: const Text(
                    'Change',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
              _buildDivider(),
              _buildListTile(
                title: 'Department & Semester',
                subtitle: Text(
                  '$_deptCode${_currentSemester != null ? ' • $_currentSemester' : ' • Tap to set semester'}${_admittedSemester != null ? ' (Admitted $_admittedSemester)' : ''}',
                  style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.75), fontSize: 12),
                ),
                trailing: const Icon(Icons.edit_rounded, size: 18, color: Color(0xFF0FB881)),
                onTap: _openProfileEditor,
              ),
              _buildDivider(),
              _buildListTile(
                title: 'Private Info & Guessing Game',
                subtitle: Text(
                  '${_realName.isNotEmpty ? 'Name set' : 'Name hidden'} • ${_realAge != null ? 'Age $_realAge' : 'Age not set'} • Guessing ${_allowGuessing ? 'ON 🎯' : 'OFF'}',
                  style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.75), fontSize: 12),
                ),
                trailing: const Icon(Icons.tune_rounded, size: 18, color: Color(0xFF818CF8)),
                onTap: _openProfileEditor,
              ),
              _buildDivider(),
              _buildListTile(
                title: 'Alias Rotation History',
                subtitle: const Text(
                  'Audit log of previous nicknames (Safety record)',
                  style: TextStyle(color: Color(0xFF78716C), fontSize: 11),
                ),
                trailing: const Icon(Icons.history_rounded, size: 18, color: Color(0xFF0FB881)),
                onTap: _showAliasHistoryModal,
              ),
              _buildDivider(),
              _buildListTile(
                title: 'Gender',
                subtitle: const Text(
                  'Locked after onboarding for campus safety',
                  style: TextStyle(color: Color(0xFF78716C), fontSize: 11),
                ),
                trailing: Text(
                  _gender == null
                      ? 'Not set'
                      : (_gender!.toLowerCase() == 'female' ? 'Female' : 'Male'),
                  style: TextStyle(
                    color: Color(0xFF1E1B18).withValues(alpha: 0.80),
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              _buildDivider(),
              _buildListTile(
                title: 'Age Range',
                trailing: DropdownButton<String>(
                  value: _ageRange,
                  hint: Text('Select', style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.60))),
                  dropdownColor: const Color(0xFFFFFFFF),
                  underline: const SizedBox(),
                  style: const TextStyle(color: Color(0xFF1E1B18)),
                  items: const [
                    DropdownMenuItem(value: '18-19', child: Text('18-19')),
                    DropdownMenuItem(value: '20-21', child: Text('20-21')),
                    DropdownMenuItem(value: '22-23', child: Text('22-23')),
                    DropdownMenuItem(value: '24+', child: Text('24+')),
                  ],
                  onChanged: (val) {
                    if (val != null) _updateField('age_range', val);
                  },
                ),
              ),
            ]),
            
            if (_gender?.toLowerCase() == 'female') ...[
              _buildSectionHeader('CHAT PREFERENCES'),
              _buildGroup([
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Default Match Filter', style: TextStyle(color: Color(0xFF1E1B18), fontSize: 15, fontWeight: FontWeight.w500)),
                      Row(
                        children: [
                          ('anyone', 'Anyone'),
                          ('female', 'Girls Only'),
                        ].map((entry) {
                          final pref = entry.$1;
                          final label = entry.$2;
                          final normalizedPref = (_matchPreference == 'girls' || _matchPreference == 'female') ? 'female' : 'anyone';
                          final isSelected = normalizedPref == pref;
                          return Padding(
                            padding: const EdgeInsets.only(left: 8),
                            child: InkWell(
                              onTap: () => _updateField('match_preference', pref),
                              borderRadius: BorderRadius.circular(12),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                decoration: BoxDecoration(
                                  color: isSelected ? const Color(0xFF0FB881).withValues(alpha: 0.2) : Colors.transparent,
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(
                                    color: isSelected ? const Color(0xFF0FB881) : Color(0xFF1E1B18).withValues(alpha: 0.28),
                                  ),
                                ),
                                child: Text(
                                  label,
                                  style: TextStyle(
                                    color: isSelected ? const Color(0xFF34D399) : Color(0xFF1E1B18).withValues(alpha: 0.80),
                                    fontSize: 12,
                                    fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                                  ),
                                ),
                              ),
                            ),
                          );
                        }).toList(),
                      ),
                    ],
                  ),
                ),
              ]),
            ],

            _buildSectionHeader('ACCOUNT'),
            _buildGroup([
              _buildListTile(
                title: 'Log Out',
                textColor: const Color(0xFF1E1B18),
                onTap: _logout,
              ),
              _buildDivider(),
              _buildListTile(
                title: 'Delete Account',
                textColor: const Color(0xFFEF4444),
                onTap: _deleteAccount,
              ),
            ]),

            _buildSectionHeader('ABOUT'),
            _buildGroup([
              _buildListTile(
                title: 'App Version',
                trailing: Text('Benchly v2.0.0 (EWU Edition)', style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.60))),
              ),
            ]),
            
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}
