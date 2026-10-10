import 'package:flutter/material.dart';
import 'home_tab_screen.dart';
import 'admin_analytics_screen.dart';
import 'settings_screen.dart';

class MainNavigationScreen extends StatefulWidget {
  const MainNavigationScreen({super.key});
  @override
  State<MainNavigationScreen> createState() => _MainNavigationScreenState();
}

class _MainNavigationScreenState extends State<MainNavigationScreen> {
  int _currentIndex = 0;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isDesktop = constraints.maxWidth > 480;

        Widget content = Scaffold(
          backgroundColor: const Color(0xFF080A0F),
          body: IndexedStack(
            index: _currentIndex,
            children: [
              const HomeTabScreen(),
              const AdminAnalyticsScreen(),
              _buildPlaceholderScreen('Stones & Rewards', Icons.diamond_outlined),
              const SettingsScreen(),
            ],
          ),
          bottomNavigationBar: Container(
            decoration: BoxDecoration(
              color: const Color(0xFF0B0E17),
              border: Border(
                top: BorderSide(
                  color: Colors.white.withValues(alpha: 0.05),
                  width: 1,
                ),
              ),
            ),
            child: BottomNavigationBar(
              currentIndex: _currentIndex,
              onTap: (i) => setState(() => _currentIndex = i),
              backgroundColor: const Color(0xFF0B0E17),
              elevation: 0,
              type: BottomNavigationBarType.fixed,
              selectedItemColor: const Color(0xFF10B981), // Emerald
              unselectedItemColor: Colors.white.withValues(alpha: 0.35),
              selectedFontSize: 11,
              unselectedFontSize: 11,
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
                  label: 'Analytics',
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

        // Desktop framed layout
        return Scaffold(
          backgroundColor: const Color(0xFF04060A),
          body: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 430),
              child: Container(
                decoration: BoxDecoration(
                  color: const Color(0xFF080A0F),
                  border: Border.symmetric(
                    vertical: BorderSide(
                      color: Colors.white.withValues(alpha: 0.08),
                    ),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.8),
                      blurRadius: 36,
                      spreadRadius: 2,
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

  Widget _buildPlaceholderScreen(String title, IconData icon) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.04),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(icon, size: 28, color: const Color(0xFFF59E0B)),
          ),
          const SizedBox(height: 16),
          Text(
            title,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Coming soon in the next stones update',
            style: TextStyle(
              fontSize: 13,
              color: Colors.white.withValues(alpha: 0.4),
            ),
          ),
        ],
      ),
    );
  }
}
