import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../widgets/mobile_container.dart';
import 'main_navigation_screen.dart';

class GenderSelectionScreen extends StatefulWidget {
  const GenderSelectionScreen({super.key});
  @override
  State<GenderSelectionScreen> createState() => _GenderSelectionScreenState();
}

class _GenderSelectionScreenState extends State<GenderSelectionScreen> {
  bool _isLoading = false;
  String? _selectedGender;

  Future<void> _submitGender(String gender) async {
    setState(() {
      _selectedGender = gender;
      _isLoading = true;
    });

    try {
      final user = Supabase.instance.client.auth.currentUser;
      if (user != null) {
        await Supabase.instance.client
            .from('users')
            .update({'gender': gender.toLowerCase()})
            .eq('id', user.id);

        if (mounted) {
          Navigator.pushReplacement(
            context,
            MaterialPageRoute(builder: (context) => const MainNavigationScreen()),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error saving: ${e.toString()}')),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F1015),
      body: MobileContainer(
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 28.0, vertical: 40.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Spacer(),
                const Text(
                  'Select Gender',
                  style: TextStyle(
                    fontSize: 26,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.6,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Used strictly for matchmaking preferences. Never shown publicly to strangers.',
                  style: TextStyle(
                    fontSize: 14,
                    color: Colors.white.withValues(alpha: 0.55),
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 36),
                _buildGenderCard(
                  title: 'Male',
                  subtitle: 'Match as a guy',
                  icon: Icons.male_rounded,
                  accentColor: const Color(0xFF38BDF8), // Cyan / Sky
                  genderValue: 'male',
                ),
                const SizedBox(height: 14),
                _buildGenderCard(
                  title: 'Female',
                  subtitle: 'Match as a girl',
                  icon: Icons.female_rounded,
                  accentColor: const Color(0xFFF472B6), // Soft Pink
                  genderValue: 'female',
                ),
                const Spacer(),
                if (_isLoading)
                  const Center(
                    child: CircularProgressIndicator(color: Color(0xFF6366F1)),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildGenderCard({
    required String title,
    required String subtitle,
    required IconData icon,
    required Color accentColor,
    required String genderValue,
  }) {
    final isSelected = _selectedGender == genderValue;

    return InkWell(
      onTap: _isLoading ? null : () => _submitGender(genderValue),
      borderRadius: BorderRadius.circular(16),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: isSelected ? accentColor.withValues(alpha: 0.12) : const Color(0xFF181920),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isSelected ? accentColor : Colors.white.withValues(alpha: 0.08),
            width: isSelected ? 1.8 : 1,
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: accentColor.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: accentColor, size: 28),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: 13,
                      color: Colors.white.withValues(alpha: 0.5),
                    ),
                  ),
                ],
              ),
            ),
            Icon(
              Icons.arrow_forward_ios_rounded,
              size: 16,
              color: Colors.white.withValues(alpha: 0.3),
            ),
          ],
        ),
      ),
    );
  }
}
