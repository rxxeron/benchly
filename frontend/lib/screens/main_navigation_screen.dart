import 'package:flutter/material.dart';
import 'home_tab_screen.dart';
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
          backgroundColor: const Color(0xFF0F1015),
          body: IndexedStack(
            index: _currentIndex,
            children: [
              const HomeTabScreen(),
              _buildPlaceholderScreen('Notifications', Icons.notifications_none_rounded),
              _buildPlaceholderScreen('Campus Feed', Icons.article_outlined),
              _buildPlaceholderScreen('Stones Shop', Icons.diamond_outlined),
              const SettingsScreen(),
            ],
          ),
          bottomNavigationBar: Container(
            decoration: BoxDecoration(
              color: const Color(0xFF0F1015),
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
              backgroundColor: const Color(0xFF0F1015),
              elevation: 0,
              type: BottomNavigationBarType.fixed,
              selectedItemColor: const Color(0xFF6366F1), // Modern Indigo
              unselectedItemColor: Colors.white.withValues(alpha: 0.35),
              selectedFontSize: 11,
              unselectedFontSize: 11,
              showSelectedLabels: true,
              showUnselectedLabels: true,
              items: const [
                BottomNavigationBarItem(
                  icon: Icon(Icons.forum_outlined),
                  activeIcon: Icon(Icons.forum_rounded),
                  label: 'Chat',
                ),
                BottomNavigationBarItem(
                  icon: Icon(Icons.notifications_none_rounded),
                  activeIcon: Icon(Icons.notifications_rounded),
                  label: 'Alerts',
                ),
                BottomNavigationBarItem(
                  icon: Icon(Icons.article_outlined),
                  activeIcon: Icon(Icons.article_rounded),
                  label: 'Feed',
                ),
                BottomNavigationBarItem(
                  icon: Icon(Icons.diamond_outlined),
                  activeIcon: Icon(Icons.diamond_rounded),
                  label: 'Shop',
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
          backgroundColor: const Color(0xFF07070A),
          body: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 430),
              child: Container(
                decoration: BoxDecoration(
                  color: const Color(0xFF0F1015),
                  border: Border.symmetric(
                    vertical: BorderSide(
                      color: Colors.white.withValues(alpha: 0.08),
                    ),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.7),
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
            child: Icon(icon, size: 28, color: Colors.white38),
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
            'Coming soon in the next update',
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
