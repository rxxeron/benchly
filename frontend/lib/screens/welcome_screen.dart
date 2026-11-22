import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:http/http.dart' as http;
import 'package:lottie/lottie.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../config/app_config.dart';
import '../widgets/mobile_container.dart';
import '../widgets/staggered_reveal.dart';

class WelcomeScreen extends StatefulWidget {
  const WelcomeScreen({super.key});

  @override
  State<WelcomeScreen> createState() => _WelcomeScreenState();
}

class _WelcomeScreenState extends State<WelcomeScreen> {
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  bool _isLoading = false;
  bool _obscurePassword = true;
  bool _isSignUpMode = false;
  String? _errorText;
  String? _infoText;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _forgotPassword() async {
    final email = _emailController.text.trim().toLowerCase();
    final isAllowed = email == 'rhrakibulhasan279@gmail.com' ||
        RegExp(r'^[a-z0-9._%+-]+@std\.ewubd\.edu$').hasMatch(email);
    if (!isAllowed) {
      setState(() {
        _infoText = null;
        _errorText = 'Enter your @std.ewubd.edu email above first to reset your password.';
      });
      return;
    }
    setState(() {
      _isLoading = true;
      _errorText = null;
      _infoText = null;
    });
    try {
      await Supabase.instance.client.auth.resetPasswordForEmail(email);
      if (mounted) {
        setState(() {
          _infoText = 'Password reset link sent to $email. Check your inbox.';
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _errorText = 'Could not send reset email right now. Try again later.');
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  /// Explicit Sign In or Create Account flow (never conflates wrong password with registration)
  Future<void> _signInNativeInApp() async {
    final email = _emailController.text.trim().toLowerCase();
    final password = _passwordController.text;

    if (email.isEmpty || password.length < 8) {
      setState(() {
        _infoText = null;
        _errorText = 'Enter your @std.ewubd.edu email and password (8+ chars).';
      });
      return;
    }

    final isAllowed = email == 'rhrakibulhasan279@gmail.com' ||
        RegExp(r'^[a-z0-9._%+-]+@std\.ewubd\.edu$').hasMatch(email);
    if (!isAllowed) {
      setState(() {
        _infoText = null;
        _errorText = 'Only @std.ewubd.edu emails are allowed.';
      });
      return;
    }

    setState(() {
      _isLoading = true;
      _errorText = null;
      _infoText = null;
    });

    try {
      if (!_isSignUpMode) {
        await Supabase.instance.client.auth.signInWithPassword(
          email: email,
          password: password,
        );
        return;
      }

      // Create Account flow via backend (sends verification email to @std.ewubd.edu)
      final baseUrl = AppConfig.socketUrl.replaceAll(RegExp(r'/+$'), '');
      final regRes = await http
          .post(
            Uri.parse('$baseUrl/api/auth/campus-register'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'email': email, 'password': password}),
          )
          .timeout(const Duration(seconds: 6));

      final parsed = jsonDecode(regRes.body);
      if (regRes.statusCode >= 200 && regRes.statusCode < 300) {
        if (mounted) {
          setState(() {
            _isSignUpMode = false;
            _infoText = parsed['message']?.toString() ??
                'Verification link sent to $email. Verify it, then sign in.';
          });
        }
      } else {
        if (mounted) {
          setState(() => _errorText = parsed['error']?.toString() ?? 'Could not create account.');
        }
      }
    } on AuthException catch (e) {
      if (mounted) {
        setState(() => _errorText = e.message.isNotEmpty ? e.message : 'Invalid email or password.');
      }
    } catch (_) {
      if (mounted) {
        setState(() => _errorText = 'Could not reach Benchly auth server. Please try again.');
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  /// Native Android Google Sign-In (Zero Browser when GOOGLE_WEB_CLIENT_ID is configured)
  /// Falls back cleanly to In-App Browser Overlay + Deep Link (benchly://login-callback)
  Future<void> _signInWithGoogle() async {
    if (!kIsWeb && AppConfig.googleWebClientId.isNotEmpty) {
      setState(() {
        _isLoading = true;
        _errorText = null;
      });
      try {
        final googleSignIn = GoogleSignIn(
          serverClientId: AppConfig.googleWebClientId,
          scopes: ['email', 'profile'],
        );
        final googleUser = await googleSignIn.signIn();
        if (googleUser == null) {
          if (mounted) setState(() => _isLoading = false);
          return;
        }
        final gEmail = googleUser.email.trim().toLowerCase();
        if (gEmail != 'rhrakibulhasan279@gmail.com' && !gEmail.endsWith('@std.ewubd.edu')) {
          await googleSignIn.signOut();
          if (mounted) {
            setState(() {
              _isLoading = false;
              _errorText = 'Only @std.ewubd.edu emails are allowed.';
            });
          }
          return;
        }
        final googleAuth = await googleUser.authentication;
        final idToken = googleAuth.idToken;
        final accessToken = googleAuth.accessToken;
        if (idToken == null) {
          throw Exception('Missing Google ID token');
        }
        await Supabase.instance.client.auth.signInWithIdToken(
          provider: OAuthProvider.google,
          idToken: idToken,
          accessToken: accessToken,
        );
        return;
      } catch (e) {
        if (mounted) {
          setState(() {
            _isLoading = false;
            _errorText = 'Native Google Sign-In error: $e';
          });
        }
        return;
      } finally {
        if (mounted) setState(() => _isLoading = false);
      }
    }

    try {
      final redirectUrl = kIsWeb ? '${Uri.base.origin}/' : 'benchly://login-callback';
      await Supabase.instance.client.auth.signInWithOAuth(
        OAuthProvider.google,
        redirectTo: redirectUrl,
        authScreenLaunchMode: kIsWeb
            ? LaunchMode.platformDefault
            : LaunchMode.inAppBrowserView,
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Google sign-in failed. Try In-App Campus Login above.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFFF9F0),
      body: MobileContainer(
        child: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 26.0, vertical: 28.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 16),
                // App Logo / Symbol with Lottie Vector Aura + Staggered Reveal
                StaggeredReveal(
                  index: 0,
                  child: Center(
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        SizedBox(
                          width: 112,
                          height: 112,
                          child: Lottie.asset(
                            'assets/animations/radar_pulse.json',
                            fit: BoxFit.contain,
                            repeat: true,
                          ),
                        ),
                        Container(
                          width: 68,
                          height: 68,
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(
                              colors: [Color(0xFF6366F1), Color(0xFF0FB881)],
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                            ),
                            borderRadius: BorderRadius.circular(20),
                            boxShadow: [
                              BoxShadow(
                                color: const Color(0xFF0FB881).withValues(alpha: 0.35),
                                blurRadius: 24,
                                offset: const Offset(0, 8),
                              ),
                            ],
                          ),
                          child: const Icon(Icons.chair_rounded, size: 34, color: Colors.white),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                const StaggeredReveal(
                  index: 1,
                  child: Text(
                    'Benchly',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 30,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.8,
                      color: const Color(0xFF1E1B18),
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                StaggeredReveal(
                  index: 2,
                  child: Text(
                    'Anonymous 1-on-1 & 5-Student Cafeteria Adda\nfor East West University',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 13.5,
                      color: Color(0xFF1E1B18).withValues(alpha: 0.70),
                      height: 1.4,
                    ),
                  ),
                ),
                const SizedBox(height: 28),

                // 100% Native In-App Campus Sign-In Card (Zero Browser!)
                StaggeredReveal(
                  index: 3,
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFFFFF),
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: Color(0xFF1E1B18).withValues(alpha: 0.15)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        // Sign In / Create Account segmented toggle
                        Container(
                          padding: const EdgeInsets.all(3),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFFF9F0),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: Color(0xFF1E1B18).withValues(alpha: 0.15)),
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                child: GestureDetector(
                                  onTap: () => setState(() {
                                    _isSignUpMode = false;
                                    _errorText = null;
                                    _infoText = null;
                                  }),
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(vertical: 8),
                                    decoration: BoxDecoration(
                                      color: !_isSignUpMode ? const Color(0xFF0FB881) : Colors.transparent,
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: Text(
                                      'Sign In',
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w800,
                                        color: !_isSignUpMode ? Colors.white : const Color(0xFF575049),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                              Expanded(
                                child: GestureDetector(
                                  onTap: () => setState(() {
                                    _isSignUpMode = true;
                                    _errorText = null;
                                    _infoText = null;
                                  }),
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(vertical: 8),
                                    decoration: BoxDecoration(
                                      color: _isSignUpMode ? const Color(0xFF6366F1) : Colors.transparent,
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: Text(
                                      'Create Account',
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w800,
                                        color: _isSignUpMode ? Colors.white : const Color(0xFF575049),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _emailController,
                          keyboardType: TextInputType.emailAddress,
                          style: const TextStyle(color: Color(0xFF1E1B18), fontSize: 13.5),
                          decoration: InputDecoration(
                            hintText: '2023-x-x-xxx@std.ewubd.edu',
                            hintStyle: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.28), fontSize: 13),
                            prefixIcon: const Icon(Icons.school_outlined, color: Color(0xFF0FB881), size: 18),
                            filled: true,
                            fillColor: const Color(0xFFFFF9F0),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(color: Color(0xFF1E1B18).withValues(alpha: 0.15)),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(color: Color(0xFF1E1B18).withValues(alpha: 0.15)),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: const BorderSide(color: Color(0xFF0FB881)),
                            ),
                          ),
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _passwordController,
                          obscureText: _obscurePassword,
                          onSubmitted: (_) => _signInNativeInApp(),
                          style: const TextStyle(color: Color(0xFF1E1B18), fontSize: 13.5),
                          decoration: InputDecoration(
                            hintText: 'Password (min 8 chars)',
                            hintStyle: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.28), fontSize: 13),
                            prefixIcon: const Icon(Icons.lock_outline_rounded, color: Color(0xFF818CF8), size: 18),
                            suffixIcon: IconButton(
                              icon: Icon(
                                _obscurePassword ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                                color: const Color(0xFF78716C),
                                size: 18,
                              ),
                              onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                            ),
                            filled: true,
                            fillColor: const Color(0xFFFFF9F0),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(color: Color(0xFF1E1B18).withValues(alpha: 0.15)),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(color: Color(0xFF1E1B18).withValues(alpha: 0.15)),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: const BorderSide(color: Color(0xFF6366F1)),
                            ),
                          ),
                        ),
                        if (_infoText != null) ...[
                          const SizedBox(height: 10),
                          Text(
                            _infoText!,
                            style: const TextStyle(color: Color(0xFF34D399), fontSize: 11.5),
                          ),
                        ],
                        if (_errorText != null) ...[
                          const SizedBox(height: 10),
                          Text(
                            _errorText!,
                            style: const TextStyle(color: Color(0xFFF87171), fontSize: 11.5),
                          ),
                        ],
                        const SizedBox(height: 14),
                        SpringTap(
                          child: ElevatedButton(
                            onPressed: _isLoading ? null : _signInNativeInApp,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: _isSignUpMode ? const Color(0xFF6366F1) : const Color(0xFF0FB881),
                              foregroundColor: Colors.white,
                              elevation: 0,
                              minimumSize: const Size(double.infinity, 48),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                            ),
                            child: _isLoading
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                  )
                                : Text(
                                    _isSignUpMode ? 'Create Verified Account' : 'Sign In to Benchly',
                                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
                                  ),
                          ),
                        ),
                        if (!_isSignUpMode) ...[
                          const SizedBox(height: 6),
                          Align(
                            alignment: Alignment.centerRight,
                            child: TextButton(
                              onPressed: _isLoading ? null : _forgotPassword,
                              style: TextButton.styleFrom(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                minimumSize: Size.zero,
                                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              ),
                              child: Text(
                                'Forgot password?',
                                style: TextStyle(
                                  color: Color(0xFF1E1B18).withValues(alpha: 0.65),
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),

                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(child: Divider(color: Color(0xFF1E1B18).withValues(alpha: 0.15))),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: Text(
                        'OR',
                        style: TextStyle(color: Color(0xFF1E1B18).withValues(alpha: 0.28), fontSize: 11, fontWeight: FontWeight.bold),
                      ),
                    ),
                    Expanded(child: Divider(color: Color(0xFF1E1B18).withValues(alpha: 0.15))),
                  ],
                ),
                const SizedBox(height: 14),

                // Google Auth Button (In-App Overlay + Deep Link back to APK)
                StaggeredReveal(
                  index: 4,
                  child: SpringTap(
                    child: OutlinedButton(
                      onPressed: _signInWithGoogle,
                      style: OutlinedButton.styleFrom(
                        backgroundColor: Colors.white,
                        foregroundColor: const Color(0xFF1E1B18),
                        side: const BorderSide(color: Color(0xFF1E1B18), width: 1.8),
                        minimumSize: const Size(double.infinity, 48),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      ),
                      child: const Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.g_mobiledata_rounded, size: 28, color: Color(0xFF1E1B18)),
                          SizedBox(width: 6),
                          Text(
                            'Continue with Google',
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Color(0xFF1E1B18)),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFFFFF),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: Color(0xFF1E1B18).withValues(alpha: 0.15)),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.verified_user_outlined, size: 15, color: Color(0xFF1E1B18).withValues(alpha: 0.50)),
                      const SizedBox(width: 8),
                      Text(
                        'Exclusive to @std.ewubd.edu students',
                        style: TextStyle(
                          fontSize: 12,
                          color: Color(0xFF1E1B18).withValues(alpha: 0.60),
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
