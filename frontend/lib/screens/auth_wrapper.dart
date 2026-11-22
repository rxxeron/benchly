import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'main_navigation_screen.dart';
import 'welcome_screen.dart';
import 'gender_selection_screen.dart';

class AuthWrapper extends StatefulWidget {
  const AuthWrapper({super.key});
  @override
  State<AuthWrapper> createState() => _AuthWrapperState();
}

class _AuthWrapperState extends State<AuthWrapper> {
  bool _isLoading = true;
  bool _isAuthenticated = false;
  bool _needsGender = false;

  @override
  void initState() {
    super.initState();
    _checkAuth();
    Supabase.instance.client.auth.onAuthStateChange.listen((data) {
      if (mounted) {
        if (data.session != null) {
          _checkGenderAndRoute();
        } else {
          setState(() {
            _isAuthenticated = false;
            _isLoading = false;
          });
        }
      }
    });
  }

  void _checkAuth() {
    final session = Supabase.instance.client.auth.currentSession;
    if (session != null) {
      _checkGenderAndRoute();
    } else {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _checkGenderAndRoute() async {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) return;

    final email = (user.email ?? '').trim().toLowerCase();
    if (email != 'rhrakibulhasan279@gmail.com' && !email.endsWith('@std.ewubd.edu')) {
      await Supabase.instance.client.auth.signOut();
      if (mounted) {
        setState(() {
          _isAuthenticated = false;
          _isLoading = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Only @std.ewubd.edu emails are allowed.'),
            backgroundColor: Color(0xFFEF4444),
          ),
        );
      }
      return;
    }
    
    try {
      final data = await Supabase.instance.client.from('users').select('gender').eq('id', user.id).single();
      if (mounted) {
        setState(() {
          _isAuthenticated = true;
          _needsGender = data['gender'] == null || data['gender'].toString().isEmpty;
          _isLoading = false;
        });
      }
    } catch (e) {
      // If user profile is not immediately available (delay in trigger), wait and retry or show error
      if (mounted) {
        setState(() {
           _isAuthenticated = true;
           _needsGender = true; // safe fallback
           _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(
        backgroundColor: Color(0xFFFFF9F0),
        body: Center(child: CircularProgressIndicator(color: Color(0xFF0FB881))),
      );
    }
    
    if (!_isAuthenticated) {
      return const WelcomeScreen();
    }
    
    return _needsGender ? const GenderSelectionScreen() : const MainNavigationScreen();
  }
}
