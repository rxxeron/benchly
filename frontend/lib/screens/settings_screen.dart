import 'dart:math';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _isLoading = true;
  String? _currentAlias;
  DateTime? _aliasChangedAt;
  int _aliasChangeCount = 0;
  String? _gender;
  String? _ageRange;
  String? _matchPreference;

  final List<String> _adj = ['Silent', 'Brave', 'Sleepy', 'Neon', 'Midnight', 'Caffeinated', 'Phantom', 'Shadow', 'Crimson', 'Lost', 'Chill', 'Hungry', 'Genius', 'Rebel', 'Mysterious', 'Electric', 'Chaotic', 'Zen'];
  final List<String> _noun = ['Panther', 'Scholar', 'Coder', 'Freshman', 'Backbencher', 'Ninja', 'Ghost', 'Senior', 'Engineer', 'Debater', 'Gamer', 'Potato', 'Dinosaur', 'Penguin', 'Hacker', 'Overthinker'];

  @override
  void initState() {
    super.initState();
    _fetchSettings();
  }

  Future<void> _fetchSettings() async {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) return;

    try {
      final data = await Supabase.instance.client
          .from('users')
          .select('generated_alias, alias_changed_at, alias_change_count, gender, age_range, match_preference')
          .eq('id', user.id)
          .single();

      if (mounted) {
        setState(() {
          _currentAlias = data['generated_alias'];
          if (data['alias_changed_at'] != null) {
            _aliasChangedAt = DateTime.parse(data['alias_changed_at']);
          }
          _aliasChangeCount = data['alias_change_count'] ?? 0;
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

  Future<void> _regenerateAlias() async {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) return;

    final random = Random();
    final a = _adj[random.nextInt(_adj.length)];
    final n = _noun[random.nextInt(_noun.length)];
    final num = random.nextInt(90) + 10;
    final newAlias = '$a $n $num';
    final now = DateTime.now().toUtc().toIso8601String();
    final newCount = _aliasChangeCount + 1;

    try {
      await Supabase.instance.client.from('users').update({
        'generated_alias': newAlias,
        'alias_changed_at': now,
        'alias_change_count': newCount,
      }).eq('id', user.id);

      if (mounted) {
        setState(() {
          _currentAlias = newAlias;
          _aliasChangedAt = DateTime.now();
          _aliasChangeCount = newCount;
        });
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Alias updated successfully!')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Error regenerating alias')));
      }
    }
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
        backgroundColor: const Color(0xFF181920),
        title: const Text('Delete Account', style: TextStyle(color: Colors.white)),
        content: const Text('Are you sure you want to delete your account? This action cannot be undone.', style: TextStyle(color: Colors.white70)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel', style: TextStyle(color: Colors.white)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete', style: TextStyle(color: Color(0xFFEF4444))),
          ),
        ],
      ),
    );

    if (confirm == true) {
      // Cascade delete needs admin, so we just sign out for now
      await _logout();
    }
  }

  int _daysUntilAliasChange() {
    // 1st alias change is completely free anytime (0 wait)
    if (_aliasChangeCount == 0 || _aliasChangedAt == null) return 0;
    final nextChangeDate = _aliasChangedAt!.add(const Duration(days: 30));
    final diff = nextChangeDate.difference(DateTime.now());
    if (diff.isNegative) return 0;
    final days = (diff.inSeconds / (24 * 3600)).ceil();
    return days <= 0 ? 1 : days;
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.only(left: 16, bottom: 8, top: 24),
      child: Text(
        title,
        style: TextStyle(
          color: Colors.white.withValues(alpha: 0.4),
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
        color: const Color(0xFF181920),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
      ),
      child: Column(
        children: children,
      ),
    );
  }

  Widget _buildDivider() {
    return Container(
      height: 1,
      color: Colors.white.withValues(alpha: 0.06),
      margin: const EdgeInsets.symmetric(horizontal: 16),
    );
  }

  Widget _buildListTile({
    required String title,
    Widget? trailing,
    Widget? subtitle,
    VoidCallback? onTap,
    Color textColor = Colors.white,
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
        backgroundColor: Color(0xFF0F1015),
        body: Center(child: CircularProgressIndicator(color: Color(0xFF6366F1))),
      );
    }

    final daysToWait = _daysUntilAliasChange();

    return Scaffold(
      backgroundColor: const Color(0xFF0F1015),
      appBar: AppBar(
        title: const Text(
          'Settings',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            color: Colors.white,
          ),
        ),
        backgroundColor: const Color(0xFF0F1015),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildSectionHeader('PROFILE'),
            _buildGroup([
              _buildListTile(
                title: 'Current Alias',
                subtitle: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _currentAlias ?? 'Loading...',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.85),
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _aliasChangeCount == 0
                          ? '1st change is available anytime'
                          : (daysToWait > 0
                              ? 'Next change in $daysToWait days'
                              : 'Ready for change (30-day interval)'),
                      style: TextStyle(
                        color: _aliasChangeCount == 0
                            ? const Color(0xFF38BDF8)
                            : Colors.white.withValues(alpha: 0.4),
                        fontSize: 11,
                        fontWeight: _aliasChangeCount == 0 ? FontWeight.w600 : FontWeight.w400,
                      ),
                    ),
                  ],
                ),
                trailing: ElevatedButton(
                  onPressed: daysToWait > 0 ? null : _regenerateAlias,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF6366F1),
                    foregroundColor: Colors.white,
                    disabledBackgroundColor: const Color(0xFF262838),
                    disabledForegroundColor: Colors.white.withValues(alpha: 0.3),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    minimumSize: const Size(0, 36),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                    elevation: 0,
                  ),
                  child: Text(
                    daysToWait > 0
                        ? '${daysToWait}d wait'
                        : (_aliasChangeCount == 0 ? 'Change (Free)' : 'Regenerate'),
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
              _buildDivider(),
              _buildListTile(
                title: 'Gender',
                trailing: DropdownButton<String>(
                  value: _gender?.toLowerCase(),
                  dropdownColor: const Color(0xFF181920),
                  underline: const SizedBox(),
                  style: const TextStyle(color: Colors.white),
                  items: const [
                    DropdownMenuItem(value: 'male', child: Text('Male')),
                    DropdownMenuItem(value: 'female', child: Text('Female')),
                  ],
                  onChanged: (val) {
                    if (val != null) _updateField('gender', val);
                  },
                ),
              ),
              _buildDivider(),
              _buildListTile(
                title: 'Age Range',
                trailing: DropdownButton<String>(
                  value: _ageRange,
                  hint: Text('Select', style: TextStyle(color: Colors.white.withValues(alpha: 0.5))),
                  dropdownColor: const Color(0xFF181920),
                  underline: const SizedBox(),
                  style: const TextStyle(color: Colors.white),
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
            
            _buildSectionHeader('CHAT PREFERENCES'),
            _buildGroup([
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Default Match Filter', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w500)),
                    Row(
                      children: ['anyone', 'guys', 'girls'].map((pref) {
                        final isSelected = _matchPreference == pref;
                        String label = pref == 'guys' ? 'Guys' : pref == 'girls' ? 'Girls' : 'Anyone';
                        return Padding(
                          padding: const EdgeInsets.only(left: 8),
                          child: InkWell(
                            onTap: () => _updateField('match_preference', pref),
                            borderRadius: BorderRadius.circular(12),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                              decoration: BoxDecoration(
                                color: isSelected ? const Color(0xFF6366F1).withValues(alpha: 0.2) : Colors.transparent,
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                  color: isSelected ? const Color(0xFF6366F1) : Colors.white.withValues(alpha: 0.2),
                                ),
                              ),
                              child: Text(
                                label,
                                style: TextStyle(
                                  color: isSelected ? const Color(0xFF6366F1) : Colors.white.withValues(alpha: 0.7),
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

            _buildSectionHeader('ACCOUNT'),
            _buildGroup([
              _buildListTile(
                title: 'Log Out',
                textColor: Colors.white,
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
                trailing: Text('Benchly v1.0.0', style: TextStyle(color: Colors.white.withValues(alpha: 0.5))),
              ),
            ]),
            
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}
