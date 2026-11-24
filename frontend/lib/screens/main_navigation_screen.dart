import 'package:flutter/material.dart';
import 'home_tab_screen.dart';
import 'student_analytics_screen.dart';
import 'stones_rewards_screen.dart';
import 'settings_screen.dart';

class MainNavigationScreen extends StatefulWidget {
  const MainNavigationScreen({super.key});
  @override
  State<MainNavigationScreen> createState() => _MainNavigationScreenState();
}

class _MainNavigationScreenState extends State<MainNavigationScreen> {
  int _currentIndex = 0;
  // Lazy-mount non-home tabs so cold startup doesn't fire 10+ concurrent Supabase/HTTP calls
  // or build offscreen trees until the student first visits each tab.
  final List<bool> _mountedTabs = [true, false, false, false];

  Widget _buildTab(int index) {
    if (!_mountedTabs[index]) return const SizedBox.shrink();
    switch (index) {
      case 0:
        return const HomeTabScreen();
      case 1:
        return const StudentAnalyticsScreen();
      case 2:
        return const StonesRewardsScreen();
      case 3:
      default:
        return const SettingsScreen();
    }
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isDesktop = constraints.maxWidth > 480;

        Widget content = Scaffold(
          backgroundColor: const Color(0xFFFFF9F0),
          body: IndexedStack(
            index: _currentIndex,
            children: List<Widget>.generate(4, _buildTab, growable: false),
          ),
          bottomNavigationBar: Container(
            decoration: const BoxDecoration(
              color: Color(0xFFFFFFFF),
              border: Border(
                top: BorderSide(
                  color: Color(0xFF1E1B18),
                  width: 2,
                ),
              ),
            ),
            child: BottomNavigationBar(
              currentIndex: _currentIndex,
              onTap: (i) {
                if (_currentIndex == i) return;
                setState(() {
                  _mountedTabs[i] = true;
                  _currentIndex = i;
                });
              },
              backgroundColor: const Color(0xFFFFFFFF),
              elevation: 0,
              type: BottomNavigationBarType.fixed,
              selectedItemColor: const Color(0xFF0FB881), // Campus Mint
              unselectedItemColor: const Color(0xFF575049),
              selectedFontSize: 11.5,
              unselectedFontSize: 11,
              selectedLabelStyle: const TextStyle(fontWeight: FontWeight.w700),
              showSelectedLabels: true,
              showUnselectedLabels: true,
              items: const [
                BottomNavigationBarItem(
                  icon: Icon(Icons.chair_outlined),
                  activeIcon: Icon(Icons.chair_rounded),
                  label: 'Bench',
                ),
                BottomNavigationBarItem(
                  icon: Icon(Icons.insights_outlined),
                  activeIcon: Icon(Icons.insights_rounded),
                  label: 'Adda Stats',
                ),
                BottomNavigationBarItem(
                  icon: Icon(Icons.diamond_outlined),
                  activeIcon: Icon(Icons.diamond_rounded),
                  label: 'Stones',
                ),
                BottomNavigationBarItem(
                  icon: Icon(Icons.tune_rounded),
                  activeIcon: Icon(Icons.tune_rounded),
                  label: 'Settings',
                ),
              ],
            ),
          ),
        );

        if (!isDesktop) return content;

        // Desktop sunlit framed layout
        return Scaffold(
          backgroundColor: const Color(0xFFFFF2DF),
          body: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 430),
              child: Container(
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF9F0),
                  border: const Border.symmetric(
                    vertical: BorderSide(
                      color: Color(0xFF1E1B18),
                      width: 2,
                    ),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFF1E1B18).withValues(alpha: 0.14),
                      blurRadius: 28,
                      offset: const Offset(0, 8),
                    ),
                  ],
                ),
                child: content,
              ),
            ),
          ),
        );
      },
    );
  }
}
